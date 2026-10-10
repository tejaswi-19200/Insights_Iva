"""Centralized manufacturing workflow routing — single source of truth.

Maps workflow statuses → responsible teams/roles, next stages, and actionable queues.
Canonical backend status names are used throughout; STAGE_ALIASES documents user-facing synonyms.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import get_role_names, user_is_admin
from app.core.workflow_constants import (
    TEAM_ADMIN,
    TEAM_BILLING,
    TEAM_INVENTORY,
    TEAM_OPERATOR,
    TEAM_PACKING,
    TEAM_PRODUCTION,
    TEAM_QUALITY,
    TEAM_SALES,
    WORKFLOW_COUNT_BUCKETS,
    normalize_priority,
    user_teams,
    workflow_status_label,
)
from app.models.manufacturing_workflow import (
    ManufacturingWorkflowTransition,
    SalesJobCard,
    SalesOrderMaterialCheck,
    WorkflowStageJobCard,
)
from app.models.product import Product
from app.models.production import ProductionOrder, WorkOrder
from app.models.sales import SalesOrder
from app.models.user import User

# User-facing synonyms → canonical workflow_status (documentation + normalization)
STAGE_ALIASES: dict[str, str] = {
    "INVENTORY_CHECK_PENDING": "MATERIAL_CHECK_PENDING",
    "INVENTORY_APPROVED": "MATERIAL_AVAILABLE",
    "PRODUCTION_PENDING": "READY_FOR_PRODUCTION",
    "OPERATOR_PENDING": "PRODUCTION_ASSIGNED",
    "QUALITY_PENDING": "QUALITY_CHECK_PENDING",
    "PACKING_DISPATCH_PENDING": "PACKING_PENDING",
}

# ERP role responsible for acting on a status (primary owner)
RESPONSIBLE_ROLE_BY_STATUS: dict[str, str] = {
    "BOM_PENDING": "Production Manager",
    "SALES_CONFIRMED": "Sales Manager",
    "MATERIAL_CHECK_PENDING": "Store Manager",
    "MATERIAL_SHORTAGE": "Store Manager",
    "MATERIAL_PARTIAL": "Store Manager",
    "MATERIAL_AVAILABLE": "Store Manager",
    "STORE_ISSUE_PENDING": "Store Manager",
    "STORE_ISSUE_PARTIAL": "Store Manager",
    "READY_FOR_PRODUCTION": "Production Manager",
    "PRODUCTION_ASSIGNED": "Operator",
    "PRODUCTION_IN_PROGRESS": "Operator",
    "PRODUCTION_COMPLETED": "Production Manager",
    "PRODUCTION_REWORK": "Production Manager",
    "QUALITY_CHECK_PENDING": "Production Manager",
    "QUALITY_ON_HOLD": "Production Manager",
    "QUALITY_APPROVED": "Store Manager",
    "QUALITY_REJECTED": "Production Manager",
    "PACKING_PENDING": "Store Manager",
    "PACKING_IN_PROGRESS": "Store Manager",
    "PACKING_ISSUE": "Store Manager",
    "PACKED": "Store Manager",
    "BILLING_PENDING": "Accountant",
    "BILLING_HOLD": "Accountant",
    "INVOICED": "Accountant",
    "COMPLETED": "Admin",
    "WORKFLOW_ON_HOLD": "Admin",
}

RESPONSIBLE_TEAM_BY_STATUS: dict[str, str] = {
    "BOM_PENDING": TEAM_PRODUCTION,
    "SALES_CONFIRMED": TEAM_SALES,
    "MATERIAL_CHECK_PENDING": TEAM_INVENTORY,
    "MATERIAL_SHORTAGE": TEAM_INVENTORY,
    "MATERIAL_PARTIAL": TEAM_INVENTORY,
    "MATERIAL_AVAILABLE": TEAM_INVENTORY,
    "STORE_ISSUE_PENDING": TEAM_INVENTORY,
    "STORE_ISSUE_PARTIAL": TEAM_INVENTORY,
    "READY_FOR_PRODUCTION": TEAM_PRODUCTION,
    "PRODUCTION_ASSIGNED": TEAM_OPERATOR,
    "PRODUCTION_IN_PROGRESS": TEAM_OPERATOR,
    "PRODUCTION_COMPLETED": TEAM_PRODUCTION,
    "PRODUCTION_REWORK": TEAM_PRODUCTION,
    "QUALITY_CHECK_PENDING": TEAM_QUALITY,
    "QUALITY_ON_HOLD": TEAM_QUALITY,
    "QUALITY_APPROVED": TEAM_PACKING,
    "QUALITY_REJECTED": TEAM_PRODUCTION,
    "PACKING_PENDING": TEAM_PACKING,
    "PACKING_IN_PROGRESS": TEAM_PACKING,
    "PACKING_ISSUE": TEAM_PACKING,
    "PACKED": TEAM_PACKING,
    "BILLING_PENDING": TEAM_BILLING,
    "BILLING_HOLD": TEAM_BILLING,
    "INVOICED": TEAM_BILLING,
    "COMPLETED": TEAM_ADMIN,
    "WORKFLOW_ON_HOLD": TEAM_ADMIN,
}

# Statuses that require action from each team (strict my-queue filtering)
ACTIONABLE_STATUSES_BY_TEAM: dict[str, frozenset[str]] = {
    TEAM_SALES: frozenset({"SALES_CONFIRMED"}),
    TEAM_INVENTORY: frozenset({
        "MATERIAL_CHECK_PENDING",
        "MATERIAL_SHORTAGE",
        "MATERIAL_PARTIAL",
        "MATERIAL_AVAILABLE",
        "STORE_ISSUE_PENDING",
        "STORE_ISSUE_PARTIAL",
    }),
    TEAM_PRODUCTION: frozenset({
        "BOM_PENDING",
        "READY_FOR_PRODUCTION",
        "PRODUCTION_REWORK",
        "QUALITY_REJECTED",
    }),
    TEAM_OPERATOR: frozenset({"PRODUCTION_ASSIGNED", "PRODUCTION_IN_PROGRESS"}),
    TEAM_QUALITY: frozenset({"QUALITY_CHECK_PENDING", "QUALITY_ON_HOLD"}),
    TEAM_PACKING: frozenset({"PACKING_PENDING", "PACKING_IN_PROGRESS", "PACKING_ISSUE"}),
    TEAM_BILLING: frozenset({"BILLING_PENDING", "BILLING_HOLD", "PACKED"}),
}

# Happy-path automatic routing after stage completion
NEXT_STATUS_AFTER_ACTION: dict[str, str] = {
    "SALES_CONFIRMED": "MATERIAL_CHECK_PENDING",
    "MATERIAL_AVAILABLE": "STORE_ISSUE_PENDING",
    "STORE_ISSUE_PENDING": "READY_FOR_PRODUCTION",
    "READY_FOR_PRODUCTION": "PRODUCTION_ASSIGNED",
    "PRODUCTION_COMPLETED": "QUALITY_CHECK_PENDING",
    "QUALITY_APPROVED": "PACKING_PENDING",
    "PACKED": "BILLING_PENDING",
    "INVOICED": "COMPLETED",
}

PRIMARY_ROLE_LABEL: dict[str, str] = {
    TEAM_SALES: "Sales Manager",
    TEAM_INVENTORY: "Store Manager",
    TEAM_PRODUCTION: "Production Manager",
    TEAM_OPERATOR: "Operator",
    TEAM_QUALITY: "Quality Team",
    TEAM_PACKING: "Packing & Dispatch",
    TEAM_BILLING: "Billing",
    TEAM_ADMIN: "Admin",
}

# Store Manager list labels (canonical workflow_status_label is unchanged)
STORE_QUEUE_STATUS_LABELS: dict[str, str] = {
    "MATERIAL_CHECK_PENDING": "Inventory Check Pending",
    "MATERIAL_SHORTAGE": "Material Shortage",
    "MATERIAL_AVAILABLE": "Materials Available",
    "STORE_ISSUE_PENDING": "Ready to Issue",
    "MATERIAL_PARTIAL": "Materials Partially Available",
    "STORE_ISSUE_PARTIAL": "Partially Issued",
}

STORE_KPI_BUCKETS: dict[str, frozenset[str]] = {
    "store_pending": frozenset({"MATERIAL_CHECK_PENDING", "MATERIAL_SHORTAGE"}),
    "ready_to_issue": frozenset({"MATERIAL_AVAILABLE", "STORE_ISSUE_PENDING"}),
    "partially_issued": frozenset({"STORE_ISSUE_PARTIAL", "MATERIAL_PARTIAL"}),
}

# Store Manager my-queue: fetch/sort cap (pagination is client-side on the full set).
STORE_QUEUE_MAX_FETCH = 2000


def _store_queue_sort_key(row: dict[str, Any]) -> tuple[int, str, str, int]:
    """Stable ascending order for serial numbers (job card no, then time, then id)."""
    jno = str(row.get("job_card_no") or row.get("order_number") or "").strip()
    match = re.search(r"(\d+)\s*$", jno)
    num = int(match.group(1)) if match else 0
    recv = str(row.get("received_at") or row.get("created_at") or row.get("order_date") or "")
    rid = int(row.get("job_card_id") or row.get("sales_order_id") or 0)
    return (num, jno.lower(), recv, rid)

POST_STORE_STATUSES: frozenset[str] = frozenset({
    "READY_FOR_PRODUCTION",
    "PRODUCTION_ASSIGNED",
    "PRODUCTION_IN_PROGRESS",
    "PRODUCTION_COMPLETED",
    "PRODUCTION_REWORK",
    "QUALITY_CHECK_PENDING",
    "QUALITY_ON_HOLD",
    "QUALITY_APPROVED",
    "QUALITY_REJECTED",
    "PACKING_PENDING",
    "PACKING_IN_PROGRESS",
    "PACKING_ISSUE",
    "PACKED",
    "BILLING_PENDING",
    "BILLING_HOLD",
    "INVOICED",
    "COMPLETED",
})

QUEUE_ACTIONS_BY_STATUS: dict[str, list[str]] = {
    "MATERIAL_CHECK_PENDING": ["view", "check_stock", "hold", "add_remarks"],
    "MATERIAL_SHORTAGE": ["view", "check_stock", "record_shortage", "hold", "add_remarks"],
    "MATERIAL_PARTIAL": ["view", "check_stock", "partial_issue", "hold", "add_remarks"],
    "MATERIAL_AVAILABLE": [
        "view",
        "check_stock",
        "issue_materials",
        "partial_issue",
        "send_to_production",
        "hold",
        "add_remarks",
    ],
    "STORE_ISSUE_PENDING": [
        "view",
        "issue_materials",
        "partial_issue",
        "send_to_production",
        "hold",
        "add_remarks",
    ],
    "STORE_ISSUE_PARTIAL": [
        "view",
        "issue_materials",
        "partial_issue",
        "send_to_production",
        "hold",
        "add_remarks",
    ],
}

NEEDED_ACTION_BY_STATUS: dict[str, str] = {
    "MATERIAL_CHECK_PENDING": "Check Stock",
    "MATERIAL_SHORTAGE": "Record Shortage",
    "MATERIAL_PARTIAL": "Partial Issue",
    "MATERIAL_AVAILABLE": "Issue Material",
    "STORE_ISSUE_PENDING": "Issue Material",
    "STORE_ISSUE_PARTIAL": "Complete Issue / Send to Production",
}


def normalize_workflow_status(status: str | None) -> str | None:
    if not status:
        return None
    key = status.strip().upper()
    return STAGE_ALIASES.get(key, key)


def get_responsible_team(status: str | None) -> str | None:
    return RESPONSIBLE_TEAM_BY_STATUS.get(normalize_workflow_status(status) or "")


def get_responsible_role(status: str | None) -> str | None:
    return RESPONSIBLE_ROLE_BY_STATUS.get(normalize_workflow_status(status) or "")


def get_next_workflow_status(current_status: str | None, *, action: str | None = None) -> str | None:
    """Return the canonical next status on the happy path after a stage completes."""
    key = normalize_workflow_status(current_status)
    if not key:
        return "MATERIAL_CHECK_PENDING" if action == "confirm" else None
    if action == "confirm" and key in {"draft", "SALES_CONFIRMED"}:
        return "MATERIAL_CHECK_PENDING"
    return NEXT_STATUS_AFTER_ACTION.get(key)


def get_actionable_statuses_for_user(user: User, *, strict: bool = True) -> set[str]:
    """Statuses the user should see in their my-queue (backend-only filtering)."""
    if user_is_admin(user):
        return set()  # admin uses broad query unless status_filter provided

    teams = user_teams(get_role_names(user))
    allowed: set[str] = set()
    for team in teams:
        bucket = ACTIONABLE_STATUSES_BY_TEAM.get(team, frozenset())
        if strict:
            allowed.update(bucket)
        else:
            # Legacy broad visibility for /queue backward compatibility
            allowed.update(_legacy_team_statuses().get(team, set()))
    return allowed


def _legacy_team_statuses() -> dict[str, set[str]]:
    return {
        TEAM_SALES: {"SALES_CONFIRMED"},
        TEAM_INVENTORY: {
            "MATERIAL_CHECK_PENDING",
            "MATERIAL_SHORTAGE",
            "MATERIAL_PARTIAL",
            "MATERIAL_AVAILABLE",
            "STORE_ISSUE_PENDING",
            "STORE_ISSUE_PARTIAL",
        },
        TEAM_PRODUCTION: {
            "READY_FOR_PRODUCTION",
            "PRODUCTION_ASSIGNED",
            "PRODUCTION_IN_PROGRESS",
            "PRODUCTION_COMPLETED",
            "PRODUCTION_REWORK",
            "QUALITY_REJECTED",
        },
        TEAM_OPERATOR: {"PRODUCTION_ASSIGNED", "PRODUCTION_IN_PROGRESS"},
        TEAM_QUALITY: {"QUALITY_CHECK_PENDING", "QUALITY_ON_HOLD", "QUALITY_REJECTED"},
        TEAM_PACKING: {"QUALITY_APPROVED", "PACKING_PENDING", "PACKING_IN_PROGRESS", "PACKING_ISSUE"},
        TEAM_BILLING: {"BILLING_PENDING", "BILLING_HOLD", "PACKED"},
    }


def get_primary_team_for_user(user: User) -> str | None:
    teams = user_teams(get_role_names(user))
    if user_is_admin(user):
        return TEAM_ADMIN
    priority = (
        TEAM_INVENTORY,
        TEAM_PRODUCTION,
        TEAM_OPERATOR,
        TEAM_QUALITY,
        TEAM_PACKING,
        TEAM_BILLING,
        TEAM_SALES,
    )
    for team in priority:
        if team in teams:
            return team
    return None


def get_queue_metadata_for_user(user: User) -> dict[str, Any]:
    team = get_primary_team_for_user(user)
    role_names = get_role_names(user)
    primary_role = role_names[0] if role_names else None
    return {
        "primary_team": team,
        "primary_role": primary_role,
        "queue_title": _queue_title_for_user(user, team),
        "actionable_statuses": sorted(get_actionable_statuses_for_user(user, strict=True)),
        "responsible_role_label": PRIMARY_ROLE_LABEL.get(team or "", primary_role or "User"),
    }


def _queue_title_for_user(user: User, team: str | None) -> str:
    if user_is_admin(user):
        return "Manufacturing Workflow — All Stages"
    titles = {
        TEAM_INVENTORY: "Store Manager – Inventory Queue",
        TEAM_PRODUCTION: "Production Manager – Job Card Queue",
        TEAM_OPERATOR: "Operator – My Job Cards",
        TEAM_QUALITY: "Quality – Inspection Queue",
        TEAM_PACKING: "Packing & Dispatch Queue",
        TEAM_BILLING: "Billing Queue",
        TEAM_SALES: "Sales – Order Queue",
    }
    return titles.get(team or "", "My Job Card Queue")


def get_admin_dashboard_counts(db: Session, tenant_id: int, counts_raw: dict[str, int]) -> list[dict[str, Any]]:
    """Admin live counts aligned with workflow stages."""
    buckets = []
    for bucket in WORKFLOW_COUNT_BUCKETS:
        statuses = [s.strip() for s in bucket["statuses"].split(",")]
        total = sum(counts_raw.get(s, 0) for s in statuses)
        buckets.append(
            {
                "key": bucket["key"],
                "label": bucket["label"],
                "count": total,
                "path": bucket["path"],
                "statuses": statuses,
                "responsible_role": get_responsible_role(statuses[0]) if statuses else None,
            }
        )
    return buckets


def _sales_person_matches(user: User, so: SalesOrder) -> bool:
    if user_is_admin(user):
        return True
    sp = (so.sales_person or "").strip().lower()
    if not sp:
        return True
    candidates = {
        (user.full_name or "").strip().lower(),
        (user.email or "").strip().lower(),
        (getattr(user, "username", None) or "").strip().lower(),
    }
    candidates = {c for c in candidates if c}
    if not candidates:
        return True
    return sp in candidates or any(c in sp or sp in c for c in candidates)


def _load_received_at_map(
    db: Session, tenant_id: int, order_ids: list[int]
) -> dict[int, str | None]:
    if not order_ids:
        return {}
    rows = db.execute(
        select(
            ManufacturingWorkflowTransition.sales_order_id,
            func.max(ManufacturingWorkflowTransition.created_at),
        )
        .where(
            ManufacturingWorkflowTransition.tenant_id == tenant_id,
            ManufacturingWorkflowTransition.sales_order_id.in_(order_ids),
        )
        .group_by(ManufacturingWorkflowTransition.sales_order_id)
    ).all()
    return {
        so_id: ts.isoformat() if ts else None
        for so_id, ts in rows
    }


def _material_line_totals(material_check: SalesOrderMaterialCheck | None) -> dict[str, Any]:
    if not material_check or not material_check.lines:
        return {
            "required_qty": None,
            "available_qty": None,
            "shortage_qty": None,
            "warehouse": None,
        }
    required = 0.0
    available = 0.0
    shortage = 0.0
    warehouse = None
    for ln in material_check.lines:
        required += float(ln.required_qty or 0)
        available += float(ln.available_qty or 0)
        shortage += float(ln.shortage_qty or 0)
        if not warehouse and ln.stock_location:
            warehouse = ln.stock_location
    return {
        "required_qty": required,
        "available_qty": available,
        "shortage_qty": shortage,
        "warehouse": warehouse,
    }


def _load_product_inventory_map(
    db: Session, tenant_id: int, product_ids: set[int]
) -> dict[int, dict[str, Any]]:
    """Batch-load on-hand, reserved, and warehouse for finished-good products."""
    if not product_ids:
        return {}

    from app.models.inventory import InventoryItem, StockLevel, Warehouse
    from app.services.inventory_service import get_default_warehouse

    products = list(db.scalars(select(Product).where(Product.id.in_(list(product_ids)))).all())
    skus = [p.sku for p in products if p.sku]
    items = []
    if skus:
        items = list(
            db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku.in_(skus),
                )
            ).all()
        )
    item_by_sku = {it.sku: it for it in items}
    item_ids = [it.id for it in items]

    stock_by_item: dict[int, float] = {}
    warehouse_by_item: dict[int, str] = {}
    if item_ids:
        stock_rows = db.execute(
            select(StockLevel.item_id, func.coalesce(func.sum(StockLevel.quantity), 0)).where(
                StockLevel.item_id.in_(item_ids)
            ).group_by(StockLevel.item_id)
        ).all()
        stock_by_item = {int(iid): float(qty or 0) for iid, qty in stock_rows}

        wh_rows = db.execute(
            select(StockLevel.item_id, Warehouse.name, StockLevel.quantity)
            .join(Warehouse, StockLevel.warehouse_id == Warehouse.id)
            .where(StockLevel.item_id.in_(item_ids))
            .order_by(StockLevel.quantity.desc())
        ).all()
        for iid, name, _qty in wh_rows:
            if int(iid) not in warehouse_by_item and name:
                warehouse_by_item[int(iid)] = name

    default_wh = get_default_warehouse(db, tenant_id)
    default_name = default_wh.name if default_wh else None

    result: dict[int, dict[str, Any]] = {}
    for p in products:
        item = item_by_sku.get(p.sku) if p.sku else None
        if item:
            on_hand = stock_by_item.get(item.id, 0.0)
            reserved = float(item.reserved or 0)
            warehouse = warehouse_by_item.get(item.id) or item.warehouse_name or default_name
        else:
            on_hand = 0.0
            reserved = 0.0
            warehouse = default_name
        result[p.id] = {
            "available_qty": on_hand,
            "reserved_qty": reserved,
            "warehouse": warehouse,
        }
    return result


def _store_kpi_counts(db: Session, tenant_id: int) -> dict[str, int]:
    from app.services.manual_job_card_service import count_manual_sales_job_cards_pending

    rows = db.execute(
        select(SalesOrder.workflow_status, func.count())
        .where(
            SalesOrder.tenant_id == tenant_id,
            SalesOrder.workflow_status.isnot(None),
        )
        .group_by(SalesOrder.workflow_status)
    ).all()
    by_status = {(status or "").upper(): int(cnt) for status, cnt in rows if status}
    store_pending = sum(by_status.get(s, 0) for s in STORE_KPI_BUCKETS["store_pending"])
    ready_to_issue = sum(by_status.get(s, 0) for s in STORE_KPI_BUCKETS["ready_to_issue"])
    partially_issued = sum(by_status.get(s, 0) for s in STORE_KPI_BUCKETS["partially_issued"])
    completed = sum(by_status.get(s, 0) for s in POST_STORE_STATUSES)
    sales_jc_pending = count_manual_sales_job_cards_pending(db, tenant_id)
    store_pending += sales_jc_pending
    total = store_pending + ready_to_issue + partially_issued
    return {
        "total_job_cards": total,
        "store_pending": store_pending,
        "ready_to_issue": ready_to_issue,
        "partially_issued": partially_issued,
        "completed": completed,
        "sales_job_cards_pending": sales_jc_pending,
    }


def serialize_queue_order(
    db: Session,
    so: SalesOrder,
    *,
    job_card: SalesJobCard | None = None,
    material_check: SalesOrderMaterialCheck | None = None,
    assigned_to: str | None = None,
    received_at: str | None = None,
    work_order_id: int | None = None,
    inventory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.workflow_team_service import _material_stock_status

    product_name = None
    product_code = None
    qty = None
    unit = None
    product_id = None
    if so.line_items:
        ln = so.line_items[0]
        qty = float(ln.quantity or 0)
        product_name = ln.item_description
        unit = ln.unit or "Nos"
        product_id = ln.product_id
        if ln.product_id:
            p = db.get(Product, ln.product_id)
            if p:
                product_name = p.name or product_name
                product_code = getattr(p, "sku", None) or getattr(p, "code", None)

    if job_card:
        qty = float(job_card.quantity or qty or 0)
        unit = job_card.unit or unit or "Nos"
        if job_card.product_id:
            product_id = job_card.product_id
            p = db.get(Product, job_card.product_id)
            if p:
                product_name = p.name or product_name
                product_code = getattr(p, "sku", None) or getattr(p, "code", None)

    ws = so.workflow_status
    label = workflow_status_label(ws)
    delivery = (
        job_card.required_delivery_date
        if job_card and job_card.required_delivery_date
        else so.delivery_date
    )

    inv = inventory or {}
    mat = _material_line_totals(material_check)
    required_qty = float(qty or 0)
    available_qty = inv.get("available_qty")
    reserved_qty = float(inv.get("reserved_qty") or 0)
    warehouse = inv.get("warehouse") or mat.get("warehouse")
    if available_qty is None:
        available_qty = mat.get("available_qty")
    if available_qty is None:
        available_qty = 0.0
    net_available = max(0.0, float(available_qty) - reserved_qty)
    shortage_qty = max(0.0, required_qty - net_available)
    if mat.get("shortage_qty") and (available_qty == 0 or product_id is None):
        shortage_qty = float(mat["shortage_qty"])

    queue_prod: dict[str, Any] = {}
    created_by_name = None
    if job_card:
        from app.services.job_card_details import parse_details_json, queue_fields_from_details

        queue_prod = queue_fields_from_details(parse_details_json(job_card.details_json))
        if job_card.created_by_user_id:
            creator = db.get(User, job_card.created_by_user_id)
            created_by_name = creator.full_name if creator else None

    return {
        "sales_order_id": so.id,
        "job_card_id": job_card.id if job_card else None,
        "job_card_no": job_card.job_card_no if job_card else None,
        "job_card_date": job_card.created_at.date().isoformat() if job_card and job_card.created_at else None,
        "order_number": so.order_number,
        "customer_id": so.customer_id,
        "customer_name": so.customer.name if so.customer else None,
        "product_name": product_name,
        "product_code": product_code,
        "product_id": product_id,
        "quantity": qty,
        "unit": unit or "Nos",
        "priority": normalize_priority(job_card.priority if job_card else so.priority),
        "workflow_status": ws,
        "current_stage": ws,
        "status_label": label,
        "status": label,
        "queue_status_label": STORE_QUEUE_STATUS_LABELS.get((ws or "").upper(), label),
        "responsible_role": get_responsible_role(ws),
        "responsible_team": get_responsible_team(ws),
        "delivery_date": delivery.isoformat() if delivery else None,
        "order_date": so.order_date.isoformat() if so.order_date else None,
        "sales_person": so.sales_person,
        "material_stock_status": _material_stock_status(ws, material_check),
        "assigned_to": assigned_to or queue_prod.get("operator_name"),
        "machine_name": queue_prod.get("machine_name"),
        "operator_name": queue_prod.get("operator_name"),
        "planned_qty": queue_prod.get("planned_qty") if queue_prod.get("planned_qty") is not None else qty,
        "output_qty": queue_prod.get("output_qty"),
        "completed_qty": queue_prod.get("output_qty"),
        "created_by": created_by_name,
        "received_at": received_at,
        "work_order_id": work_order_id,
        "warehouse": warehouse,
        "required_qty": required_qty,
        "available_qty": float(available_qty),
        "reserved_qty": reserved_qty,
        "shortage_qty": shortage_qty,
        "allowed_actions": list(QUEUE_ACTIONS_BY_STATUS.get((ws or "").upper(), ["view"])),
        "needed_action": NEEDED_ACTION_BY_STATUS.get((ws or "").upper()),
    }


_STORE_CONTEXT_KEYS = (
    "warehouse",
    "required_qty",
    "available_qty",
    "reserved_qty",
    "shortage_qty",
    "queue_status_label",
    "needed_action",
    "allowed_actions",
    "responsible_role",
    "material_stock_status",
    "order_number",
    "customer_name",
    "product_name",
    "product_code",
    "quantity",
    "unit",
    "delivery_date",
    "order_date",
    "sales_person",
    "priority",
    "workflow_status",
    "sales_order_id",
    "job_card_id",
    "job_card_no",
    "notes",
    "next_stage",
)


def _material_stock_status_label(req: float, avail: float, reserved: float, short: float) -> str:
    net = max(0.0, avail - reserved)
    if short > 0 and net <= 0:
        return "Out of Stock"
    if short > 0:
        return "Shortage"
    if req > 0 and net >= req:
        return "Ready to Issue"
    return "Available"


def serialize_material_requirements(db: Session, mc: SalesOrderMaterialCheck | None) -> list[dict[str, Any]]:
    """BOM/material lines for Store Manager job card detail."""
    if not mc:
        return []

    from app.models.inventory import InventoryItem
    from app.models.product import Product

    materials: list[dict[str, Any]] = []
    for ln in mc.lines or []:
        req = float(ln.required_qty or 0)
        avail = float(ln.available_qty or 0)
        reserved = float(getattr(ln, "_reserved_qty", 0) or 0)
        short = float(ln.shortage_qty or 0)
        code = ""
        if ln.product_id:
            prod = db.get(Product, ln.product_id)
            code = (prod.sku if prod else "") or ""
        elif ln.inventory_item_id:
            item = db.get(InventoryItem, int(ln.inventory_item_id))
            code = (item.sku if item else "") or ""
        stock_status = _material_stock_status_label(req, avail, reserved, short)
        materials.append(
            {
                "id": ln.id,
                "material": ln.material_name,
                "material_name": ln.material_name,
                "material_code": code,
                "required_qty": req,
                "available_qty": avail,
                "reserved_qty": reserved,
                "shortage_qty": short,
                "unit": getattr(ln, "unit", None) or "Nos",
                "stock_status": stock_status,
                "stock_location": ln.stock_location,
            }
        )
    return materials


def build_store_queue_context(
    db: Session,
    tenant_id: int,
    so: SalesOrder,
    *,
    job_card: SalesJobCard | None = None,
    material_check: SalesOrderMaterialCheck | None = None,
    work_order_id: int | None = None,
    refresh_stock: bool = True,
) -> dict[str, Any]:
    """Inventory and store-queue fields for a single sales-order job card."""
    from app.services.workflow_team_service import refresh_pending_material_check_stock

    mc = material_check
    if mc and refresh_stock:
        refresh_pending_material_check_stock(db, tenant_id, mc)

    product_id = job_card.product_id if job_card and job_card.product_id else None
    if product_id is None and so.line_items:
        product_id = so.line_items[0].product_id
    inv_map = _load_product_inventory_map(db, tenant_id, {product_id} if product_id else set())
    row = serialize_queue_order(
        db,
        so,
        job_card=job_card,
        material_check=mc,
        work_order_id=work_order_id,
        inventory=inv_map.get(product_id) if product_id else None,
    )
    ctx = {key: row.get(key) for key in _STORE_CONTEXT_KEYS if key not in {"order_date", "sales_person", "job_card_id", "notes", "next_stage"}}
    ctx["order_date"] = so.order_date.isoformat() if so.order_date else None
    ctx["sales_person"] = so.sales_person
    ctx["job_card_id"] = job_card.id if job_card else row.get("job_card_id")
    ctx["notes"] = mc.notes if mc else None
    ws = (row.get("workflow_status") or "").upper()
    ctx["next_stage"] = (
        "Production Manager"
        if ws in POST_STORE_STATUSES or ws in {"READY_FOR_PRODUCTION", "PRODUCTION_ASSIGNED"}
        else "Production Manager (after store stage)"
    )
    requirements = serialize_material_requirements(db, mc)
    store_card = db.scalars(
        select(WorkflowStageJobCard)
        .options(selectinload(WorkflowStageJobCard.issue_lines))
        .where(
            WorkflowStageJobCard.tenant_id == tenant_id,
            WorkflowStageJobCard.sales_order_id == so.id,
            WorkflowStageJobCard.stage == "store",
        )
    ).first()
    issued_lines = {
        line.material_check_line_id: line
        for line in (store_card.issue_lines if store_card else [])
        if line.material_check_line_id is not None
    }
    materials_issued = bool(store_card and store_card.status == "completed")
    if store_card:
        for material in requirements:
            issue = issued_lines.get(material["id"])
            if issue:
                material["issued_qty"] = float(issue.issued_qty or 0)
                material["remaining_qty"] = float(issue.remaining_qty or 0)
                material["stock_status"] = (
                    "Issued" if issue.issue_status == "issued" else "Partially Issued"
                )
    ctx["materials_issued"] = materials_issued
    ctx["material_requirements"] = requirements
    return ctx


def filter_my_job_card_queue_items(
    items: list[dict[str, Any]],
    *,
    job_card_no: str | None = None,
    customer_id: int | None = None,
    customer_name: str | None = None,
    sales_order_no: str | None = None,
) -> list[dict[str, Any]]:
    """AND semantics across supplied search fields (server-side)."""
    jc_q = (job_card_no or "").strip().lower()
    cust_name_q = (customer_name or "").strip()
    so_q = (sales_order_no or "").strip()
    if not jc_q and not customer_id and not cust_name_q and not so_q:
        return items

    def matches(row: dict[str, Any]) -> bool:
        if jc_q:
            hay = str(row.get("job_card_no") or row.get("order_number") or "").lower()
            if jc_q not in hay:
                return False
        if customer_id is not None:
            row_cid = row.get("customer_id")
            if row_cid is None and cust_name_q:
                if str(row.get("customer_name") or "").strip() != cust_name_q:
                    return False
            elif int(row_cid or 0) != int(customer_id):
                return False
        elif cust_name_q:
            hay = str(row.get("customer_name") or "").strip().lower()
            if cust_name_q.lower() not in hay:
                return False
        if so_q:
            order_no = str(row.get("order_number") or "").strip()
            if so_q.lower() not in order_no.lower():
                return False
        return True

    return [row for row in items if matches(row)]


def get_my_job_card_queue(
    db: Session,
    tenant_id: int,
    user: User,
    *,
    status_filter: str | None = None,
    limit: int = 50,
    strict: bool = True,
    include_completed: bool = True,
    job_card_no: str | None = None,
    customer_id: int | None = None,
    customer_name: str | None = None,
    sales_order_no: str | None = None,
) -> dict[str, Any]:
    """Return job cards actionable by the current user — backend role filtering only."""
    from app.services.workflow_team_service import repair_confirmed_orders_missing_workflow

    teams = user_teams(get_role_names(user))
    is_admin = user_is_admin(user)
    is_store_queue = (
        not is_admin
        and TEAM_INVENTORY in teams
        and TEAM_SALES not in teams
    )
    effective_limit = STORE_QUEUE_MAX_FETCH if is_store_queue else limit

    # Always ensure confirmed sales orders are linked to workflow
    repair_confirmed_orders_missing_workflow(db, tenant_id, user=user)

    metadata = get_queue_metadata_for_user(user)
    allowed = get_actionable_statuses_for_user(user, strict=strict) if not is_admin else set()

    if not strict and not is_admin:
        allowed = get_actionable_statuses_for_user(user, strict=False)

    if status_filter:
        sf = normalize_workflow_status(status_filter) or status_filter.upper()
        if not is_admin and sf not in allowed:
            raise HTTPException(status_code=403, detail="Status not visible to your role")
        allowed = {sf}

    # Operator queue: assignee-scoped via work orders
    if TEAM_OPERATOR in teams and not is_admin and (not status_filter or status_filter.upper() in ACTIONABLE_STATUSES_BY_TEAM[TEAM_OPERATOR]):
        items = _operator_my_queue(db, tenant_id, user, status_filter=status_filter, limit=limit)
        items = filter_my_job_card_queue_items(
            items,
            job_card_no=job_card_no,
            customer_id=customer_id,
            customer_name=customer_name,
            sales_order_no=sales_order_no,
        )
        return {"items": items, "meta": metadata, "total": len(items)}

    orders: list[SalesOrder] = []

    if is_admin and not status_filter:
        q = (
            select(SalesOrder)
            .options(selectinload(SalesOrder.line_items), selectinload(SalesOrder.customer))
            .where(SalesOrder.tenant_id == tenant_id)
        )
        if not include_completed:
            q = q.where(
                or_(
                    SalesOrder.workflow_status.is_(None),
                    SalesOrder.workflow_status != "COMPLETED",
                    SalesOrder.status.in_(["draft", "pending"]),
                )
            )
        orders = list(db.scalars(q.order_by(SalesOrder.id.desc()).limit(effective_limit)).all())
    else:
        if TEAM_SALES in teams and not status_filter:
            draft_q = (
                select(SalesOrder)
                .options(selectinload(SalesOrder.line_items), selectinload(SalesOrder.customer))
                .where(
                    SalesOrder.tenant_id == tenant_id,
                    SalesOrder.status.in_(["draft", "pending"]),
                    SalesOrder.workflow_status.is_(None),
                )
                .order_by(SalesOrder.id.desc())
                .limit(effective_limit)
            )
            draft_orders = list(db.scalars(draft_q).all())
            if strict and TEAM_SALES in teams:
                draft_orders = [o for o in draft_orders if _sales_person_matches(user, o)]
            orders.extend(draft_orders)

        if allowed:
            wf_q = (
                select(SalesOrder)
                .options(selectinload(SalesOrder.line_items), selectinload(SalesOrder.customer))
                .where(
                    SalesOrder.tenant_id == tenant_id,
                    SalesOrder.workflow_status.in_(list(allowed)),
                )
                .order_by(
                    SalesOrder.id.asc() if is_store_queue else SalesOrder.id.desc()
                )
                .limit(effective_limit)
            )
            if TEAM_SALES in teams and strict and "SALES_CONFIRMED" in allowed:
                # Sales sees own confirmed orders when strict
                pass  # filtered below after fetch
            wf_orders = list(db.scalars(wf_q).all())
            if TEAM_SALES in teams and strict:
                wf_orders = [
                    o
                    for o in wf_orders
                    if (o.workflow_status or "").upper() != "SALES_CONFIRMED"
                    or _sales_person_matches(user, o)
                ]
            seen = {o.id for o in orders}
            for o in wf_orders:
                if o.id not in seen:
                    orders.append(o)
                    seen.add(o.id)

        if is_store_queue:
            orders.sort(key=lambda o: o.id)
        else:
            orders.sort(key=lambda o: o.id, reverse=True)
        orders = orders[:effective_limit]

    items = _enrich_queue_orders(db, tenant_id, orders)

    from app.services.manual_job_card_service import (
        list_manual_job_cards,
        list_manual_job_cards_for_recipient,
    )

    manual_dept_by_team = {
        TEAM_INVENTORY: "inventory",
        TEAM_PRODUCTION: "production",
        TEAM_QUALITY: "quality",
        TEAM_BILLING: "billing",
        TEAM_OPERATOR: "operator",
    }

    if is_admin or TEAM_SALES in teams:
        manual_items = list_manual_job_cards(db, tenant_id, limit=effective_limit, user=user)
        seen_jc = {it.get("job_card_id") for it in items if it.get("job_card_id")}
        for row in manual_items:
            if row.get("job_card_id") not in seen_jc:
                items.append(row)
    else:
        for team, dept in manual_dept_by_team.items():
            if team not in teams:
                continue
            if team == TEAM_INVENTORY:
                manual_items = list_manual_job_cards(
                    db,
                    tenant_id,
                    limit=effective_limit,
                    for_store=True,
                    status_filter=status_filter,
                    user=user,
                )
            else:
                manual_items = list_manual_job_cards_for_recipient(
                    db,
                    tenant_id,
                    user,
                    dept=dept,
                    status_filter=status_filter,
                    limit=effective_limit,
                )
            seen_jc = {it.get("job_card_id") for it in items if it.get("job_card_id")}
            for row in manual_items:
                if row.get("job_card_id") not in seen_jc:
                    items.append(row)

    if is_admin or TEAM_SALES in teams or any(t in teams for t in manual_dept_by_team):
        if is_store_queue:
            items.sort(key=_store_queue_sort_key)
        else:
            items.sort(
                key=lambda r: r.get("received_at") or r.get("created_at") or "",
                reverse=True,
            )

    items = filter_my_job_card_queue_items(
        items,
        job_card_no=job_card_no,
        customer_id=customer_id,
        customer_name=customer_name,
        sales_order_no=sales_order_no,
    )

    total = len(items)
    if total > effective_limit:
        items = items[:effective_limit]

    metadata = dict(metadata)
    if TEAM_INVENTORY in teams or is_admin:
        metadata["counts"] = _store_kpi_counts(db, tenant_id)
    if is_store_queue:
        counts = dict(metadata.get("counts") or {})
        counts["actionable_queue_total"] = total
        metadata["counts"] = counts
    return {
        "items": items,
        "meta": metadata,
        "total": total,
        "truncated": total > len(items),
    }


def _operator_my_queue(
    db: Session,
    tenant_id: int,
    user: User,
    *,
    status_filter: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    allowed = set(ACTIONABLE_STATUSES_BY_TEAM[TEAM_OPERATOR])
    if status_filter:
        sf = normalize_workflow_status(status_filter) or status_filter.upper()
        if sf not in allowed:
            raise HTTPException(status_code=403, detail="Status not visible to operator")
        allowed = {sf}

    stmt = (
        select(WorkOrder, SalesOrder, ProductionOrder)
        .join(ProductionOrder, WorkOrder.production_order_id == ProductionOrder.id)
        .join(SalesOrder, ProductionOrder.sales_order_id == SalesOrder.id)
        .options(selectinload(SalesOrder.customer), selectinload(SalesOrder.line_items))
        .where(
            WorkOrder.tenant_id == tenant_id,
            WorkOrder.assigned_user_id == user.id,
            SalesOrder.workflow_status.in_(list(allowed)),
        )
        .order_by(SalesOrder.id.desc())
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    orders = [so for _wo, so, _po in rows]
    wo_map = {so.id: wo for wo, so, _po in rows}
    items = _enrich_queue_orders(db, tenant_id, orders)
    for item in items:
        wo = wo_map.get(item["sales_order_id"])
        if wo:
            item["work_order_id"] = wo.id
            item["work_order_status"] = wo.status
    return items


def _enrich_queue_orders(
    db: Session, tenant_id: int, orders: list[SalesOrder]
) -> list[dict[str, Any]]:
    if not orders:
        return []

    order_ids = [o.id for o in orders]
    jc_map: dict[int, SalesJobCard] = {}
    mc_map: dict[int, SalesOrderMaterialCheck] = {}
    assign_map: dict[int, str | None] = {}

    jcs = list(
        db.scalars(
            select(SalesJobCard).where(
                SalesJobCard.tenant_id == tenant_id,
                SalesJobCard.sales_order_id.in_(order_ids),
            )
        ).all()
    )
    jc_map = {jc.sales_order_id: jc for jc in jcs}

    mcs = list(
        db.scalars(
            select(SalesOrderMaterialCheck)
            .options(selectinload(SalesOrderMaterialCheck.lines))
            .where(
                SalesOrderMaterialCheck.tenant_id == tenant_id,
                SalesOrderMaterialCheck.sales_order_id.in_(order_ids),
            )
        ).all()
    )
    mc_map = {mc.sales_order_id: mc for mc in mcs}

    pos = list(
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.sales_order_id.in_(order_ids),
            )
        ).all()
    )
    if pos:
        po_ids = [po.id for po in pos]
        wos = list(
            db.scalars(
                select(WorkOrder).where(
                    WorkOrder.tenant_id == tenant_id,
                    WorkOrder.production_order_id.in_(po_ids),
                    WorkOrder.assigned_user_id.isnot(None),
                )
            ).all()
        )
        user_ids = {wo.assigned_user_id for wo in wos if wo.assigned_user_id}
        user_names: dict[int, str] = {}
        if user_ids:
            for u in db.scalars(select(User).where(User.id.in_(user_ids))).all():
                user_names[u.id] = u.full_name or u.email or f"User #{u.id}"
        po_by_so = {po.sales_order_id: po.id for po in pos}
        for wo in wos:
            for po in pos:
                if po.id == wo.production_order_id and po.sales_order_id:
                    name = wo.operator_name or user_names.get(wo.assigned_user_id or 0)
                    if name:
                        assign_map[po.sales_order_id] = name

    received_map = _load_received_at_map(db, tenant_id, order_ids)

    product_ids: set[int] = set()
    for so in orders:
        jc = jc_map.get(so.id)
        if jc and jc.product_id:
            product_ids.add(jc.product_id)
        elif so.line_items:
            pid = so.line_items[0].product_id
            if pid:
                product_ids.add(pid)
    inv_map = _load_product_inventory_map(db, tenant_id, product_ids)

    result = []
    for so in orders:
        jc = jc_map.get(so.id)
        pid = jc.product_id if jc and jc.product_id else None
        if pid is None and so.line_items:
            pid = so.line_items[0].product_id
        result.append(
            serialize_queue_order(
                db,
                so,
                job_card=jc,
                material_check=mc_map.get(so.id),
                assigned_to=assign_map.get(so.id),
                received_at=received_map.get(so.id),
                inventory=inv_map.get(pid) if pid else None,
            )
        )
    return result
