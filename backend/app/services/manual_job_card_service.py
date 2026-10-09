"""Manual Sales Job Card — fully user-entered document, no SO/customer/product auto-fill."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.manufacturing_workflow import SalesJobCard
from app.models.product import Product
from app.models.user import User
from app.services.job_card_details import merge_details, parse_details_json, serialize_details_json
from app.services.job_card_service import _generate_job_card_no

logger = logging.getLogger(__name__)

MANUAL_WORKFLOW_DRAFT = "DRAFT"
MANUAL_WORKFLOW_SAVED = "SAVED"
MANUAL_WORKFLOW_RETURNED = "RETURNED_TO_SALES"

SEND_RECIPIENT_ROLES = (
    "Admin",
    "Sales Manager",
    "Production Manager",
    "Store Manager",
    "Purchase Manager",
    "Quality Control",
    "HR Manager",
    "Accountant",
    "Operator",
)

ROLE_SEND_CONFIG: dict[str, dict[str, Any]] = {
    "Admin": {"workflow_stage": "MATERIAL_CHECK_PENDING", "dept": "inventory"},
    "Sales Manager": {"workflow_stage": "SAVED", "dept": "sales"},
    "Production Manager": {"workflow_stage": "READY_FOR_PRODUCTION", "dept": "production"},
    "Store Manager": {"workflow_stage": "MATERIAL_CHECK_PENDING", "dept": "inventory"},
    "Purchase Manager": {"workflow_stage": "MATERIAL_CHECK_PENDING", "dept": "procurement"},
    "Quality Control": {"workflow_stage": "QUALITY_CHECK_PENDING", "dept": "quality"},
    "HR Manager": {"workflow_stage": "SAVED", "dept": "sales"},
    "Accountant": {"workflow_stage": "BILLING_PENDING", "dept": "billing"},
    "Operator": {"workflow_stage": "PRODUCTION_ASSIGNED", "dept": "operator"},
}

STORE_INVENTORY_STATUSES = frozenset({
    "MATERIAL_CHECK_PENDING",
    "MATERIAL_SHORTAGE",
    "MATERIAL_PARTIAL",
    "MATERIAL_AVAILABLE",
    "STORE_ISSUE_PENDING",
    "STORE_ISSUE_PARTIAL",
})


def empty_manual_document() -> dict[str, Any]:
    return {
        "header": {
            "job_card_date": date.today().isoformat(),
            "sales_order_no": "",
            "customer_po_no": "",
        },
        "customer": {
            "customer_name": "",
            "contact_person": "",
            "phone": "",
            "email": "",
            "billing_address": "",
            "dispatch_address": "",
        },
        "order": {
            "sales_order_date": "",
            "delivery_date": "",
            "product_category": "",
            "end_use": "",
            "payment_terms": "",
            "payment_terms_description": "",
            "priority": "medium",
            "remarks": "",
        },
        "product_lines": [],
        "technical_specifications": [],
        "approval": {
            "prepared_by": "",
            "prepared_date": "",
            "checked_by": "",
            "checked_date": "",
            "approved_by": "",
            "approved_date": "",
            "customer_acknowledgement": "",
        },
    }


def _trim(value: Any, max_len: int = 500) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()[:32]
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _recalculate_product_line(row: dict[str, Any]) -> dict[str, Any]:
    qty = _optional_float(row.get("quantity")) or 0.0
    unit_price = _optional_float(row.get("unit_price")) or 0.0
    line_amount = _money(qty * unit_price)
    row["line_amount"] = line_amount
    row["total_amount"] = line_amount
    return row


def _normalize_product_line(row: Any, index: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    qty_val = _optional_float(row.get("quantity"))
    normalized = {
        "sl_no": index + 1,
        "product_id": _optional_int(row.get("product_id")),
        "product_code": _trim(row.get("product_code"), 64),
        "product_name": _trim(row.get("product_name"), 255),
        "quantity": qty_val,
        "uom": _trim(row.get("uom") or row.get("unit"), 32) or "Nos",
        "unit_price": (
            _optional_float(row["unit_price"])
            if "unit_price" in row
            else _optional_float(row.get("price"))
        ),
    }
    return _recalculate_product_line(normalized)


def _validate_manual_product_lines(
    db: Session, tenant_id: int, lines: list[dict[str, Any]]
) -> dict[str, str]:
    errors: dict[str, str] = {}
    seen_product_ids: set[int] = set()
    for i, row in enumerate(lines):
        if not isinstance(row, dict):
            continue
        raw_pid = row.get("product_id")
        resolved_pid = _resolve_product_id_from_line(db, tenant_id, row)
        if raw_pid not in (None, ""):
            try:
                requested_pid = int(raw_pid)
            except (TypeError, ValueError):
                requested_pid = None
            if requested_pid is not None and resolved_pid != requested_pid:
                errors[f"product_lines.{i}.product_id"] = "Product not found or not accessible"
        if resolved_pid:
            if resolved_pid in seen_product_ids:
                errors[f"product_lines.{i}.product_name"] = (
                    "Product already added. Update the quantity instead."
                )
            seen_product_ids.add(resolved_pid)
        unit_price = row.get("unit_price")
        try:
            price_val = float(unit_price) if unit_price not in (None, "") else None
            if price_val is None or price_val < 0:
                errors[f"product_lines.{i}.unit_price"] = "Enter a valid price"
        except (TypeError, ValueError):
            errors[f"product_lines.{i}.unit_price"] = "Enter a valid price"
    return errors


def _normalize_spec_row(row: Any, index: int) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    return {
        "sl_no": index + 1,
        "parameter": _trim(row.get("parameter"), 255),
        "specification": _trim(row.get("specification"), 500),
    }


def merge_manual_document(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    base = empty_manual_document()
    if not isinstance(existing, dict):
        existing = {}
    if not isinstance(patch, dict):
        patch = {}
    src = {**base, **existing}
    for section in ("header", "customer", "order", "approval"):
        if isinstance(patch.get(section), dict):
            src[section] = {**src.get(section, {}), **patch[section]}
    if isinstance(patch.get("product_lines"), list):
        src["product_lines"] = [_normalize_product_line(r, i) for i, r in enumerate(patch["product_lines"])]
    elif isinstance(existing.get("product_lines"), list):
        src["product_lines"] = [_normalize_product_line(r, i) for i, r in enumerate(existing["product_lines"])]
    if isinstance(patch.get("technical_specifications"), list):
        src["technical_specifications"] = [
            _normalize_spec_row(r, i) for i, r in enumerate(patch["technical_specifications"])
        ]
    elif isinstance(existing.get("technical_specifications"), list):
        src["technical_specifications"] = [
            _normalize_spec_row(r, i) for i, r in enumerate(existing["technical_specifications"])
        ]
    return src


def extract_manual_document(details: dict[str, Any]) -> dict[str, Any]:
    doc = details.get("manual_document")
    if isinstance(doc, dict) and doc:
        return merge_manual_document({}, doc)
    return empty_manual_document()


def _empty_store_workflow() -> dict[str, Any]:
    return {
        "routed_at": None,
        "routed_by": None,
        "routed_by_user_id": None,
        "notification_sent": False,
        "acknowledged": False,
        "acknowledged_by": None,
        "acknowledged_by_user_id": None,
        "acknowledged_at": None,
        "store_comments": [],
        "returned_to_sales": False,
        "returned_at": None,
        "returned_by": None,
        "returned_by_user_id": None,
        "return_remarks": None,
    }


def get_store_workflow(details: dict[str, Any]) -> dict[str, Any]:
    sw = details.get("store_workflow")
    if isinstance(sw, dict):
        return {**_empty_store_workflow(), **sw}
    return _empty_store_workflow()


def _get_send_assignments(details: dict[str, Any]) -> list[dict[str, Any]]:
    raw = details.get("send_assignments")
    return list(raw) if isinstance(raw, list) else []


def _get_send_history(details: dict[str, Any]) -> list[dict[str, Any]]:
    raw = details.get("send_history")
    return list(raw) if isinstance(raw, list) else []


def _active_send_assignments(details: dict[str, Any]) -> list[dict[str, Any]]:
    return [a for a in _get_send_assignments(details) if a.get("status") == "active"]


def _manual_is_sent(details: dict[str, Any]) -> bool:
    return len(_active_send_assignments(details)) > 0


def _infer_sender_role(user: User) -> str:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_INVENTORY, TEAM_SALES, user_teams

    if user_is_admin(user):
        return "Admin"
    teams = user_teams(get_role_names(user))
    if TEAM_INVENTORY in teams:
        return "Store Manager"
    if TEAM_SALES in teams:
        return "Sales"
    names = get_role_names(user)
    return names[0] if names else "User"


def _get_material_check(details: dict[str, Any]) -> dict[str, Any]:
    mc = details.get("material_check")
    return mc if isinstance(mc, dict) else {}


def _get_workflow_history(details: dict[str, Any]) -> list[dict[str, Any]]:
    raw = details.get("workflow_history")
    return list(raw) if isinstance(raw, list) else []


def _append_workflow_history(details: dict[str, Any], entry: dict[str, Any]) -> None:
    history = _get_workflow_history(details)
    history.append(entry)
    details["workflow_history"] = history


def _material_check_completed(details: dict[str, Any]) -> bool:
    mc = _get_material_check(details)
    return bool(mc.get("checked_at")) and mc.get("status") in ("available", "shortage", "partial")


def _can_send_manual(
    jc: SalesJobCard,
    details: dict[str, Any],
    user: User | None = None,
) -> bool:
    if jc.status != "created":
        return False
    ws = (jc.workflow_stage or "").upper()

    if user is not None:
        from app.core.permissions import get_role_names, user_has_permission, user_is_admin
        from app.core.workflow_constants import TEAM_INVENTORY, TEAM_SALES, user_teams

        teams = user_teams(get_role_names(user))
        is_store = (
            user_is_admin(user)
            or TEAM_INVENTORY in teams
            or user_has_permission(user, "inventory")
        )
        is_sales = (
            user_is_admin(user)
            or TEAM_SALES in teams
            or user_has_permission(user, "sales")
        )

        if is_store and ws in STORE_INVENTORY_STATUSES:
            return _material_check_completed(details)

        if is_sales:
            if ws in (MANUAL_WORKFLOW_SAVED, MANUAL_WORKFLOW_RETURNED):
                return True
            if ws in STORE_INVENTORY_STATUSES:
                return False
            if not ws or ws == MANUAL_WORKFLOW_DRAFT:
                return not _manual_is_sent(details)
            return not _manual_is_sent(details)

    if _manual_is_sent(details):
        return False
    if ws in (MANUAL_WORKFLOW_SAVED, MANUAL_WORKFLOW_RETURNED):
        return True
    if ws in STORE_INVENTORY_STATUSES:
        return False
    if not ws or ws == MANUAL_WORKFLOW_DRAFT:
        return True
    return False


def _user_matches_send_role(user: User, role_name: str) -> bool:
    from app.core.permissions import get_role_names

    target = role_name.strip().lower().replace("_", " ")
    roles = [str(r or "").strip() for r in get_role_names(user)]
    normalized = {r.lower().replace("_", " ") for r in roles if r}
    if target in normalized:
        return True
    if role_name == "Quality Control":
        return bool(
            normalized
            & {
                "quality control",
                "quality manager",
                "quality inspector",
                "qa",
                "qc",
            }
        )
    if role_name == "Admin":
        return "admin" in normalized
    return False


def list_send_recipient_users(
    db: Session,
    tenant_id: int,
    role_name: str,
) -> list[dict[str, Any]]:
    """Active users in the tenant eligible to receive a manual job card for a role."""
    from app.core.permissions import get_role_names

    role = _trim(role_name, 64)
    if role not in SEND_RECIPIENT_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid recipient role: {role}")

    users = db.scalars(
        select(User)
        .where(User.tenant_id == tenant_id, User.is_active.is_(True))
        .options(selectinload(User.roles))
        .order_by(User.full_name)
    ).all()

    items: list[dict[str, Any]] = []
    for user in users:
        if not _user_matches_send_role(user, role):
            continue
        names = get_role_names(user)
        items.append(
            {
                "id": user.id,
                "full_name": user.full_name or "",
                "email": user.email or "",
                "roles": names,
                "primary_role": names[0] if names else role,
            }
        )
    return items


def _format_sent_to(details: dict[str, Any]) -> str | None:
    active = _active_send_assignments(details)
    if not active:
        return None
    return "; ".join(
        f"{a.get('recipient_role')} - {a.get('recipient_name')}"
        for a in active
        if a.get("recipient_name") or a.get("recipient_role")
    )


def _sales_queue_status_label(jc: SalesJobCard, details: dict[str, Any], store_wf: dict[str, Any]) -> str:
    ws = (jc.workflow_stage or "").upper()
    if ws == MANUAL_WORKFLOW_RETURNED:
        return "Returned to Sales"
    if ws == MANUAL_WORKFLOW_SAVED:
        return "Saved"
    if _manual_is_sent(details):
        return "Sent"
    if ws == MANUAL_WORKFLOW_DRAFT or jc.status == "draft":
        return "Draft"
    return manual_queue_status_label(jc, store_wf, for_recipient=True)


def manual_queue_status_label(
    jc: SalesJobCard,
    store_wf: dict[str, Any] | None = None,
    *,
    for_recipient: bool = False,
) -> str:
    from app.services.workflow_routing_service import STORE_QUEUE_STATUS_LABELS

    sw = store_wf or {}
    ws = (jc.workflow_stage or "").upper()
    if ws == MANUAL_WORKFLOW_RETURNED:
        return "Returned to Sales"
    if ws == MANUAL_WORKFLOW_SAVED:
        return "Saved"
    if ws == MANUAL_WORKFLOW_DRAFT or jc.status == "draft":
        return "Draft"
    if ws == "MATERIAL_CHECK_PENDING":
        if sw.get("acknowledged"):
            return "Store Reviewed"
        return "Pending Store Review"
    if ws == "MATERIAL_AVAILABLE":
        return "Materials Confirmed"
    if ws == "MATERIAL_SHORTAGE":
        return "Material Shortage"
    if ws == "MATERIAL_PARTIAL":
        return "Partially Available"
    if ws == "READY_FOR_PRODUCTION":
        return "Ready for Production"
    if not for_recipient and ws not in (MANUAL_WORKFLOW_SAVED, MANUAL_WORKFLOW_DRAFT):
        return "Sent"
    return STORE_QUEUE_STATUS_LABELS.get(ws, ws.replace("_", " ").title() if ws else "—")


def build_material_requirements_preview(doc: dict[str, Any]) -> list[dict[str, Any]]:
    lines = doc.get("product_lines") or []
    specs = doc.get("technical_specifications") or []
    requirements: list[dict[str, Any]] = []
    for i, row in enumerate(lines):
        requirements.append({
            "line_no": i + 1,
            "product_code": row.get("product_code"),
            "product_name": row.get("product_name"),
            "description": row.get("description"),
            "quantity": row.get("quantity"),
            "uom": row.get("uom"),
            "specifications": specs,
        })
    return requirements


def _resolve_product_id_from_line(
    db: Session, tenant_id: int, line: dict[str, Any]
) -> int | None:
    raw_pid = line.get("product_id")
    if raw_pid not in (None, ""):
        try:
            pid = int(raw_pid)
            product = db.get(Product, pid)
            if product and product.tenant_id == tenant_id:
                return pid
        except (TypeError, ValueError):
            pass

    code = _trim(line.get("product_code"), 120)
    name = _trim(line.get("product_name"), 200)
    if code:
        match = db.scalars(
            select(Product).where(
                Product.tenant_id == tenant_id,
                func.lower(Product.sku) == code.lower(),
            )
        ).first()
        if match:
            return match.id
        # When explicit product_code is provided, do not fall back to matching by name
        # so we never pull a different product's BOM by mistake.
        return None

    if name:
        match = db.scalars(
            select(Product).where(
                Product.tenant_id == tenant_id,
                func.lower(Product.name) == name.lower(),
            )
        ).first()
        if match:
            return match.id
    return None


def _line_availability_status(required: float, available: float, shortage: float) -> str:
    if shortage <= 0:
        return "available"
    if available <= 0:
        return "not_available"
    return "partially_available"


def build_manual_bom_material_lines(
    db: Session, tenant_id: int, doc: dict[str, Any]
) -> list[dict[str, Any]]:
    """Explode BOM for manual job card product lines and read live inventory stock."""
    from app.services.inventory_service import get_total_stock
    from app.services.manufacturing_workflow_service import get_bom_requirements

    product_lines = doc.get("product_lines") or []
    lines: list[dict[str, Any]] = []

    for pl in product_lines:
        code = _trim(pl.get("product_code"), 120)
        name = _trim(pl.get("product_name"), 200)
        try:
            order_qty = float(pl.get("quantity") or 0)
        except (TypeError, ValueError):
            order_qty = 0.0
        if order_qty <= 0:
            continue

        product_id = _resolve_product_id_from_line(db, tenant_id, pl)
        product = db.get(Product, product_id) if product_id else None

        bom_reqs = get_bom_requirements(db, tenant_id, product_id, order_qty) if product_id else []
        if not bom_reqs:
            mat_code = code or (product.sku if product else "")
            mat_name = name or (product.name if product else "Product")
            uom = pl.get("uom") or (product.unit if product else "Nos")

            item_id = None
            available = 0.0
            if product:
                from app.services.manufacturing_workflow_service import (
                    find_or_create_inventory_item_for_product,
                )

                item = find_or_create_inventory_item_for_product(
                    db, tenant_id, product, item_type="finished_goods"
                )
                item_id = item.id
                available = float(get_total_stock(db, item.id, tenant_id))

            required = order_qty
            shortage = max(0.0, required - available)
            line_id = f"pl-{pl.get('sl_no') or len(lines) + 1}"
            lines.append({
                "line_id": line_id,
                "material_code": mat_code,
                "material_name": mat_name,
                "inventory_item_id": item_id,
                "component_product_id": product_id,
                "required_qty": round(required, 4),
                "available_qty": round(available, 4),
                "shortage_qty": round(shortage, 4),
                "uom": uom,
                "availability_status": _line_availability_status(required, available, shortage),
                "remarks": "",
                "product_line_no": pl.get("sl_no"),
            })
            continue

        for req in bom_reqs:
            item_id = req.get("item_id")
            comp_id = req.get("component_product_id")
            mat_code = (req.get("sku") or req.get("material_code") or req.get("code") or code or (product.sku if product else "") or "").strip()
            mat_name = (req.get("component_name") or name or "Material").strip()
            required = float(req.get("required_qty") or 0)
            available = float(req.get("available_qty") or 0)
            if item_id and available == 0:
                available = float(get_total_stock(db, int(item_id), tenant_id))
            shortage = max(0.0, required - available)
            line_id = f"bom-{len(lines) + 1}"
            lines.append({
                "line_id": line_id,
                "material_code": mat_code,
                "material_name": mat_name,
                "inventory_item_id": item_id,
                "component_product_id": comp_id,
                "required_qty": round(required, 4),
                "available_qty": round(available, 4),
                "shortage_qty": round(shortage, 4),
                "uom": req.get("unit") or pl.get("uom") or "Nos",
                "availability_status": _line_availability_status(required, available, shortage),
                "remarks": "",
                "product_line_no": pl.get("sl_no"),
            })

    return lines


def _derive_material_check_status(lines: list[dict[str, Any]]) -> tuple[str, str]:
    if not lines:
        return "available", "MATERIAL_AVAILABLE"
    all_available = all(float(ln.get("shortage_qty") or 0) <= 0 for ln in lines)
    any_available = any(float(ln.get("available_qty") or 0) > 0 for ln in lines)
    any_shortage = any(float(ln.get("shortage_qty") or 0) > 0 for ln in lines)
    if all_available:
        return "available", "MATERIAL_AVAILABLE"
    if any_available and any_shortage:
        return "partial", "MATERIAL_PARTIAL"
    return "shortage", "MATERIAL_SHORTAGE"


def get_manual_material_check(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
) -> dict[str, Any]:
    from app.core.permissions import user_has_permission, user_is_admin

    can_inventory = user_is_admin(user) or user_has_permission(user, "inventory")
    can_production = user_is_admin(user) or user_has_permission(user, "production")
    if not can_inventory and not can_production:
        raise HTTPException(status_code=403, detail="Permission required to view material check.")

    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    ws = (jc.workflow_stage or "").upper()
    if ws not in STORE_INVENTORY_STATUSES and ws != "READY_FOR_PRODUCTION":
        raise HTTPException(
            status_code=400,
            detail="Material check is only available after the job card is sent to Store.",
        )

    details = parse_details_json(jc.details_json)
    doc = extract_manual_document(details)
    saved = _get_material_check(details)
    if saved.get("checked_at") and saved.get("lines"):
        lines = list(saved.get("lines") or [])
        status = saved.get("status") or "available"
        workflow_status = saved.get("workflow_status") or jc.workflow_stage
    else:
        lines = build_manual_bom_material_lines(db, tenant_id, doc)
        status, workflow_status = _derive_material_check_status(lines)

    return {
        "job_card_id": jc.id,
        "job_card_no": jc.job_card_no,
        "workflow_status": jc.workflow_stage,
        "lines": lines,
        "saved_check": saved if saved.get("checked_at") else None,
        "preview_status": status,
        "preview_workflow_status": workflow_status,
        "all_available": status == "available",
        "read_only": not can_inventory,
    }


def submit_manual_material_check(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
    payload: dict[str, Any],
) -> dict[str, Any]:
    from app.core.permissions import user_has_permission, user_is_admin

    if not user_is_admin(user) and not user_has_permission(user, "inventory"):
        raise HTTPException(status_code=403, detail="Store Manager permission required")

    from app.core.concurrency import assert_expected_record_version, bump_record_version, raise_conflict

    jc = _get_manual_job_card_for_update(db, tenant_id, job_card_id)
    if not _manual_in_store_workflow(jc):
        raise HTTPException(
            status_code=400,
            detail="Material check is only available after the job card is sent to Store.",
        )

    details = parse_details_json(jc.details_json)
    assert_expected_record_version(
        details,
        payload.get("expected_version") if isinstance(payload, dict) else None,
    )
    existing_check = details.get("material_check") if isinstance(details.get("material_check"), dict) else {}
    if existing_check.get("checked_at"):
        raise_conflict(
            "Job card material check was already submitted by another user. Please refresh and try again."
        )
    doc = extract_manual_document(details)
    lines = build_manual_bom_material_lines(db, tenant_id, doc)
    if not lines:
        raise HTTPException(
            status_code=422,
            detail="No materials could be resolved for this job card. Link products with BOM or inventory.",
        )

    line_updates = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    update_map: dict[str, dict[str, Any]] = {}
    for idx, u in enumerate(line_updates):
        if not isinstance(u, dict):
            continue
        if u.get("line_id"):
            update_map[str(u["line_id"])] = u
        if u.get("material_code"):
            update_map[str(u["material_code"])] = u
        update_map[f"idx-{idx}"] = u

    for idx, ln in enumerate(lines):
        upd = (
            update_map.get(str(ln.get("line_id")))
            or update_map.get(str(ln.get("material_code")))
            or update_map.get(f"idx-{idx}")
        )
        if upd:
            if upd.get("remarks"):
                ln["remarks"] = _trim(upd.get("remarks"), 500)
            if "available_qty" in upd and upd["available_qty"] is not None:
                try:
                    avail = max(0.0, float(upd["available_qty"]))
                    req = float(ln.get("required_qty") or 0.0)
                    ln["available_qty"] = avail
                    shortage = max(0.0, req - avail)
                    ln["shortage_qty"] = shortage
                    if shortage <= 0:
                        ln["availability_status"] = "available"
                    elif avail > 0:
                        ln["availability_status"] = "partially_available"
                    else:
                        ln["availability_status"] = "not_available"
                except (ValueError, TypeError):
                    pass

    materials_available = payload.get("materials_available")
    reason = _trim(payload.get("reason"), 2000)
    remarks = _trim(payload.get("remarks"), 2000)
    auto_status, auto_ws = _derive_material_check_status(lines)

    if materials_available is True:
        if auto_status != "available":
            raise HTTPException(
                status_code=422,
                detail="Cannot confirm all materials available while shortages exist in inventory.",
            )
        status, target_ws = "available", "MATERIAL_AVAILABLE"
    elif materials_available is False:
        if not reason:
            raise HTTPException(
                status_code=422,
                detail="Please provide the reason for material unavailability.",
            )
        status, target_ws = auto_status, auto_ws
    else:
        status, target_ws = auto_status, auto_ws
        if status != "available" and not reason:
            raise HTTPException(
                status_code=422,
                detail="Please provide the reason for material unavailability.",
            )

    now = datetime.now(timezone.utc).isoformat()
    material_check = {
        "status": status,
        "workflow_status": target_ws,
        "lines": lines,
        "overall_available": status == "available",
        "reason": reason,
        "remarks": remarks,
        "checked_by": user.full_name or "",
        "checked_by_user_id": user.id,
        "checked_at": now,
    }
    details["material_check"] = material_check
    jc.workflow_stage = target_ws

    status_label = {
        "available": "Materials Confirmed",
        "shortage": "Material Shortage",
        "partial": "Partially Available",
    }.get(status, status)

    _append_workflow_history(
        details,
        {
            "action": "material_check",
            "from_user_id": user.id,
            "from_name": user.full_name or "",
            "from_role": "Store Manager",
            "to_role": "Store Manager",
            "status": status_label,
            "workflow_status": target_ws,
            "comments": reason or remarks or "",
            "at": now,
        },
    )

    bump_record_version(details)
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)
    return build_manual_job_card_response(db, jc, user=user, store_perspective=True)


def _users_for_roles(db: Session, tenant_id: int, role_names: list[str]) -> list[int]:
    from app.models.role import Role
    from app.models.user import user_roles

    rows = db.scalars(
        select(User.id)
        .join(user_roles, User.id == user_roles.c.user_id)
        .join(Role, Role.id == user_roles.c.role_id)
        .where(
            User.tenant_id == tenant_id,
            User.is_active.is_(True),
            Role.name.in_(role_names),
        )
        .distinct()
    ).all()
    return list(rows)


def _notify_store_managers_manual(
    db: Session,
    tenant_id: int,
    jc: SalesJobCard,
    doc: dict[str, Any],
    actor: User,
) -> None:
    from app.core.workflow_constants import STATUS_NOTIFY_ROLES, normalize_priority
    from app.services.notification_management_service import NotificationManagementService

    role_names = STATUS_NOTIFY_ROLES.get("MATERIAL_CHECK_PENDING", ["Store Manager", "Admin"])
    user_ids = _users_for_roles(db, tenant_id, role_names)
    if actor:
        user_ids = [uid for uid in user_ids if uid != actor.id]
    if not user_ids:
        return

    customer = (doc.get("customer") or {}).get("customer_name") or "Customer"
    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    product = first.get("product_name") or "Product"
    qty = first.get("quantity") or jc.quantity
    uom = first.get("uom") or jc.unit or "Nos"
    title = "New Sales Job Card Received"
    message = (
        f"Job Card: {jc.job_card_no}\n"
        f"Customer: {customer}\n"
        f"Product: {product}\n"
        f"Quantity: {qty:,} {uom}"
    )
    action_url = f"/my-job-cards?dept=inventory&jc={jc.id}"
    priority = normalize_priority(jc.priority)

    for uid in user_ids:
        try:
            NotificationManagementService.create_for_user(
                db,
                tenant_id=tenant_id,
                user_id=uid,
                title=title,
                message=message,
                type="production",
                priority=priority,
                module="production",
                action_url=action_url,
                created_by=actor.full_name if actor else "System",
                created_by_user_id=actor.id if actor else None,
                commit=False,
            )
        except Exception as exc:
            logger.exception(
                "Manual job card store notification failed user_id=%s jc_id=%s: %s",
                uid,
                jc.id,
                exc,
            )


def _notify_job_card_recipient(
    db: Session,
    tenant_id: int,
    jc: SalesJobCard,
    doc: dict[str, Any],
    actor: User,
    recipient: User,
    role: str,
    dept: str,
) -> None:
    from app.core.workflow_constants import normalize_priority
    from app.services.notification_management_service import NotificationManagementService

    customer = (doc.get("customer") or {}).get("customer_name") or "Customer"
    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    product = first.get("product_name") or "Product"
    sender = actor.full_name or "Sales"
    title = "New Sales Job Card Received"
    message = (
        f"Job Card: {jc.job_card_no}\n"
        f"Customer: {customer}\n"
        f"Product: {product}\n"
        f"Sent By: {sender}"
    )
    action_url = f"/my-job-cards?dept={dept}&jc={jc.id}"
    priority = normalize_priority(jc.priority)

    try:
        NotificationManagementService.create_for_user(
            db,
            tenant_id=tenant_id,
            user_id=recipient.id,
            title=title,
            message=message,
            type="production",
            priority=priority,
            module="production",
            action_url=action_url,
            created_by=sender,
            created_by_user_id=actor.id,
            commit=False,
        )
    except Exception as exc:
        logger.exception(
            "Manual job card send notification failed user_id=%s jc_id=%s role=%s: %s",
            recipient.id,
            jc.id,
            role,
            exc,
        )


def send_manual_job_card(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
    recipients: list[dict[str, Any]],
) -> dict[str, Any]:
    """Explicitly send a saved manual job card to selected users (never on save)."""
    from app.core.permissions import user_has_permission, user_is_admin

    can_sales = user_is_admin(user) or user_has_permission(user, "sales")
    can_store = user_is_admin(user) or user_has_permission(user, "inventory")
    if not can_sales and not can_store:
        raise HTTPException(status_code=403, detail="Permission required to send job cards.")

    if not recipients:
        raise HTTPException(status_code=422, detail="Please select at least one recipient.")

    from app.core.concurrency import bump_record_version, raise_conflict

    jc = _get_manual_job_card_for_update(db, tenant_id, job_card_id)
    details = parse_details_json(jc.details_json)

    if not _can_send_manual(jc, details, user=user):
        raise_conflict(
            "Job card was updated by another user. Please refresh and try again."
        )

    doc = extract_manual_document(details)
    assignments = _get_send_assignments(details)
    history = _get_send_history(details)
    active_user_ids = {
        int(a["recipient_user_id"])
        for a in assignments
        if a.get("status") == "active" and a.get("recipient_user_id") is not None
    }

    now = datetime.now(timezone.utc).isoformat()
    new_assignments: list[dict[str, Any]] = []
    seen_users: set[int] = set()

    for rec in recipients:
        role = _trim(rec.get("role"), 64)
        if role not in ROLE_SEND_CONFIG:
            raise HTTPException(status_code=422, detail=f"Invalid recipient role: {role}")

        try:
            uid = int(rec.get("user_id"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid recipient user.")

        if uid in seen_users:
            continue
        seen_users.add(uid)

        if uid in active_user_ids:
            continue

        recipient = db.get(User, uid)
        if not recipient or recipient.tenant_id != tenant_id or not recipient.is_active:
            raise HTTPException(status_code=400, detail="Recipient user is not available.")

        if not _user_matches_send_role(recipient, role):
            raise HTTPException(
                status_code=400,
                detail=f"Selected user does not have the {role} role.",
            )

        cfg = ROLE_SEND_CONFIG[role]
        assignment = {
            "id": f"{jc.id}-{uid}-{int(datetime.now(timezone.utc).timestamp())}",
            "recipient_user_id": uid,
            "recipient_name": recipient.full_name or recipient.email or "",
            "recipient_role": role,
            "sent_by_user_id": user.id,
            "sent_by_name": user.full_name or "",
            "sent_at": now,
            "workflow_stage": cfg["workflow_stage"],
            "dept": cfg["dept"],
            "status": "active",
        }
        new_assignments.append(assignment)
        _notify_job_card_recipient(
            db, tenant_id, jc, doc, user, recipient, role, cfg["dept"]
        )

    if not new_assignments:
        raise_conflict(
            "No new recipients to send to. This job card may already be assigned to the selected users."
        )

    forwarding_to_production = any(
        a.get("recipient_role") == "Production Manager" for a in new_assignments
    )
    if forwarding_to_production:
        for assignment in assignments:
            if assignment.get("status") == "active" and assignment.get("dept") == "inventory":
                assignment["status"] = "forwarded"

    assignments.extend(new_assignments)
    history.extend(new_assignments)
    details["send_assignments"] = assignments
    details["send_history"] = history

    primary = new_assignments[0]
    jc.workflow_stage = primary["workflow_stage"]

    for assignment in new_assignments:
        _append_workflow_history(
            details,
            {
                "action": "sent",
                "from_user_id": user.id,
                "from_name": user.full_name or "",
                "from_role": _infer_sender_role(user),
                "to_user_id": assignment.get("recipient_user_id"),
                "to_name": assignment.get("recipient_name"),
                "to_role": assignment.get("recipient_role"),
                "status": primary["workflow_stage"],
                "workflow_status": primary["workflow_stage"],
                "comments": "",
                "at": assignment.get("sent_at"),
            },
        )

    if primary["workflow_stage"] == "MATERIAL_CHECK_PENDING":
        store_wf = get_store_workflow(details)
        store_wf["routed_at"] = now
        store_wf["routed_by"] = user.full_name or ""
        store_wf["routed_by_user_id"] = user.id
        store_wf["target_recipient_user_id"] = primary["recipient_user_id"]
        store_wf["notification_sent"] = True
        store_wf["returned_to_sales"] = False
        store_wf["return_remarks"] = None
        details["store_workflow"] = store_wf

    bump_record_version(details)
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)
    return build_manual_job_card_response(db, jc, user=user)


def _manual_in_store_workflow(jc: SalesJobCard) -> bool:
    ws = (jc.workflow_stage or "").upper()
    return ws in STORE_INVENTORY_STATUSES


def _manual_visible_to_recipient(
    details: dict[str, Any],
    user_id: int,
    *,
    dept: str | None = None,
) -> bool:
    for assignment in _active_send_assignments(details):
        if int(assignment.get("recipient_user_id") or 0) != int(user_id):
            continue
        if dept and assignment.get("dept") != dept:
            continue
        return True
    return False


def _store_allowed_actions(
    jc: SalesJobCard,
    store_wf: dict[str, Any],
    user: User | None,
    details: dict[str, Any] | None = None,
) -> list[str]:
    from app.core.permissions import get_role_names, user_has_permission, user_is_admin
    from app.core.workflow_constants import TEAM_INVENTORY, TEAM_SALES, user_teams

    if not user:
        return ["view"]
    details = details or {}
    teams = user_teams(get_role_names(user))
    is_admin = user_is_admin(user)
    can_sales = is_admin or TEAM_SALES in teams or user_has_permission(user, "sales")
    ws = (jc.workflow_stage or "").upper()
    actions: list[str] = ["view"]

    if TEAM_INVENTORY in teams or is_admin:
        if ws in STORE_INVENTORY_STATUSES:
            if not store_wf.get("acknowledged"):
                actions.append("acknowledge")
            actions.extend([
                "material_check",
                "check_inventory",
                "view_material_requirement",
                "add_store_comments",
                "return_to_sales",
            ])
            if store_wf.get("acknowledged"):
                actions.append("mark_reviewed")
            if _can_send_manual(jc, details, user=user):
                actions.append("send")

    if can_sales:
        if _can_send_manual(jc, details, user=user):
            actions.append("send")
        if not _manual_in_store_workflow(jc) or ws == MANUAL_WORKFLOW_RETURNED:
            actions.append("edit")
        actions.append("delete")

    return list(dict.fromkeys(actions))


def validate_manual_document(doc: dict[str, Any], *, finalize: bool = True) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not finalize:
        return errors

    header = doc.get("header") or {}
    customer = doc.get("customer") or {}
    order = doc.get("order") or {}
    lines = doc.get("product_lines") or []

    if not _trim(header.get("job_card_date")):
        errors["header.job_card_date"] = "Date is required"
    if not _trim(header.get("sales_order_no")):
        errors["header.sales_order_no"] = "Sales Order No. is required"
    if not _trim(customer.get("customer_name")):
        errors["customer.customer_name"] = "Customer Name is required"

    email = _trim(customer.get("email"))
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        errors["customer.email"] = "Enter a valid email address"

    phone = _trim(customer.get("phone"))
    if phone and not re.match(r"^[\d\s+\-()]{6,20}$", phone):
        errors["customer.phone"] = "Enter a valid phone number"

    so_date = _parse_date(order.get("sales_order_date"))
    delivery = _parse_date(order.get("delivery_date"))
    if so_date and delivery and delivery < so_date:
        errors["order.delivery_date"] = "Delivery Date must be on or after Sales Order Date"

    if not lines:
        errors["product_lines"] = "At least one product row is required"
    else:
        for i, row in enumerate(lines):
            if not _trim(row.get("product_name")):
                errors[f"product_lines.{i}.product_name"] = "Product Name is required"
            qty = row.get("quantity")
            try:
                n = float(qty)
                if n <= 0:
                    errors[f"product_lines.{i}.quantity"] = "Quantity must be greater than 0"
            except (TypeError, ValueError):
                errors[f"product_lines.{i}.quantity"] = "Quantity must be greater than 0"
            if not _trim(row.get("uom")):
                errors[f"product_lines.{i}.uom"] = "UOM is required"
            unit_price = row.get("unit_price")
            try:
                price_val = float(unit_price) if unit_price not in (None, "") else None
                if price_val is None or price_val < 0:
                    errors[f"product_lines.{i}.unit_price"] = "Enter a valid price"
            except (TypeError, ValueError):
                errors[f"product_lines.{i}.unit_price"] = "Enter a valid price"

    return errors


def build_manual_sales_document(jc: SalesJobCard, doc: dict[str, Any]) -> dict[str, Any]:
    header = doc.get("header") or {}
    customer = doc.get("customer") or {}
    order = doc.get("order") or {}
    lines = doc.get("product_lines") or []
    specs = doc.get("technical_specifications") or []
    approval = doc.get("approval") or {}

    jc_date = header.get("job_card_date") or (
        jc.created_at.date().isoformat() if jc.created_at else date.today().isoformat()
    )
    status_label = "Created" if jc.status == "created" else "Draft"

    return {
        "header": {
            "job_card_no": jc.job_card_no,
            "job_card_date": jc_date,
            "sales_order_no": header.get("sales_order_no"),
            "customer_po_no": header.get("customer_po_no"),
            "status": status_label,
            "workflow_status": jc.workflow_stage or "MANUAL",
        },
        "customer_details": {
            "customer_name": customer.get("customer_name"),
            "contact_person": customer.get("contact_person"),
            "phone": customer.get("phone"),
            "email": customer.get("email"),
            "billing_address": customer.get("billing_address"),
            "dispatch_address": customer.get("dispatch_address"),
        },
        "order_details": {
            "sales_order_date": order.get("sales_order_date"),
            "delivery_date": order.get("delivery_date") or (
                jc.required_delivery_date.isoformat() if jc.required_delivery_date else None
            ),
            "product_category": order.get("product_category"),
            "end_use": order.get("end_use"),
            "payment_terms": order.get("payment_terms"),
            "payment_terms_description": order.get("payment_terms_description"),
            "priority": order.get("priority") or jc.priority,
            "remarks": order.get("remarks") or jc.notes,
            "sales_person": jc.sales_person_name,
        },
        "product_lines": lines,
        "technical_specifications": specs,
        "approval": approval,
    }


def _summary_from_doc(jc: SalesJobCard, doc: dict[str, Any]) -> dict[str, Any]:
    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    total_qty = sum(float(ln.get("quantity") or 0) for ln in lines)
    customer = doc.get("customer") or {}
    header = doc.get("header") or {}
    order = doc.get("order") or {}
    return {
        "job_card_no": jc.job_card_no,
        "sales_order_no": header.get("sales_order_no"),
        "customer": customer.get("customer_name"),
        "product": first.get("product_name"),
        "order_quantity": total_qty or jc.quantity,
        "required_delivery": order.get("delivery_date"),
        "priority": order.get("priority") or jc.priority,
        "uom": first.get("uom") or jc.unit,
        "workflow_status": jc.workflow_stage or "MANUAL",
    }


def build_manual_job_card_response(
    db: Session,
    jc: SalesJobCard,
    user: User | None = None,
    *,
    store_perspective: bool = False,
) -> dict[str, Any]:
    details = parse_details_json(jc.details_json)
    doc = extract_manual_document(details)
    store_wf = get_store_workflow(details)
    sales_document = build_manual_sales_document(jc, doc)
    creator_name = None
    if jc.created_by_user_id:
        creator = db.get(User, jc.created_by_user_id)
        creator_name = creator.full_name if creator else None

    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    ws = jc.workflow_stage or MANUAL_WORKFLOW_DRAFT
    in_store = _manual_in_store_workflow(jc)
    if in_store and store_perspective:
        queue_label = manual_queue_status_label(jc, store_wf)
    else:
        queue_label = _sales_queue_status_label(jc, details, store_wf)
    allowed = _store_allowed_actions(jc, store_wf, user, details)
    editable = ["sales"]
    if in_store:
        editable = []
    active_assignments = _active_send_assignments(details)
    primary_assignment = active_assignments[0] if active_assignments else None

    return {
        "id": jc.id,
        "job_card_id": jc.id,
        "version": int(getattr(jc, "version", 1) or 1),
        "is_manual": True,
        "sales_order_id": None,
        "job_card_no": jc.job_card_no,
        "job_card_created": jc.status == "created",
        "status": jc.status,
        "workflow_status": ws,
        "workflow_stage": queue_label,
        "queue_status_label": queue_label,
        "priority": jc.priority,
        "sales_document": sales_document,
        "manual_document": doc,
        "details": details,
        "store_workflow": store_wf,
        "material_requirements": build_material_requirements_preview(doc),
        "material_check": _get_material_check(details),
        "workflow_history": _get_workflow_history(details),
        "summary_panel": _summary_from_doc(jc, doc),
        "form": {
            "job_card_id": jc.id,
            "job_card_no": jc.job_card_no,
            "is_manual": True,
            "is_created": jc.status == "created",
            "notes": jc.notes or "",
            "priority": jc.priority,
            "quantity": float(jc.quantity or 0),
            "unit": jc.unit,
            "required_delivery_date": (
                jc.required_delivery_date.isoformat() if jc.required_delivery_date else None
            ),
        },
        "audit": {
            "created_by": creator_name,
            "created_by_id": jc.created_by_user_id,
            "created_at": jc.created_at.isoformat() if jc.created_at else None,
            "updated_at": jc.updated_at.isoformat() if jc.updated_at else None,
            "reviewed_by": store_wf.get("acknowledged_by"),
            "reviewed_at": store_wf.get("acknowledged_at"),
        },
        "editable_sections": editable,
        "read_only_sales": in_store,
        "allowed_actions": allowed,
        "can_send": _can_send_manual(jc, details, user=user),
        "sent_to": _format_sent_to(details),
        "sent_by": primary_assignment.get("sent_by_name") if primary_assignment else None,
        "sent_at": primary_assignment.get("sent_at") if primary_assignment else None,
        "send_history": _get_send_history(details),
        "send_assignments": _get_send_assignments(details),
        "responsible_role": "Store Manager" if in_store else "Sales",
        "header": {
            "product": first.get("product_name"),
            "order_qty": float(jc.quantity or 0),
            "uom": jc.unit,
        },
    }


def _get_manual_job_card(db: Session, tenant_id: int, job_card_id: int) -> SalesJobCard:
    jc = db.scalars(
        select(SalesJobCard).where(
            SalesJobCard.id == job_card_id,
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id.is_(None),
        )
    ).first()
    if not jc:
        raise HTTPException(status_code=404, detail="Job card not found")
    return jc


def _get_manual_job_card_for_update(
    db: Session, tenant_id: int, job_card_id: int
) -> SalesJobCard:
    """Load manual job card with row lock for concurrency-sensitive mutations."""
    jc = db.scalars(
        select(SalesJobCard)
        .where(
            SalesJobCard.id == job_card_id,
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id.is_(None),
        )
        .with_for_update()
    ).first()
    if not jc:
        raise HTTPException(status_code=404, detail="Job card not found")
    return jc


def _apply_manual_to_record(jc: SalesJobCard, doc: dict[str, Any]) -> None:
    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    order = doc.get("order") or {}
    total_qty = sum(float(ln.get("quantity") or 0) for ln in lines) or float(first.get("quantity") or 0)
    jc.quantity = total_qty
    jc.unit = _trim(first.get("uom")) or "Nos"
    jc.priority = _trim(order.get("priority")) or jc.priority or "medium"
    jc.notes = _trim(order.get("remarks"), 500) or None
    jc.required_delivery_date = _parse_date(order.get("delivery_date"))
    jc.customer_id = None
    jc.product_id = None


def create_manual_job_card(
    db: Session,
    tenant_id: int,
    user: User,
    payload: dict[str, Any],
    *,
    finalize: bool = True,
) -> dict[str, Any]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_SALES, user_teams

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_SALES not in teams:
        raise HTTPException(status_code=403, detail="Sales team permission required")

    manual_patch = payload.get("manual_document") or payload
    doc = merge_manual_document({}, manual_patch)
    errors = validate_manual_document(doc, finalize=finalize)
    if finalize:
        errors.update(
            _validate_manual_product_lines(db, tenant_id, doc.get("product_lines") or [])
        )
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Validation failed", "errors": errors})

    approval = doc.get("approval") or {}
    if finalize and not _trim(approval.get("prepared_by")):
        approval["prepared_by"] = user.full_name or ""
        approval["prepared_date"] = date.today().isoformat()
        doc["approval"] = approval

    details = parse_details_json(None)
    details["manual_document"] = doc

    jc = SalesJobCard(
        tenant_id=tenant_id,
        job_card_no=_generate_job_card_no(db, tenant_id),
        sales_order_id=None,
        customer_id=None,
        product_id=None,
        quantity=0,
        unit="Nos",
        priority="medium",
        status="created" if finalize else "draft",
        workflow_stage=MANUAL_WORKFLOW_DRAFT if not finalize else None,
        created_by_user_id=user.id,
        details_json=serialize_details_json(details),
    )
    _apply_manual_to_record(jc, doc)
    if finalize:
        jc.workflow_stage = MANUAL_WORKFLOW_SAVED
        jc.details_json = serialize_details_json(details)
    db.add(jc)
    db.commit()
    db.refresh(jc)
    if finalize:
        try:
            from app.services.automation.events import AutomationEvent
            from app.services.automation.hooks import dispatch_automation_event_isolated

            dispatch_automation_event_isolated(tenant_id, AutomationEvent.JOB_CARD_CREATED)
        except Exception:
            pass
    return build_manual_job_card_response(db, jc, user=user)


def update_manual_job_card(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
    payload: dict[str, Any],
    *,
    finalize: bool = False,
) -> dict[str, Any]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_SALES, user_teams

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_SALES not in teams:
        raise HTTPException(status_code=403, detail="Sales team permission required")

    from app.core.concurrency import assert_entity_version, bump_entity_version, bump_record_version

    jc = _get_manual_job_card_for_update(db, tenant_id, job_card_id)
    details = parse_details_json(jc.details_json)
    store_wf = get_store_workflow(details)
    ws = (jc.workflow_stage or "").upper()
    expected_version = payload.get("expected_version") if isinstance(payload, dict) else None
    if expected_version is not None:
        assert_entity_version(jc, int(expected_version))

    if _manual_in_store_workflow(jc) and ws != MANUAL_WORKFLOW_RETURNED:
        raise HTTPException(
            status_code=403,
            detail="Sales information is read-only while the job card is with Store Manager. "
            "Request a correction via Return to Sales.",
        )

    existing_doc = extract_manual_document(details)
    manual_patch = payload.get("manual_document") or payload
    doc = merge_manual_document(existing_doc, manual_patch)
    should_finalize = finalize or jc.status == "created"
    errors = validate_manual_document(doc, finalize=should_finalize)
    if should_finalize:
        errors.update(
            _validate_manual_product_lines(db, tenant_id, doc.get("product_lines") or [])
        )
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Validation failed", "errors": errors})

    details["manual_document"] = doc
    _apply_manual_to_record(jc, doc)
    if finalize and jc.status != "created":
        jc.status = "created"
    if finalize:
        jc.workflow_stage = MANUAL_WORKFLOW_SAVED
        if store_wf.get("returned_to_sales"):
            store_wf = get_store_workflow(details)
            store_wf["returned_to_sales"] = False
            store_wf["return_remarks"] = None
            details["store_workflow"] = store_wf
    bump_entity_version(jc)
    bump_record_version(details)
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)
    return build_manual_job_card_response(db, jc, user=user)


def get_manual_job_card(db: Session, tenant_id: int, job_card_id: int, user: User | None = None) -> dict[str, Any]:
    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    return build_manual_job_card_response(db, jc, user=user)


def delete_manual_job_card(db: Session, tenant_id: int, job_card_id: int, user: User) -> None:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_SALES, user_teams
    from app.models.manufacturing_workflow import WorkflowStageJobCard

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_SALES not in teams and "production" not in teams and "inventory" not in teams:
        raise HTTPException(status_code=403, detail="Permission required to delete job card")

    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    details = parse_details_json(jc.details_json)
    assignments = _get_send_assignments(details)
    store_wf = get_store_workflow(details)
    if assignments or store_wf.get("sent_at") or (jc.workflow_stage and jc.workflow_stage not in (MANUAL_WORKFLOW_DRAFT, "DRAFT", "MANUAL_DRAFT", MANUAL_WORKFLOW_SAVED, "SAVED")):
        raise HTTPException(status_code=400, detail="Cannot delete a job card that has already been sent")

    # Clean up dependent stage job cards if any exist
    db.query(WorkflowStageJobCard).filter(
        WorkflowStageJobCard.sales_job_card_id == jc.id
    ).delete(synchronize_session=False)

    db.delete(jc)
    db.commit()


def serialize_manual_queue_item(
    db: Session,
    jc: SalesJobCard,
    *,
    user: User | None = None,
    store_queue: bool = False,
) -> dict[str, Any]:
    details = parse_details_json(jc.details_json)
    doc = extract_manual_document(details)
    store_wf = get_store_workflow(details)
    sales_doc = build_manual_sales_document(jc, doc)
    header = doc.get("header") or {}
    customer = doc.get("customer") or {}
    order = doc.get("order") or {}
    lines = doc.get("product_lines") or []
    first = lines[0] if lines else {}
    total_qty = sum(float(ln.get("quantity") or 0) for ln in lines)
    creator_name = None
    if jc.created_by_user_id:
        creator = db.get(User, jc.created_by_user_id)
        creator_name = creator.full_name if creator else None

    in_store = _manual_in_store_workflow(jc)
    queue_label = (
        manual_queue_status_label(jc, store_wf)
        if store_queue and in_store
        else _sales_queue_status_label(jc, details, store_wf)
    )
    ws = jc.workflow_stage or MANUAL_WORKFLOW_DRAFT
    needed_action = None
    if in_store and not store_wf.get("acknowledged"):
        needed_action = "Acknowledge"
    elif in_store and ws == "MATERIAL_CHECK_PENDING":
        needed_action = "Material Check"
    elif in_store and ws in ("MATERIAL_AVAILABLE", "MATERIAL_PARTIAL", "MATERIAL_SHORTAGE"):
        needed_action = "Send to Production"
    active_assignments = _active_send_assignments(details)
    primary_assignment = active_assignments[0] if active_assignments else None
    allowed = _store_allowed_actions(jc, store_wf, user, details)

    return {
        "job_card_id": jc.id,
        "sales_order_id": None,
        "is_manual": True,
        "job_card_no": jc.job_card_no,
        "job_card_date": header.get("job_card_date") or (
            jc.created_at.date().isoformat() if jc.created_at else None
        ),
        "order_number": header.get("sales_order_no"),
        "customer_po_no": header.get("customer_po_no"),
        "customer_name": customer.get("customer_name"),
        "product_name": first.get("product_name"),
        "product_code": first.get("product_code"),
        "quantity": total_qty or jc.quantity,
        "unit": first.get("uom") or jc.unit,
        "priority": order.get("priority") or jc.priority,
        "workflow_status": ws,
        "status_label": queue_label,
        "queue_status_label": queue_label,
        "status": queue_label,
        "delivery_date": order.get("delivery_date") or (
            jc.required_delivery_date.isoformat() if jc.required_delivery_date else None
        ),
        "order_date": order.get("sales_order_date"),
        "created_by": creator_name,
        "created_at": jc.created_at.isoformat() if jc.created_at else None,
        "received_at": (
            (primary_assignment.get("sent_at") if primary_assignment else None)
            or store_wf.get("routed_at")
            or (jc.created_at.isoformat() if jc.created_at else None)
        ),
        "sales_document": sales_doc,
        "manual_document": doc,
        "responsible_role": "Store Manager" if in_store else "Sales",
        "needed_action": needed_action,
        "allowed_actions": allowed,
        "can_send": _can_send_manual(jc, details, user=user),
        "sent_to": _format_sent_to(details),
        "sent_by": primary_assignment.get("sent_by_name") if primary_assignment else None,
        "sent_at": primary_assignment.get("sent_at") if primary_assignment else None,
        "store_acknowledged": bool(store_wf.get("acknowledged")),
        "material_check": _get_material_check(details),
    }


def list_manual_job_cards(
    db: Session,
    tenant_id: int,
    *,
    limit: int = 500,
    for_store: bool = False,
    status_filter: str | None = None,
    user: User | None = None,
) -> list[dict[str, Any]]:
    q = (
        select(SalesJobCard)
        .where(
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id.is_(None),
        )
        .order_by(SalesJobCard.id.asc() if for_store else SalesJobCard.id.desc())
    )
    if for_store:
        q = q.where(SalesJobCard.workflow_stage.in_(list(STORE_INVENTORY_STATUSES)))
    else:
        q = q.limit(limit)
    cards = list(db.scalars(q).all())
    if for_store and user:
        from app.core.permissions import get_role_names, user_is_admin

        if not user_is_admin(user):
            scoped: list[SalesJobCard] = []
            for jc in cards:
                details = parse_details_json(jc.details_json)
                if _manual_visible_to_recipient(details, user.id, dept="inventory"):
                    scoped.append(jc)
            cards = scoped
    if for_store and limit and len(cards) > limit:
        cards = cards[:limit]
    elif user and not for_store:
        from app.core.permissions import get_role_names, user_is_admin
        from app.core.workflow_constants import TEAM_SALES, user_teams

        teams = user_teams(get_role_names(user))
        if TEAM_SALES in teams and not user_is_admin(user):
            cards = [jc for jc in cards if jc.created_by_user_id == user.id]
    items = [
        serialize_manual_queue_item(db, jc, user=user, store_queue=for_store)
        for jc in cards
    ]
    if status_filter:
        sf = status_filter.upper()
        items = [i for i in items if str(i.get("workflow_status") or "").upper() == sf]
    return items


def list_manual_job_cards_for_recipient(
    db: Session,
    tenant_id: int,
    user: User,
    *,
    dept: str,
    status_filter: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Manual job cards explicitly sent to the given user for a department queue."""
    from app.core.permissions import user_is_admin

    store_dept = dept == "inventory"
    q = (
        select(SalesJobCard)
        .where(
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id.is_(None),
        )
        .order_by(SalesJobCard.id.asc() if store_dept else SalesJobCard.id.desc())
    )
    if not store_dept:
        q = q.limit(limit)
    cards = list(db.scalars(q).all())
    items: list[dict[str, Any]] = []
    for jc in cards:
        details = parse_details_json(jc.details_json)
        if user_is_admin(user) or _manual_visible_to_recipient(details, user.id, dept=dept):
            item = serialize_manual_queue_item(
                db, jc, user=user, store_queue=dept == "inventory"
            )
            if status_filter:
                sf = status_filter.upper()
                if str(item.get("workflow_status") or "").upper() != sf:
                    continue
            items.append(item)
    if store_dept and limit and len(items) > limit:
        items = items[:limit]
    return items


def count_manual_sales_job_cards_pending(db: Session, tenant_id: int) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(SalesJobCard)
            .where(
                SalesJobCard.tenant_id == tenant_id,
                SalesJobCard.sales_order_id.is_(None),
                SalesJobCard.workflow_stage == "MATERIAL_CHECK_PENDING",
            )
        )
        or 0
    )


def acknowledge_manual_job_card(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
) -> dict[str, Any]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_INVENTORY, user_teams

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_INVENTORY not in teams:
        raise HTTPException(status_code=403, detail="Store Manager permission required")

    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    if not _manual_in_store_workflow(jc):
        raise HTTPException(status_code=400, detail="Job card is not pending store review")

    details = parse_details_json(jc.details_json)
    store_wf = get_store_workflow(details)
    if store_wf.get("acknowledged"):
        return build_manual_job_card_response(db, jc, user=user, store_perspective=True)

    now = datetime.now(timezone.utc).isoformat()
    store_wf["acknowledged"] = True
    store_wf["acknowledged_by"] = user.full_name or ""
    store_wf["acknowledged_by_user_id"] = user.id
    store_wf["acknowledged_at"] = now
    details["store_workflow"] = store_wf
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)
    return build_manual_job_card_response(db, jc, user=user, store_perspective=True)


def return_manual_job_card_to_sales(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
    *,
    remarks: str = "",
) -> dict[str, Any]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_INVENTORY, user_teams
    from app.services.notification_management_service import NotificationManagementService

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_INVENTORY not in teams:
        raise HTTPException(status_code=403, detail="Store Manager permission required")

    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    if not _manual_in_store_workflow(jc):
        raise HTTPException(status_code=400, detail="Job card cannot be returned from current status")

    details = parse_details_json(jc.details_json)
    store_wf = get_store_workflow(details)
    now = datetime.now(timezone.utc).isoformat()
    store_wf["returned_to_sales"] = True
    store_wf["returned_at"] = now
    store_wf["returned_by"] = user.full_name or ""
    store_wf["returned_by_user_id"] = user.id
    store_wf["return_remarks"] = _trim(remarks, 1000) or None
    details["store_workflow"] = store_wf
    assignments = _get_send_assignments(details)
    for assignment in assignments:
        if assignment.get("status") == "active":
            assignment["status"] = "returned"
            assignment["returned_at"] = now
    details["send_assignments"] = assignments
    jc.workflow_stage = MANUAL_WORKFLOW_RETURNED
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)

    if jc.created_by_user_id:
        doc = extract_manual_document(details)
        customer = (doc.get("customer") or {}).get("customer_name") or "Customer"
        try:
            NotificationManagementService.create_for_user(
                db,
                tenant_id=tenant_id,
                user_id=jc.created_by_user_id,
                title="Sales Job Card Returned for Correction",
                message=(
                    f"Job Card {jc.job_card_no} was returned by Store Manager.\n"
                    f"Customer: {customer}\n"
                    f"Remarks: {store_wf.get('return_remarks') or '—'}"
                ),
                type="production",
                priority="high",
                module="production",
                action_url=f"/my-job-cards?dept=sales&jc={jc.id}",
                created_by=user.full_name or "Store Manager",
                created_by_user_id=user.id,
                commit=True,
            )
        except Exception as exc:
            logger.exception("Return-to-sales notification failed jc_id=%s: %s", jc.id, exc)

    return build_manual_job_card_response(db, jc, user=user)


def add_manual_store_comment(
    db: Session,
    tenant_id: int,
    job_card_id: int,
    user: User,
    *,
    comment: str,
) -> dict[str, Any]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_INVENTORY, user_teams

    teams = user_teams(get_role_names(user))
    if not user_is_admin(user) and TEAM_INVENTORY not in teams:
        raise HTTPException(status_code=403, detail="Store Manager permission required")

    text = _trim(comment, 2000)
    if not text:
        raise HTTPException(status_code=422, detail="Comment is required")

    jc = _get_manual_job_card(db, tenant_id, job_card_id)
    details = parse_details_json(jc.details_json)
    store_wf = get_store_workflow(details)
    comments = list(store_wf.get("store_comments") or [])
    comments.append({
        "text": text,
        "by": user.full_name or "",
        "by_user_id": user.id,
        "at": datetime.now(timezone.utc).isoformat(),
    })
    store_wf["store_comments"] = comments
    details["store_workflow"] = store_wf
    jc.details_json = serialize_details_json(details)
    db.commit()
    db.refresh(jc)
    return build_manual_job_card_response(db, jc, user=user)
