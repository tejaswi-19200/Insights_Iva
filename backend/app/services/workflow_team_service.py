"""Team-specific manufacturing workflow operations."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import get_role_names, user_is_admin
from app.core.workflow_constants import (
    TEAM_BILLING,
    TEAM_INVENTORY,
    TEAM_OPERATOR,
    TEAM_PACKING,
    TEAM_PRODUCTION,
    TEAM_QUALITY,
    TEAM_SALES,
    normalize_priority,
    user_teams,
    workflow_status_label,
)
from app.models.manufacturing_workflow import (
    SalesJobCard,
    SalesOrderMaterialCheck,
    SalesOrderMaterialCheckLine,
)
from app.models.product import Product
from app.models.production import ProductionOrder, WorkOrder
from app.models.quality import QualityInspection
from app.models.sales import DispatchShipment, Invoice, SalesOrder, SalesOrderLine
from app.models.user import User
from app.services.inventory_service import get_total_stock
from app.services.procurement_service import next_material_request_number
from app.services.manufacturing_workflow_service import (
    create_gst_invoice_from_sales_order,
    ensure_work_order_for_production_order,
    find_or_create_inventory_item_for_product,
    get_bom_requirements,
    _product_requires_bom,
    run_mrp,
)
from app.services.workflow_state_service import (
    get_sales_order_or_404,
    infer_workflow_status_from_legacy,
    transition_workflow_status,
)


_TEAM_MODULE_FALLBACK = {
    TEAM_SALES: "sales",
    TEAM_INVENTORY: "inventory",
    TEAM_PRODUCTION: "production",
    TEAM_OPERATOR: "production",
    TEAM_QUALITY: "production",
    TEAM_PACKING: "inventory",
    TEAM_BILLING: "accounts",
}


def _assert_team(user: User, team: str) -> None:
    if user_is_admin(user):
        return
    if team in user_teams(get_role_names(user)):
        return
    from app.core.permissions import user_has_permission

    module = _TEAM_MODULE_FALLBACK.get(team)
    if module and user_has_permission(user, module):
        return
    raise HTTPException(status_code=403, detail=f"Requires {team} team permission")


def _material_check_line_availability_status(ln: SalesOrderMaterialCheckLine) -> str:
    shortage = float(ln.shortage_qty or 0)
    available = float(ln.available_qty or 0)
    if shortage <= 0:
        return "available"
    if available > 0:
        return "partially_available"
    return "not_available"


def _serialize_material_check_line(
    ln: SalesOrderMaterialCheckLine, db: Session | None = None
) -> dict[str, Any]:
    material_code = None
    uom = None
    if db and ln.inventory_item_id:
        from app.models.inventory import InventoryItem

        item = db.get(InventoryItem, int(ln.inventory_item_id))
        if item:
            material_code = item.sku
            uom = item.unit
    reserved = float(getattr(ln, "_reserved_qty", 0) or 0)
    return {
        "id": ln.id,
        "material_code": material_code,
        "material_name": ln.material_name,
        "product_id": ln.product_id,
        "inventory_item_id": ln.inventory_item_id,
        "required_qty": float(ln.required_qty or 0),
        "available_qty": float(ln.available_qty or 0),
        "reserved_qty": reserved,
        "shortage_qty": float(ln.shortage_qty or 0),
        "uom": uom,
        "stock_location": ln.stock_location,
        "is_available": bool(ln.is_available),
        "availability_status": _material_check_line_availability_status(ln),
    }


def _serialize_material_check(
    mc: SalesOrderMaterialCheck, db: Session | None = None
) -> dict[str, Any]:
    return {
        "id": mc.id,
        "check_number": mc.check_number,
        "sales_order_id": mc.sales_order_id,
        "status": mc.status,
        "verified_by_name": mc.verified_by_name,
        "verified_at": mc.verified_at.isoformat() if mc.verified_at else None,
        "notes": mc.notes,
        "lines": [_serialize_material_check_line(ln, db) for ln in (mc.lines or [])],
    }


def _products_missing_bom(db: Session, tenant_id: int, sales_order: SalesOrder) -> list[Product]:
    """Return manufactured order products without usable BOM requirements."""
    missing = []
    for line in db.scalars(
        select(SalesOrderLine).where(SalesOrderLine.sales_order_id == sales_order.id)
    ).all():
        product = db.get(Product, line.product_id) if line.product_id else None
        if product and _product_requires_bom(product) and not get_bom_requirements(
            db, tenant_id, product.id, float(line.quantity or 0)
        ):
            missing.append(product)
    return missing


def refresh_pending_material_check_stock(
    db: Session,
    tenant_id: int,
    mc: SalesOrderMaterialCheck | None,
    *,
    force: bool = False,
) -> SalesOrderMaterialCheck | None:
    """Refresh on-hand / reserved / shortage on a pending material check from live inventory."""
    if not mc:
        return mc

    from app.models.inventory import InventoryItem, StockLevel, Warehouse
    from app.services.inventory_service import get_default_warehouse, get_total_stock

    pending = force or (mc.status or "pending").lower() in {
        "pending",
        "",
        "material_check_pending",
        "material_shortage",
        "material_partial",
        "material_available",
    }
    if not force and (mc.status or "").strip().lower() not in {
        "pending",
        "",
        "material_check_pending",
        "material_shortage",
        "material_partial",
        "material_available",
    }:
        pending = True

    default_wh = get_default_warehouse(db, tenant_id)
    for ln in mc.lines or []:
        reserved = 0.0
        warehouse_name = ln.stock_location
        item_id = ln.inventory_item_id
        if item_id:
            on_hand = float(get_total_stock(db, int(item_id), tenant_id))
            item = db.get(InventoryItem, int(item_id))
            reserved = float(item.reserved or 0) if item else 0.0
            sl = db.execute(
                select(StockLevel.warehouse_id, StockLevel.quantity, Warehouse.name)
                .join(Warehouse, StockLevel.warehouse_id == Warehouse.id)
                .where(StockLevel.item_id == int(item_id))
                .order_by(StockLevel.quantity.desc())
                .limit(1)
            ).first()
            if sl and sl[2]:
                warehouse_name = sl[2]
            elif default_wh:
                warehouse_name = default_wh.name
            if pending:
                ln.available_qty = on_hand
        if pending:
            required = float(ln.required_qty or 0)
            net = max(0.0, float(ln.available_qty or 0) - reserved)
            ln.shortage_qty = max(0.0, required - net)
            ln.is_available = ln.shortage_qty <= 0
            if warehouse_name and not ln.stock_location:
                ln.stock_location = warehouse_name
        ln._reserved_qty = reserved
    if pending:
        db.flush()
    return mc


def create_material_check_for_order(
    db: Session, tenant_id: int, sales_order: SalesOrder, *, commit: bool = False
) -> SalesOrderMaterialCheck:
    """Build inventory material check from BOM requirements."""
    existing = db.scalars(
        select(SalesOrderMaterialCheck).where(
            SalesOrderMaterialCheck.tenant_id == tenant_id,
            SalesOrderMaterialCheck.sales_order_id == sales_order.id,
        )
    ).first()
    if existing and existing.lines:
        return existing

    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == sales_order.id)
        ).all()
    )
    mc = existing or SalesOrderMaterialCheck(
        tenant_id=tenant_id,
        sales_order_id=sales_order.id,
        check_number=f"MC-{sales_order.order_number}",
        status="pending",
    )
    if not existing:
        db.add(mc)
        db.flush()

    for so_line in lines:
        if not so_line.product_id:
            continue
        order_qty = float(so_line.quantity or 0)
        bom_reqs = get_bom_requirements(
            db, tenant_id, so_line.product_id, order_qty
        )
        if not bom_reqs:
            # Raw materials and other inventory products may be sold directly;
            # check their own stock instead of requiring a BOM to exist.
            product = db.get(Product, so_line.product_id)
            if _product_requires_bom(product):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No verified BOM is available for '{product.name}'. A production-authorized member must create or replace the BOM before the store can check materials."
                    ),
                )
            if product and product.tenant_id == tenant_id:
                category = (product.category or "").strip().lower()
                item_type = (
                    "raw_material"
                    if any(token in category for token in ("raw", "packaging", "wip", "consumable", "spare"))
                    else "finished_good"
                )
                item = find_or_create_inventory_item_for_product(
                    db, tenant_id, product, item_type=item_type
                )
                bom_reqs = [{
                    "component_product_id": product.id,
                    "item_id": item.id,
                    "sku": product.sku,
                    "component_name": product.name,
                    "required_qty": order_qty,
                    "available_qty": float(get_total_stock(db, item.id, tenant_id)),
                }]
        for req in bom_reqs:
            comp_id = req.get("component_product_id")
            item_id = req.get("item_id")
            sku = (req.get("sku") or "").strip()
            comp_name = (req.get("component_name") or "Material").strip()
            required = float(req.get("required_qty") or 0)
            available = float(req.get("available_qty") or 0)
            if item_id and available == 0:
                available = float(get_total_stock(db, int(item_id), tenant_id))
            shortage = max(0.0, required - available)
            db.add(
                SalesOrderMaterialCheckLine(
                    material_check_id=mc.id,
                    product_id=int(comp_id) if comp_id else None,
                    inventory_item_id=int(item_id) if item_id else None,
                    material_name=str(comp_name),
                    required_qty=required,
                    available_qty=available,
                    shortage_qty=shortage,
                    is_available=shortage <= 0,
                )
            )

    if commit:
        db.commit()
        db.refresh(mc)
    else:
        db.flush()
    return mc


def _ensure_workflow_artifacts(
    db: Session,
    tenant_id: int,
    so: SalesOrder,
    user: User | None,
) -> SalesOrderMaterialCheck | None:
    """Ensure material check and job card exist for a confirmed workflow order."""
    from app.services.job_card_service import ensure_sales_job_card_from_order

    mc = db.scalars(
        select(SalesOrderMaterialCheck).where(
            SalesOrderMaterialCheck.tenant_id == tenant_id,
            SalesOrderMaterialCheck.sales_order_id == so.id,
        )
    ).first()
    missing_boms = _products_missing_bom(db, tenant_id, so)
    if missing_boms and (so.workflow_status or "").upper() in {
        "SALES_CONFIRMED", "MATERIAL_CHECK_PENDING"
    }:
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="BOM_PENDING",
            user=None,
            action="BOM_REQUIRED",
            team=TEAM_PRODUCTION,
            details="Production must create or correct the BOM before Store can check availability.",
            skip_permission_check=True,
            commit=False,
            notify=True,
        )
    if not mc and (so.workflow_status or "").upper() != "BOM_PENDING":
        mc = create_material_check_for_order(db, tenant_id, so, commit=False)
    ensure_sales_job_card_from_order(db, tenant_id, so.id, user)
    return mc


def repair_confirmed_orders_missing_workflow(
    db: Session, tenant_id: int, *, limit: int = 50, user: User | None = None
) -> int:
    """Link confirmed sales orders without workflow_status to the inventory check queue."""
    from app.models.manufacturing_workflow import ManufacturingWorkflowTransition

    orphans = list(
        db.scalars(
            select(SalesOrder)
            .where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.status.in_(["confirmed", "approved"]),
                SalesOrder.workflow_status.is_(None),
            )
            .order_by(SalesOrder.id.desc())
            .limit(limit)
        ).all()
    )
    if not orphans:
        return 0

    repaired = 0
    for so in orphans:
        lines = list(
            db.scalars(
                select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
            ).all()
        )
        if not lines:
            continue
        so.workflow_status = "MATERIAL_CHECK_PENDING"
        if not so.priority:
            so.priority = "medium"
        _ensure_workflow_artifacts(db, tenant_id, so, user)
        db.add(
            ManufacturingWorkflowTransition(
                tenant_id=tenant_id,
                sales_order_id=so.id,
                action="WORKFLOW_REPAIR",
                previous_status=None,
                new_status="MATERIAL_CHECK_PENDING",
                user_name="System",
                team="admin",
                details="Confirmed order linked to inventory check queue",
            )
        )
        repaired += 1
    if repaired:
        db.commit()

    # Repair confirmed orders that have workflow_status but missing job card / material check
    gaps = list(
        db.scalars(
            select(SalesOrder)
            .where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.status.in_(["confirmed", "approved"]),
                SalesOrder.workflow_status.isnot(None),
            )
            .order_by(SalesOrder.id.desc())
            .limit(limit)
        ).all()
    )
    gap_fixed = 0
    for so in gaps:
        from app.services.job_card_service import _get_persisted_job_card

        needs_mc = not db.scalars(
            select(SalesOrderMaterialCheck.id).where(
                SalesOrderMaterialCheck.tenant_id == tenant_id,
                SalesOrderMaterialCheck.sales_order_id == so.id,
            )
        ).first()
        needs_jc = not _get_persisted_job_card(db, tenant_id, so.id)
        if needs_mc or needs_jc:
            _ensure_workflow_artifacts(db, tenant_id, so, user)
            gap_fixed += 1
    if gap_fixed:
        db.commit()
        repaired += gap_fixed

    return repaired


def _material_stock_status(
    workflow_status: str | None,
    material_check: SalesOrderMaterialCheck | None,
) -> str | None:
    """pending | available | shortage — for store-manager queue filters."""
    ws = (workflow_status or "").upper()
    if ws in {"MATERIAL_SHORTAGE", "MATERIAL_PARTIAL"}:
        return "shortage"
    if material_check and material_check.lines:
        if any(float(ln.shortage_qty or 0) > 0 for ln in material_check.lines):
            return "shortage"
        if material_check.status in {"verified", "completed"}:
            return "available"
    if ws == "MATERIAL_CHECK_PENDING":
        return "pending"
    if ws in {"MATERIAL_AVAILABLE", "STORE_ISSUE_PENDING", "STORE_ISSUE_PARTIAL"}:
        return "available"
    return None


def _serialize_queue_order(
    db: Session,
    so: SalesOrder,
    *,
    job_card: SalesJobCard | None = None,
    material_check: SalesOrderMaterialCheck | None = None,
    assigned_to: str | None = None,
) -> dict[str, Any]:
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
    delivery = job_card.required_delivery_date if job_card and job_card.required_delivery_date else so.delivery_date

    return {
        "sales_order_id": so.id,
        "job_card_no": job_card.job_card_no if job_card else None,
        "order_number": so.order_number,
        "customer_name": so.customer.name if so.customer else None,
        "product_name": product_name,
        "product_code": product_code,
        "product_id": product_id,
        "quantity": qty,
        "unit": unit or "Nos",
        "priority": normalize_priority(job_card.priority if job_card else so.priority),
        "workflow_status": ws,
        "status_label": label,
        "status": label,
        "delivery_date": delivery.isoformat() if delivery else None,
        "order_date": so.order_date.isoformat() if so.order_date else None,
        "sales_person": so.sales_person,
        "material_stock_status": _material_stock_status(ws, material_check),
        "assigned_to": assigned_to,
    }


def list_pending_inventory_checks(
    db: Session, tenant_id: int, *, limit: int = 10, offset: int = 0
) -> tuple[int, list[dict[str, Any]]]:
    """Count and list sales orders awaiting store inventory verification."""
    repair_confirmed_orders_missing_workflow(db, tenant_id)
    from sqlalchemy import func

    count = int(
        db.scalar(
            select(func.count(SalesOrder.id)).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.workflow_status == "MATERIAL_CHECK_PENDING",
            )
        )
        or 0
    )
    orders = list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.line_items), selectinload(SalesOrder.customer))
            .where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.workflow_status == "MATERIAL_CHECK_PENDING",
            )
            .order_by(SalesOrder.id.asc())
            .offset(max(0, offset))
            .limit(limit)
        ).all()
    )
    order_ids = [o.id for o in orders]
    jc_map: dict[int, SalesJobCard] = {}
    mc_map: dict[int, SalesOrderMaterialCheck] = {}
    if order_ids:
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
    return count, [
        _serialize_queue_order(
            db,
            so,
            job_card=jc_map.get(so.id),
            material_check=mc_map.get(so.id),
        )
        for so in orders
    ]


def confirm_sales_order_with_workflow(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    run_mrp_and_pr: bool = True,
) -> dict[str, Any]:
    """Confirm SO → SALES_CONFIRMED → MATERIAL_CHECK_PENDING with MRP snapshot."""
    _assert_team(user, TEAM_SALES)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    if (so.status or "").lower() in {"confirmed", "approved"}:
        if so.workflow_status:
            _ensure_workflow_artifacts(db, tenant_id, so, user)
            db.commit()
            mc = db.scalars(
                select(SalesOrderMaterialCheck).where(
                    SalesOrderMaterialCheck.sales_order_id == so.id
                )
            ).first()
            db.refresh(so)
            return {
                "sales_order_id": so.id,
                "order_number": so.order_number,
                "workflow_status": so.workflow_status,
                "already_confirmed": True,
                "material_check": _serialize_material_check(mc, db) if mc else None,
            }
        lines = list(
            db.scalars(
                select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
            ).all()
        )
        if not lines:
            raise HTTPException(status_code=400, detail="Add product lines before confirming")
        so.workflow_status = "MATERIAL_CHECK_PENDING"
        if not so.priority:
            so.priority = "medium"
        mc = _ensure_workflow_artifacts(db, tenant_id, so, user)
        db.commit()
        db.refresh(so)
        return {
            "sales_order_id": so.id,
            "order_number": so.order_number,
            "status": so.status,
            "workflow_status": so.workflow_status,
            "priority": normalize_priority(so.priority),
            "mrp_results": [],
            "material_check": _serialize_material_check(mc, db),
            "repaired_workflow": True,
        }

    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    if not lines:
        raise HTTPException(status_code=400, detail="Add product lines before confirming")

    missing_boms = _products_missing_bom(db, tenant_id, so)
    missing_bom_ids = {product.id for product in missing_boms}
    mrp_results = []
    for line in lines:
        if not line.product_id or line.product_id in missing_bom_ids:
            continue
        mrp = run_mrp(
            db,
            tenant_id,
            line.product_id,
            float(line.quantity),
            create_purchase_request=run_mrp_and_pr,
            requested_by=user.full_name,
            reference=so.order_number,
        )
        mrp_results.append(mrp)

    so.status = "confirmed"
    if not so.sales_person:
        so.sales_person = user.full_name

    next_status = "BOM_PENDING" if missing_boms else "MATERIAL_CHECK_PENDING"
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="SALES_CONFIRMED",
        user=user,
        action="SALES_ORDER_CONFIRMED",
        team=TEAM_SALES,
        commit=False,
        notify=False,
    )
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status=next_status,
        user=user,
        action="BOM_REQUIRED" if missing_boms else "MATERIAL_CHECK_CREATED",
        team=TEAM_SALES,
        commit=False,
        notify=True,
    )
    mc = None if missing_boms else create_material_check_for_order(db, tenant_id, so)
    from app.services.job_card_service import ensure_sales_job_card_from_order

    ensure_sales_job_card_from_order(db, tenant_id, so.id, user)
    db.commit()
    db.refresh(so)
    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "status": so.status,
        "workflow_status": so.workflow_status,
        "priority": normalize_priority(so.priority),
        "mrp_results": mrp_results,
        "material_check": _serialize_material_check(mc, db) if mc else None,
        "bom_required_products": [p.name for p in missing_boms],
    }


def submit_material_check(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    notes: str | None = None,
    line_updates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Inventory team verifies material availability."""
    _assert_team(user, TEAM_INVENTORY)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    from app.services.sales_order_cancellation_service import assert_order_not_cancelled

    assert_order_not_cancelled(so)
    ws = (so.workflow_status or "").upper()

    mc = db.scalars(
        select(SalesOrderMaterialCheck).where(
            SalesOrderMaterialCheck.sales_order_id == so.id,
            SalesOrderMaterialCheck.tenant_id == tenant_id,
        )
    ).first()
    if not mc:
        mc = create_material_check_for_order(db, tenant_id, so)

    rechecking = ws in {"MATERIAL_SHORTAGE", "MATERIAL_PARTIAL"}
    if ws != "MATERIAL_CHECK_PENDING" and not rechecking:
        if line_updates:
            raise HTTPException(
                status_code=409,
                detail=f"Material line updates only allowed during inventory check (status={so.workflow_status})",
            )
        if notes is not None:
            mc.notes = notes
            db.commit()
            return {
                "sales_order_id": so.id,
                "workflow_status": so.workflow_status,
                "material_check": _serialize_material_check(mc, db),
            }
        raise HTTPException(
            status_code=409,
            detail=f"Order not awaiting material check (status={so.workflow_status})",
        )

    refresh_pending_material_check_stock(db, tenant_id, mc, force=rechecking)

    if line_updates and not rechecking:
        line_map = {ln.id: ln for ln in mc.lines}
        for upd in line_updates:
            ln = line_map.get(upd.get("id"))
            if not ln:
                continue
            if upd.get("available_qty") is not None:
                ln.available_qty = float(upd["available_qty"])
            if "stock_location" in upd and upd.get("stock_location") is not None:
                ln.stock_location = upd["stock_location"]
            reserved = float(getattr(ln, "_reserved_qty", 0) or 0)
            net = max(0.0, float(ln.available_qty or 0) - reserved)
            ln.shortage_qty = max(0.0, float(ln.required_qty or 0) - net)
            ln.is_available = ln.shortage_qty <= 0

    all_available = all(ln.is_available for ln in mc.lines) if mc.lines else True
    any_shortage = any(float(ln.shortage_qty or 0) > 0 for ln in mc.lines)
    any_available = any(ln.is_available for ln in mc.lines) if mc.lines else True

    if not mc.lines or all_available:
        mc.status = "available"
        target = "MATERIAL_AVAILABLE"
    elif any_available and any_shortage:
        mc.status = "partial"
        target = "MATERIAL_PARTIAL"
    else:
        mc.status = "shortage"
        target = "MATERIAL_SHORTAGE"

    mc.verified_by_user_id = user.id
    mc.verified_by_name = user.full_name
    mc.verified_at = datetime.now(timezone.utc)
    mc.notes = notes

    if target != ws:
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status=target,
            user=user,
            action="MATERIAL_STOCK_RECHECKED" if rechecking else "MATERIAL_CHECK_COMPLETED",
            team=TEAM_INVENTORY,
            details=f"Material check {mc.check_number}: {mc.status}",
            commit=False,
            notify=True,
        )

    from app.services.stage_job_card_service import (
        _ensure_store_issue_lines,
        complete_stage_card,
        ensure_stage_card,
    )

    inv_card = ensure_stage_card(
        db, tenant_id, sales_order_id, "inventory_check",
        material_check_id=mc.id,
        status="completed" if target == "MATERIAL_AVAILABLE" else "in_progress",
    )
    mc.check_number = inv_card.card_number

    production_orders = []
    if target == "MATERIAL_AVAILABLE":
        complete_stage_card(db, inv_card, user, status="completed")
        store_card = ensure_stage_card(
            db, tenant_id, sales_order_id, "store",
            material_check_id=mc.id,
            status="pending",
        )
        _ensure_store_issue_lines(db, store_card, mc)
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="STORE_ISSUE_PENDING",
            user=user,
            action="STORE_JOB_CARD_CREATED",
            team=TEAM_INVENTORY,
            commit=False,
            notify=True,
            skip_permission_check=True,
        )
    elif target in {"MATERIAL_PARTIAL", "MATERIAL_SHORTAGE"}:
        inv_card.status = "completed" if target == "MATERIAL_PARTIAL" else "rejected"
        inv_card.completed_by_user_id = user.id
        inv_card.completed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(so)
    return {
        "sales_order_id": so.id,
        "workflow_status": so.workflow_status,
        "material_check": _serialize_material_check(mc, db),
        "production_orders": production_orders,
    }


def hold_workflow_order(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    """Put workflow on hold from any inventory/store stage."""
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    ws = (so.workflow_status or "").upper()
    allowed = {
        "MATERIAL_CHECK_PENDING",
        "MATERIAL_SHORTAGE",
        "MATERIAL_PARTIAL",
        "MATERIAL_AVAILABLE",
        "STORE_ISSUE_PENDING",
        "STORE_ISSUE_PARTIAL",
        "READY_FOR_PRODUCTION",
        "PRODUCTION_ASSIGNED",
        "QUALITY_CHECK_PENDING",
        "PACKING_PENDING",
        "BILLING_PENDING",
    }
    if ws not in allowed and not user_is_admin(user):
        raise HTTPException(status_code=409, detail=f"Cannot hold order at status {ws}")
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="WORKFLOW_ON_HOLD",
        user=user,
        action="WORKFLOW_ON_HOLD",
        team=TEAM_INVENTORY if ws.startswith("MATERIAL") or ws.startswith("STORE") else TEAM_PRODUCTION,
        details=reason,
        commit=True,
        notify=True,
    )
    return {"sales_order_id": so.id, "workflow_status": so.workflow_status}


def raise_material_request(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    notes: str | None = None,
) -> dict[str, Any]:
    """Create purchase requisition for shortages (store/inventory action)."""
    from app.models.procurement import MaterialRequest, MaterialRequestLine
    from app.services.inventory_service import get_default_warehouse

    _assert_team(user, TEAM_INVENTORY)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    mc = db.scalars(
        select(SalesOrderMaterialCheck)
        .options(selectinload(SalesOrderMaterialCheck.lines))
        .where(
            SalesOrderMaterialCheck.sales_order_id == so.id,
            SalesOrderMaterialCheck.tenant_id == tenant_id,
        )
    ).first()
    if not mc:
        raise HTTPException(status_code=404, detail="Material check not found")

    shortage_lines = [
        ln
        for ln in (mc.lines or [])
        if float(ln.shortage_qty or 0) > 0 and ln.inventory_item_id
    ]
    if not shortage_lines:
        raise HTTPException(
            status_code=400,
            detail="No material shortages to request. Recheck stock first.",
        )

    legacy_mr_number = f"MR-{so.order_number}"
    existing = db.scalars(
        select(MaterialRequest)
        .options(selectinload(MaterialRequest.line_items))
        .where(
            MaterialRequest.tenant_id == tenant_id,
            MaterialRequest.mr_number == legacy_mr_number,
        )
    ).first()
    workflow_reference = f"Workflow order: {so.order_number}"
    if not existing:
        existing = db.scalars(
            select(MaterialRequest)
            .options(selectinload(MaterialRequest.line_items))
            .where(
                MaterialRequest.tenant_id == tenant_id,
                MaterialRequest.notes.contains(workflow_reference),
            )
            .order_by(MaterialRequest.id.desc())
        ).first()
    warehouse = get_default_warehouse(db, tenant_id)
    if not existing:
        mr_number = next_material_request_number(db, tenant_id)
        existing = MaterialRequest(
            tenant_id=tenant_id,
            mr_number=mr_number,
            request_date=date.today(),
            requested_by=user.full_name,
            warehouse_id=warehouse.id if warehouse else None,
            priority=normalize_priority(so.priority),
            status="pending",
            notes="\n".join(
                part
                for part in (notes, workflow_reference)
                if part
            ),
        )
        db.add(existing)
        db.flush()

    already = {int(ln.item_id) for ln in (existing.line_items or []) if ln.item_id}
    added = 0
    for ln in shortage_lines:
        item_id = int(ln.inventory_item_id)
        if item_id in already:
            continue
        db.add(
            MaterialRequestLine(
                material_request_id=existing.id,
                item_id=item_id,
                quantity=max(0.01, float(ln.shortage_qty or 0)),
                notes=f"Shortage for {ln.material_name} ({so.order_number})",
            )
        )
        already.add(item_id)
        added += 1
    db.commit()
    return {
        "sales_order_id": so.id,
        "material_request_number": mr_number,
        "material_request_id": existing.id,
        "lines_added": added,
        "workflow_status": so.workflow_status,
    }


def _resolve_issue_warehouse(db: Session, tenant_id: int, store_location: str | None):
    from app.models.inventory import Warehouse
    from app.services.inventory_service import get_default_warehouse

    loc = (store_location or "").strip()
    if loc:
        wh = db.scalars(
            select(Warehouse).where(
                Warehouse.tenant_id == tenant_id,
                Warehouse.name == loc,
            )
        ).first()
        if not wh:
            wh = db.scalars(
                select(Warehouse).where(
                    Warehouse.tenant_id == tenant_id,
                    Warehouse.code == loc,
                )
            ).first()
        if not wh:
            all_wh = list(db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all())
            for w in all_wh:
                if w.name and (w.name in loc or loc.startswith(w.name)):
                    return w
        if wh:
            return wh
    return get_default_warehouse(db, tenant_id)


def _deduct_store_issue_stock(
    db: Session,
    tenant_id: int,
    user: User,
    so: SalesOrder,
    issue_line,
    qty_delta: float,
    mc_line_map: dict[int, SalesOrderMaterialCheckLine],
) -> None:
    from app.schemas.inventory import StockMovementCreate
    from app.services.inventory_service import record_stock_movement

    qty = Decimal(str(qty_delta or 0))
    if qty <= 0:
        return
    mc_line = mc_line_map.get(issue_line.material_check_line_id) if issue_line.material_check_line_id else None
    item_id = mc_line.inventory_item_id if mc_line else None
    if not item_id:
        return
    warehouse = _resolve_issue_warehouse(db, tenant_id, issue_line.store_location or (mc_line.stock_location if mc_line else None))
    if not warehouse:
        raise HTTPException(
            status_code=400,
            detail="No warehouse found. Create a warehouse before issuing materials.",
        )
    record_stock_movement(
        db,
        StockMovementCreate(
            tenant_id=tenant_id,
            warehouse_id=warehouse.id,
            item_id=int(item_id),
            quantity=float(qty),
            movement_type="out",
            reference=f"ST-ISSUE | {so.order_number} | {issue_line.material_name}",
            created_by=user.full_name,
        ),
        commit=False,
    )


def submit_store_material_issue(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    line_updates: list[dict[str, Any]] | None = None,
    send_to_production: bool = False,
    partial: bool = False,
) -> dict[str, Any]:
    """Store manager issues materials; completes store stage when fully issued."""
    from app.services.stage_job_card_service import (
        _ensure_store_issue_lines,
        complete_stage_card,
        ensure_stage_card,
        get_stage_card,
    )

    _assert_team(user, TEAM_INVENTORY)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    from app.services.sales_order_cancellation_service import assert_order_not_cancelled

    assert_order_not_cancelled(so)
    ws = (so.workflow_status or "").upper()
    if ws not in {"STORE_ISSUE_PENDING", "STORE_ISSUE_PARTIAL", "MATERIAL_AVAILABLE"}:
        raise HTTPException(status_code=409, detail=f"Store issue not allowed at {ws}")

    mc = db.scalars(
        select(SalesOrderMaterialCheck)
        .options(selectinload(SalesOrderMaterialCheck.lines))
        .where(
            SalesOrderMaterialCheck.sales_order_id == so.id,
            SalesOrderMaterialCheck.tenant_id == tenant_id,
        )
    ).first()
    store_card = get_stage_card(db, tenant_id, sales_order_id, "store")
    if not store_card:
        store_card = ensure_stage_card(
            db, tenant_id, sales_order_id, "store",
            material_check_id=mc.id if mc else None,
            status="in_progress",
        )
    if mc:
        _ensure_store_issue_lines(db, store_card, mc)
        db.refresh(store_card)

    mc_line_map = {ln.id: ln for ln in (mc.lines or [])} if mc else {}
    line_map = {ln.id: ln for ln in store_card.issue_lines}
    for upd in line_updates or []:
        ln = line_map.get(upd.get("id"))
        if not ln:
            continue
        previous_issued = float(ln.issued_qty or 0)
        issued = float(upd.get("issued_qty", ln.issued_qty))
        ln.issued_qty = min(issued, float(ln.required_qty))
        ln.remaining_qty = max(0.0, float(ln.required_qty) - ln.issued_qty)
        if ln.remaining_qty <= 0:
            ln.issue_status = "issued"
        elif ln.issued_qty > 0:
            ln.issue_status = "partial"
        if upd.get("store_location"):
            ln.store_location = upd["store_location"]
        delta = float(ln.issued_qty) - previous_issued
        if delta > 0:
            _deduct_store_issue_stock(db, tenant_id, user, so, ln, delta, mc_line_map)

    all_issued = all(ln.issue_status == "issued" for ln in store_card.issue_lines) if store_card.issue_lines else False
    any_issued = any(float(ln.issued_qty or 0) > 0 for ln in store_card.issue_lines)

    if send_to_production and not all_issued and not partial:
        raise HTTPException(status_code=400, detail="All materials must be issued before sending to production")

    production_orders = []
    if send_to_production and (all_issued or (partial and any_issued)):
        complete_stage_card(db, store_card, user, status="completed")
        production_orders = _create_production_for_order(db, tenant_id, so, user)
        wo_id = production_orders[0]["work_order_id"] if production_orders else None
        ensure_stage_card(
            db, tenant_id, sales_order_id, "production_manager",
            work_order_id=wo_id,
            status="pending",
        )
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="READY_FOR_PRODUCTION",
            user=user,
            action="STORE_ISSUE_COMPLETED",
            team=TEAM_INVENTORY,
            commit=False,
            notify=True,
            skip_permission_check=True,
        )
    elif partial or (any_issued and not all_issued):
        store_card.status = "in_progress"
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="STORE_ISSUE_PARTIAL",
            user=user,
            action="STORE_PARTIAL_ISSUE",
            team=TEAM_INVENTORY,
            commit=False,
            notify=False,
            skip_permission_check=True,
        )
    else:
        store_card.status = "in_progress"

    db.commit()
    db.refresh(so)
    return {
        "sales_order_id": so.id,
        "workflow_status": so.workflow_status,
        "store_card_number": store_card.card_number,
        "production_orders": production_orders,
    }


def _create_production_for_order(
    db: Session, tenant_id: int, so: SalesOrder, user: User
) -> list[dict[str, Any]]:
    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    created = []
    priority = normalize_priority(so.priority)
    for line in lines:
        if not line.product_id:
            continue
        order_number = f"PO-{so.order_number}-L{line.id}"
        po = db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.order_number == order_number,
            )
        ).first()
        if not po:
            product = db.get(Product, line.product_id)
            po = ProductionOrder(
                tenant_id=tenant_id,
                product_id=line.product_id,
                order_number=order_number,
                planned_quantity=float(line.quantity),
                status="planned",
                priority=priority,
                sales_order_number=so.order_number,
                sales_order_id=so.id,
                due_date=datetime.combine(so.delivery_date, datetime.min.time())
                if so.delivery_date
                else None,
            )
            db.add(po)
            db.flush()
        wo = ensure_work_order_for_production_order(db, tenant_id, po)
        wo.materials_issued = True
        created.append(
            {
                "production_order_id": po.id,
                "work_order_id": wo.id,
                "work_order_number": wo.work_order_number,
            }
        )
    return created


def assign_operator_to_work_order(
    db: Session,
    tenant_id: int,
    work_order_id: int,
    user: User,
    *,
    operator_user_id: int,
    machine_id: int | None = None,
    planned_start: datetime | None = None,
    planned_end: datetime | None = None,
    planned_quantity: float | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_PRODUCTION)
    wo = db.scalars(
        select(WorkOrder).where(
            WorkOrder.id == work_order_id,
            WorkOrder.tenant_id == tenant_id,
        )
    ).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    po = db.get(ProductionOrder, wo.production_order_id)
    so = None
    if po and po.sales_order_id:
        so = get_sales_order_or_404(db, tenant_id, po.sales_order_id)

    if so and (so.workflow_status or "").upper() not in {
        "READY_FOR_PRODUCTION",
        "PRODUCTION_ASSIGNED",
        "PRODUCTION_REWORK",
        "QUALITY_REJECTED",
    }:
        raise HTTPException(
            status_code=409,
            detail=f"Sales order not ready for operator assignment ({so.workflow_status})",
        )

    operator = db.get(User, operator_user_id)
    if not operator or operator.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Operator not found")

    wo.assigned_user_id = operator_user_id
    wo.supervisor = user.full_name
    if machine_id:
        wo.machine_id = machine_id
        if po:
            po.machine_id = machine_id
    if planned_start:
        wo.planned_start = planned_start
    if planned_end:
        wo.planned_end = planned_end
    if planned_quantity is not None:
        wo.planned_quantity = planned_quantity
    wo.status = "assigned"
    if po:
        po.status = "assigned"
        po.priority = normalize_priority(so.priority if so else po.priority)

    if so:
        from app.services.stage_job_card_service import complete_stage_card, ensure_stage_card, get_stage_card

        pm_card = get_stage_card(db, tenant_id, so.id, "production_manager")
        if pm_card:
            complete_stage_card(db, pm_card, user, status="assigned")
        ensure_stage_card(
            db, tenant_id, so.id, "operator",
            work_order_id=wo.id,
            assigned_user_id=operator_user_id,
            status="assigned",
        )
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="PRODUCTION_ASSIGNED",
            user=user,
            action="PRODUCTION_JOB_ASSIGNED",
            team=TEAM_PRODUCTION,
            work_order_id=wo.id,
            details=f"Operator: {operator.full_name}",
            commit=False,
            notify=True,
        )

    db.commit()
    db.refresh(wo)
    return {
        "work_order_id": wo.id,
        "assigned_user_id": wo.assigned_user_id,
        "workflow_status": so.workflow_status if so else None,
    }


class OperatorProductionValidationError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=400, detail=detail)


def _validate_operator_qty(value: float | None, name: str) -> float | None:
    if value is None:
        return None
    if value < 0:
        raise OperatorProductionValidationError(f"{name} cannot be negative")
    return value


def _validate_produced_vs_target(produced: float | None, target: float) -> None:
    if produced is None or target <= 0:
        return
    if produced > target:
        raise OperatorProductionValidationError(
            f"Produced quantity ({produced}) cannot exceed target quantity ({target})"
        )


def _log_operator_workflow_event(
    db: Session,
    *,
    tenant_id: int,
    sales_order: SalesOrder,
    user: User,
    action: str,
    work_order_id: int | None = None,
    details: str | None = None,
) -> None:
    from app.models.manufacturing_workflow import ManufacturingWorkflowTransition

    db.add(
        ManufacturingWorkflowTransition(
            tenant_id=tenant_id,
            sales_order_id=sales_order.id,
            action=action,
            previous_status=sales_order.workflow_status,
            new_status=sales_order.workflow_status,
            user_id=user.id,
            user_name=user.full_name,
            user_role=get_role_names(user)[0] if get_role_names(user) else None,
            team=TEAM_OPERATOR,
            work_order_id=work_order_id,
            details=details,
        )
    )


def _update_operator_stage_payload(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    *,
    produced_qty: float | None = None,
    rejected_qty: float | None = None,
    rework_qty: float | None = None,
    operator_remarks: str | None = None,
    actual_start_time: str | None = None,
    actual_end_time: str | None = None,
) -> None:
    import json

    from app.services.stage_job_card_service import get_stage_card

    card = get_stage_card(db, tenant_id, sales_order_id, "operator")
    if not card:
        return
    payload: dict[str, Any] = {}
    if card.payload_json:
        try:
            payload = json.loads(card.payload_json)
        except json.JSONDecodeError:
            payload = {}
    if produced_qty is not None:
        payload["produced_qty"] = produced_qty
    if rejected_qty is not None:
        payload["rejected_qty"] = rejected_qty
    if rework_qty is not None:
        payload["rework_qty"] = rework_qty
    if operator_remarks is not None:
        from app.utils.sanitize import sanitize_text

        payload["operator_remarks"] = sanitize_text(operator_remarks, max_length=500)
    if actual_start_time is not None:
        payload["actual_start_time"] = actual_start_time
    if actual_end_time is not None:
        payload["actual_end_time"] = actual_end_time
    card.payload_json = json.dumps(payload)
    db.flush()


def operator_start_production(
    db: Session, tenant_id: int, work_order_id: int, user: User
) -> dict[str, Any]:
    _assert_team(user, TEAM_OPERATOR)
    wo = _get_operator_work_order(db, tenant_id, work_order_id, user)
    so = _so_for_work_order(db, tenant_id, wo)
    wo.status = "in_progress"
    po = db.get(ProductionOrder, wo.production_order_id)
    if po:
        po.status = "in_progress"
        if not po.start_date:
            po.start_date = datetime.now(timezone.utc)

    if so:
        from app.services.stage_job_card_service import get_stage_card

        op_card = get_stage_card(db, tenant_id, so.id, "operator")
        if op_card:
            op_card.status = "in_progress"
        now_iso = datetime.now(timezone.utc).astimezone().strftime("%d-%b-%Y %I:%M %p")
        _update_operator_stage_payload(db, tenant_id, so.id, actual_start_time=now_iso)
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="PRODUCTION_IN_PROGRESS",
            user=user,
            action="PRODUCTION_STARTED",
            team=TEAM_OPERATOR,
            work_order_id=wo.id,
            commit=False,
        )
    db.commit()
    return {"work_order_id": wo.id, "status": wo.status, "workflow_status": so.workflow_status if so else None}


def operator_update_production(
    db: Session,
    tenant_id: int,
    work_order_id: int,
    user: User,
    *,
    produced_qty: float | None = None,
    rejected_qty: float | None = None,
    rework_qty: float | None = None,
    notes: str | None = None,
    actual_start_time: str | None = None,
    actual_end_time: str | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_OPERATOR)
    wo = _get_operator_work_order(db, tenant_id, work_order_id, user)
    so = _so_for_work_order(db, tenant_id, wo)
    target = float(wo.planned_quantity or 0)
    produced_qty = _validate_operator_qty(produced_qty, "Produced quantity")
    rejected_qty = _validate_operator_qty(rejected_qty, "Rejected quantity")
    rework_qty = _validate_operator_qty(rework_qty, "Rework quantity")
    _validate_produced_vs_target(produced_qty, target)
    if produced_qty is not None:
        wo.actual_quantity = produced_qty
    if so:
        _update_operator_stage_payload(
            db,
            tenant_id,
            so.id,
            produced_qty=produced_qty,
            rejected_qty=rejected_qty,
            rework_qty=rework_qty,
            operator_remarks=notes,
            actual_start_time=actual_start_time,
            actual_end_time=actual_end_time,
        )
    db.commit()
    return {
        "work_order_id": wo.id,
        "actual_quantity": float(wo.actual_quantity or 0),
        "rejected_qty": float(rejected_qty or 0),
        "rework_qty": float(rework_qty or 0),
    }


def operator_pause_production(
    db: Session, tenant_id: int, work_order_id: int, user: User
) -> dict[str, Any]:
    _assert_team(user, TEAM_OPERATOR)
    wo = _get_operator_work_order(db, tenant_id, work_order_id, user)
    so = _so_for_work_order(db, tenant_id, wo)
    if wo.status in {"in_progress", "running"}:
        wo.status = "paused"
    if so:
        from app.services.stage_job_card_service import get_stage_card

        op_card = get_stage_card(db, tenant_id, so.id, "operator")
        if op_card:
            op_card.status = "on_hold"
        _log_operator_workflow_event(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            user=user,
            action="PRODUCTION_PAUSED",
            work_order_id=wo.id,
        )
    db.commit()
    return {"work_order_id": wo.id, "status": wo.status}


def operator_resume_production(
    db: Session, tenant_id: int, work_order_id: int, user: User
) -> dict[str, Any]:
    _assert_team(user, TEAM_OPERATOR)
    wo = _get_operator_work_order(db, tenant_id, work_order_id, user)
    so = _so_for_work_order(db, tenant_id, wo)
    if wo.status == "paused":
        wo.status = "in_progress"
    if so:
        from app.services.stage_job_card_service import get_stage_card

        op_card = get_stage_card(db, tenant_id, so.id, "operator")
        if op_card:
            op_card.status = "in_progress"
        _log_operator_workflow_event(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            user=user,
            action="PRODUCTION_RESUMED",
            work_order_id=wo.id,
        )
    db.commit()
    return {"work_order_id": wo.id, "status": wo.status}


def operator_complete_production(
    db: Session,
    tenant_id: int,
    work_order_id: int,
    user: User,
    *,
    produced_qty: float | None = None,
    rejected_qty: float | None = None,
    rework_qty: float | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_OPERATOR)
    wo = _get_operator_work_order(db, tenant_id, work_order_id, user)
    so = _so_for_work_order(db, tenant_id, wo)
    target = float(wo.planned_quantity or 0)
    produced_qty = _validate_operator_qty(produced_qty, "Produced quantity")
    rejected_qty = _validate_operator_qty(rejected_qty, "Rejected quantity")
    rework_qty = _validate_operator_qty(rework_qty, "Rework quantity")
    _validate_produced_vs_target(produced_qty, target)
    if produced_qty is not None:
        wo.actual_quantity = produced_qty
    wo.status = "completed"
    po = db.get(ProductionOrder, wo.production_order_id)
    if po:
        po.status = "completed"
        po.actual_quantity = float(wo.actual_quantity or wo.planned_quantity)

    qi = None
    if so:
        now_iso = datetime.now(timezone.utc).astimezone().strftime("%d-%b-%Y %I:%M %p")
        _update_operator_stage_payload(
            db,
            tenant_id,
            so.id,
            produced_qty=float(wo.actual_quantity or 0),
            rejected_qty=rejected_qty,
            rework_qty=rework_qty,
            operator_remarks=notes,
            actual_end_time=now_iso,
        )
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="PRODUCTION_COMPLETED",
            user=user,
            action="PRODUCTION_COMPLETED",
            team=TEAM_OPERATOR,
            work_order_id=wo.id,
            commit=False,
            notify=False,
        )
        qi = _create_quality_inspection_pending(db, tenant_id, so, wo, user, notes)
        from app.services.stage_job_card_service import complete_stage_card, ensure_stage_card, get_stage_card

        op_card = get_stage_card(db, tenant_id, so.id, "operator")
        if op_card:
            complete_stage_card(db, op_card, user, status="completed")
        ensure_stage_card(
            db, tenant_id, so.id, "quality",
            quality_inspection_id=qi.id if qi else None,
            status="pending",
        )
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="QUALITY_CHECK_PENDING",
            user=user,
            action="QUALITY_CHECK_CREATED",
            team=TEAM_OPERATOR,
            quality_inspection_id=qi.id if qi else None,
            commit=False,
            notify=True,
        )
    db.commit()
    return {
        "work_order_id": wo.id,
        "workflow_status": so.workflow_status if so else None,
        "quality_inspection_id": qi.id if qi else None,
    }


def submit_quality_check(
    db: Session,
    tenant_id: int,
    inspection_id: int,
    user: User,
    *,
    result: str,
    rejected_qty: float | None = None,
    notes: str | None = None,
    defects: str | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_QUALITY)
    qi = db.scalars(
        select(QualityInspection).where(
            QualityInspection.id == inspection_id,
            QualityInspection.tenant_id == tenant_id,
        )
    ).first()
    if not qi:
        raise HTTPException(status_code=404, detail="Quality inspection not found")

    so = None
    if qi.sales_order_number:
        so = db.scalars(
            select(SalesOrder).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.order_number == qi.sales_order_number,
            )
        ).first()

    if so and (so.workflow_status or "").upper() not in {"QUALITY_CHECK_PENDING", "QUALITY_ON_HOLD"}:
        raise HTTPException(
            status_code=409,
            detail=f"Order not awaiting quality check ({so.workflow_status})",
        )

    result_norm = (result or "").strip().lower()
    if result_norm not in {"pass", "fail", "partial", "hold", "conditional"}:
        raise HTTPException(status_code=400, detail="result must be pass, fail, partial, or hold")

    qi.result = result_norm if result_norm != "conditional" else "hold"
    qi.status = "completed"
    qi.inspector = user.full_name
    qi.notes = notes or qi.notes
    if defects:
        qi.notes = f"{qi.notes or ''}\nDefects: {defects}".strip()

    if result_norm == "pass":
        target = "QUALITY_APPROVED"
    elif result_norm == "fail":
        target = "QUALITY_REJECTED"
    elif result_norm in {"hold", "conditional"}:
        target = "QUALITY_ON_HOLD"
    else:
        target = "QUALITY_APPROVED"

    if so:
        from app.services.stage_job_card_service import complete_stage_card, ensure_stage_card, get_stage_card

        qc_card = get_stage_card(db, tenant_id, so.id, "quality")
        if not qc_card:
            qc_card = ensure_stage_card(
                db, tenant_id, so.id, "quality",
                quality_inspection_id=qi.id,
                status="in_progress",
            )
        if target == "QUALITY_APPROVED":
            complete_stage_card(db, qc_card, user, status="completed")
            ensure_stage_card(db, tenant_id, so.id, "packing", status="pending")
        elif target == "QUALITY_REJECTED":
            qc_card.status = "rejected"
        elif target == "QUALITY_ON_HOLD":
            qc_card.status = "on_hold"

        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status=target,
            user=user,
            action="QUALITY_CHECK_SUBMITTED",
            team=TEAM_QUALITY,
            quality_inspection_id=qi.id,
            details=f"Result: {result_norm}",
            commit=False,
            notify=True,
        )
        if target == "QUALITY_APPROVED":
            transition_workflow_status(
                db,
                tenant_id=tenant_id,
                sales_order=so,
                new_status="PACKING_PENDING",
                user=user,
                action="PACKING_TASK_CREATED",
                team=TEAM_QUALITY,
                commit=False,
                notify=True,
                skip_permission_check=True,
            )
        elif target == "QUALITY_REJECTED":
            transition_workflow_status(
                db,
                tenant_id=tenant_id,
                sales_order=so,
                new_status="PRODUCTION_REWORK",
                user=user,
                action="QUALITY_SENT_BACK",
                team=TEAM_QUALITY,
                quality_inspection_id=qi.id,
                commit=False,
                notify=True,
                skip_permission_check=True,
            )

    db.commit()
    return {
        "inspection_id": qi.id,
        "result": qi.result,
        "workflow_status": so.workflow_status if so else None,
    }


def update_packing_dispatch(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    packing_status: str,
    packed_quantity: float | None = None,
    package_count: int | None = None,
    packing_date: date | None = None,
    courier: str | None = None,
    vehicle_number: str | None = None,
    driver_name: str | None = None,
    lr_number: str | None = None,
    tracking_url: str | None = None,
    remarks: str | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_PACKING)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    ws = (so.workflow_status or "").upper()
    if ws not in {"QUALITY_APPROVED", "PACKING_PENDING", "PACKING_IN_PROGRESS", "PACKING_ISSUE"}:
        raise HTTPException(
            status_code=409,
            detail="Packing only allowed after quality approval",
        )

    status_norm = (packing_status or "").strip().lower()
    dispatch = db.scalars(
        select(DispatchShipment).where(
            DispatchShipment.sales_order_id == so.id,
            DispatchShipment.tenant_id == tenant_id,
        )
        .order_by(DispatchShipment.id.desc())
    ).first()

    if not dispatch:
        dispatch = DispatchShipment(
            tenant_id=tenant_id,
            dispatch_number=f"DSP-{so.order_number}",
            sales_order_id=so.id,
            customer_id=so.customer_id,
            dispatch_date=packing_date or date.today(),
            status="pending",
        )
        db.add(dispatch)
        db.flush()

    if courier:
        dispatch.courier = courier
    if vehicle_number:
        dispatch.vehicle_number = vehicle_number
    if driver_name:
        dispatch.driver_name = driver_name
    if lr_number:
        dispatch.lr_number = lr_number
    if tracking_url:
        dispatch.tracking_url = tracking_url
    if packing_date:
        dispatch.dispatch_date = packing_date

    target_map = {
        "pending": "PACKING_PENDING",
        "in_progress": "PACKING_IN_PROGRESS",
        "packed": "PACKED",
        "dispatched": "PACKED",
    }
    target = target_map.get(status_norm, "PACKING_IN_PROGRESS")
    dispatch.status = status_norm if status_norm in {"packed", "dispatched", "pending"} else dispatch.status

    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status=target,
        user=user,
        action="PACKING_UPDATED",
        team=TEAM_PACKING,
        dispatch_id=dispatch.id,
        details=remarks,
        commit=False,
        notify=False,
    )

    if target == "PACKED":
        so.packed = True
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="BILLING_PENDING",
            user=user,
            action="BILLING_TASK_CREATED",
            team=TEAM_PACKING,
            dispatch_id=dispatch.id,
            commit=False,
            notify=True,
        )

    db.commit()
    db.refresh(so)
    return {
        "sales_order_id": so.id,
        "dispatch_id": dispatch.id,
        "workflow_status": so.workflow_status,
        "packed_quantity": packed_quantity,
        "package_count": package_count,
    }


def create_billing_invoice(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    *,
    invoice_number: str | None = None,
    invoice_date: date | None = None,
    remarks: str | None = None,
) -> dict[str, Any]:
    _assert_team(user, TEAM_BILLING)
    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    ws = (so.workflow_status or "").upper()
    if ws not in {"BILLING_PENDING", "BILLING_HOLD", "PACKED"}:
        raise HTTPException(
            status_code=409,
            detail=f"Billing not allowed at workflow stage {so.workflow_status}",
        )

    inv_result = create_gst_invoice_from_sales_order(
        db, tenant_id, so.id, commit=False
    )
    invoice_id = inv_result.get("invoice_id") if inv_result else None
    if invoice_id and invoice_number:
        inv = db.get(Invoice, invoice_id)
        if inv:
            inv.invoice_number = invoice_number
    if invoice_id and invoice_date:
        inv = db.get(Invoice, invoice_id)
        if inv:
            inv.issue_date = invoice_date

    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="INVOICED",
        user=user,
        action="INVOICE_CREATED",
        team=TEAM_BILLING,
        invoice_id=invoice_id,
        details=remarks,
        commit=False,
        notify=True,
    )
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="COMPLETED",
        user=user,
        action="WORKFLOW_COMPLETED",
        team=TEAM_BILLING,
        invoice_id=invoice_id,
        commit=False,
        notify=True,
    )
    db.commit()
    db.refresh(so)
    return {
        "sales_order_id": so.id,
        "invoice_id": invoice_id,
        "workflow_status": so.workflow_status,
        "invoice": inv_result,
    }


def list_team_queue(
    db: Session,
    tenant_id: int,
    user: User,
    *,
    status_filter: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Orders visible to the user's team — delegates to centralized routing service."""
    from app.services.workflow_routing_service import get_my_job_card_queue

    result = get_my_job_card_queue(
        db,
        tenant_id,
        user,
        status_filter=status_filter,
        limit=limit,
        strict=False,
    )
    return result["items"]


def list_operator_assigned_jobs(
    db: Session,
    tenant_id: int,
    user: User,
    *,
    status_filter: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Work orders assigned to the current operator (or all assigned WOs for admin/managers)."""
    from app.models.machine import Machine
    from app.services.stage_job_card_service import get_stage_card
    from sqlalchemy.orm import selectinload

    teams = user_teams(get_role_names(user))
    role_names = [r.lower() for r in get_role_names(user)]
    is_admin_or_mgr = user_is_admin(user) or any("manager" in r or "admin" in r or "supervisor" in r for r in role_names)
    is_pure_operator = (TEAM_OPERATOR in teams) and not is_admin_or_mgr

    allowed_statuses = {"PRODUCTION_ASSIGNED", "PRODUCTION_IN_PROGRESS"}
    if status_filter:
        sf = status_filter.upper()
        if sf not in allowed_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid operator job status: {sf}")
        allowed_statuses = {sf}

    stmt = (
        select(WorkOrder, SalesOrder, ProductionOrder)
        .join(ProductionOrder, WorkOrder.production_order_id == ProductionOrder.id)
        .outerjoin(SalesOrder, ProductionOrder.sales_order_id == SalesOrder.id)
        .options(selectinload(SalesOrder.customer), selectinload(SalesOrder.line_items))
        .where(
            WorkOrder.tenant_id == tenant_id,
            WorkOrder.assigned_user_id.isnot(None),
        )
        .order_by(WorkOrder.id.desc())
        .limit(limit)
    )

    if is_pure_operator:
        stmt = stmt.where(WorkOrder.assigned_user_id == user.id)

    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for wo, so, po in rows:
        product_name = None
        qty = float(wo.planned_quantity or (po.planned_quantity if po else 0))
        if so and so.line_items:
            ln = so.line_items[0]
            qty = float(ln.quantity or qty)
            product_name = ln.item_description
            if ln.product_id:
                p = db.get(Product, ln.product_id)
                product_name = p.name if p else product_name
        elif po and po.product_id:
            p = db.get(Product, po.product_id)
            if p:
                product_name = p.name

        op_card = get_stage_card(db, tenant_id, so.id, "operator") if so else None
        machine_name = None
        if wo.machine_id:
            machine = db.get(Machine, wo.machine_id)
            machine_name = machine.name if machine else None

        produced = float(wo.actual_quantity or 0)
        target = float(wo.planned_quantity or qty or 0)
        progress_pct = min(100, round((produced / target) * 100)) if target > 0 else 0

        operator_name = wo.operator_name
        if wo.assigned_user_id:
            op_user = db.get(User, wo.assigned_user_id)
            if op_user:
                operator_name = op_user.full_name

        wf_status = (so.workflow_status if so and so.workflow_status else None) or ("PRODUCTION_IN_PROGRESS" if wo.status == "in_progress" else "PRODUCTION_ASSIGNED")
        if status_filter and wf_status.upper() not in allowed_statuses:
            continue

        items.append(
            {
                "sales_order_id": so.id if so else (po.sales_order_id if po else None),
                "order_number": so.order_number if so else (po.sales_order_number or po.order_number if po else wo.work_order_number),
                "customer_name": (so.customer.name if so and so.customer else None) or (po.customer_name if po else None),
                "product_name": product_name or "Standard Item",
                "quantity": qty,
                "target_quantity": target,
                "produced_quantity": produced,
                "progress_pct": progress_pct,
                "priority": normalize_priority(so.priority if so else (po.priority if po else "medium")),
                "workflow_status": wf_status,
                "work_order_id": wo.id,
                "work_order_number": wo.work_order_number,
                "work_order_status": wo.status,
                "operator_job_card_no": op_card.card_number if op_card else None,
                "operator_card_status": op_card.status if op_card else None,
                "assigned_operator": operator_name,
                "assigned_operator_id": wo.assigned_user_id,
                "machine_name": machine_name,
                "delivery_date": (so.delivery_date.isoformat() if so and so.delivery_date else None) or (po.due_date.isoformat() if po and po.due_date else None),
                "planned_end": wo.planned_end.isoformat() if wo.planned_end else None,
            }
        )
    return items


def _get_operator_work_order(
    db: Session, tenant_id: int, work_order_id: int, user: User
) -> WorkOrder:
    wo = db.scalars(
        select(WorkOrder).where(
            WorkOrder.id == work_order_id,
            WorkOrder.tenant_id == tenant_id,
        )
    ).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    role_names = [r.lower() for r in get_role_names(user)]
    is_admin_or_mgr = user_is_admin(user) or any("manager" in r or "admin" in r or "supervisor" in r for r in role_names)
    if wo.assigned_user_id != user.id and not is_admin_or_mgr:
        raise HTTPException(status_code=403, detail="Work order not assigned to you")
    return wo


def sync_sales_workflow_on_work_order_start(
    db: Session,
    tenant_id: int,
    wo: WorkOrder,
    *,
    user: User | None = None,
) -> None:
    """Keep linked sales-order workflow in sync when a work order is started from production APIs."""
    so = _so_for_work_order(db, tenant_id, wo)
    if not so:
        return
    current = (so.workflow_status or "").upper()
    if current not in {"PRODUCTION_ASSIGNED", "READY_FOR_PRODUCTION"}:
        return

    from app.services.stage_job_card_service import get_stage_card

    op_card = get_stage_card(db, tenant_id, so.id, "operator")
    if op_card:
        op_card.status = "in_progress"
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="PRODUCTION_IN_PROGRESS",
        user=user,
        action="PRODUCTION_STARTED",
        team=TEAM_PRODUCTION,
        work_order_id=wo.id,
        commit=False,
        skip_permission_check=True,
        notify=True,
    )


def sync_sales_workflow_on_work_order_complete(
    db: Session,
    tenant_id: int,
    wo: WorkOrder,
    *,
    user: User | None = None,
) -> None:
    """Advance linked sales-order workflow when a work order is completed outside operator APIs."""
    so = _so_for_work_order(db, tenant_id, wo)
    if not so:
        return
    current = (so.workflow_status or "").upper()
    if current in {
        "QUALITY_CHECK_PENDING",
        "QUALITY_APPROVED",
        "QUALITY_REJECTED",
        "QUALITY_ON_HOLD",
        "PACKING_PENDING",
        "PACKING_IN_PROGRESS",
        "PACKED",
        "BILLING_PENDING",
        "INVOICED",
        "COMPLETED",
    }:
        return

    if current in {"PRODUCTION_ASSIGNED", "READY_FOR_PRODUCTION", "PRODUCTION_IN_PROGRESS"}:
        transition_workflow_status(
            db,
            tenant_id=tenant_id,
            sales_order=so,
            new_status="PRODUCTION_COMPLETED",
            user=user,
            action="PRODUCTION_COMPLETED",
            team=TEAM_PRODUCTION,
            work_order_id=wo.id,
            commit=False,
            skip_permission_check=True,
            notify=False,
        )

    from app.services.stage_job_card_service import complete_stage_card, ensure_stage_card, get_stage_card

    op_card = get_stage_card(db, tenant_id, so.id, "operator")
    if op_card:
        complete_stage_card(db, op_card, user, status="completed")
    qi = _create_quality_inspection_pending(db, tenant_id, so, wo, user)
    ensure_stage_card(
        db,
        tenant_id,
        so.id,
        "quality",
        quality_inspection_id=qi.id if qi else None,
        status="pending",
    )
    transition_workflow_status(
        db,
        tenant_id=tenant_id,
        sales_order=so,
        new_status="QUALITY_CHECK_PENDING",
        user=user,
        action="QUALITY_CHECK_CREATED",
        team=TEAM_PRODUCTION,
        work_order_id=wo.id,
        quality_inspection_id=qi.id if qi else None,
        commit=False,
        skip_permission_check=True,
        notify=True,
    )


def _so_for_work_order(db: Session, tenant_id: int, wo: WorkOrder) -> SalesOrder | None:
    po = db.get(ProductionOrder, wo.production_order_id)
    if not po or not po.sales_order_id:
        return None
    return db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == po.sales_order_id,
            SalesOrder.tenant_id == tenant_id,
        )
    ).first()


def _create_quality_inspection_pending(
    db: Session,
    tenant_id: int,
    so: SalesOrder,
    wo: WorkOrder,
    user: User,
    notes: str | None,
) -> QualityInspection:
    existing = db.scalars(
        select(QualityInspection).where(
            QualityInspection.tenant_id == tenant_id,
            QualityInspection.sales_order_number == so.order_number,
            QualityInspection.inspection_type == "final",
            QualityInspection.status == "pending",
        )
    ).first()
    if existing:
        return existing

    product_name = None
    qty = float(wo.actual_quantity or wo.planned_quantity or 0)
    po = db.get(ProductionOrder, wo.production_order_id)
    if po:
        prod = db.get(Product, po.product_id)
        product_name = prod.name if prod else None

    qi = QualityInspection(
        tenant_id=tenant_id,
        inspection_number=f"QI-F-{so.order_number}",
        inspection_date=date.today(),
        result="pending",
        inspection_type="final",
        status="pending",
        sales_order_number=so.order_number,
        work_order_number=wo.work_order_number,
        product_name=product_name,
        quantity=qty,
        operator_name=user.full_name,
        customer_name=so.customer.name if so.customer else None,
        notes=notes,
    )
    db.add(qi)
    db.flush()
    return qi


def get_order_workflow_context(
    db: Session, tenant_id: int, sales_order_id: int
) -> dict[str, Any]:
    """Full workflow context for team action panels."""
    from app.models.sales import DispatchShipment, Invoice
    from sqlalchemy.orm import selectinload

    so = db.scalars(
        select(SalesOrder)
        .options(selectinload(SalesOrder.line_items), selectinload(SalesOrder.customer))
        .where(SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id)
    ).first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    ws = so.workflow_status or infer_workflow_status_from_legacy(db, tenant_id, so)

    mc = db.scalars(
        select(SalesOrderMaterialCheck).where(
            SalesOrderMaterialCheck.sales_order_id == so.id,
            SalesOrderMaterialCheck.tenant_id == tenant_id,
        )
    ).first()

    work_orders: list[dict[str, Any]] = []
    pos = list(
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.sales_order_id == so.id,
            )
        ).all()
    )
    for po in pos:
        wos = list(
            db.scalars(
                select(WorkOrder).where(WorkOrder.production_order_id == po.id)
            ).all()
        )
        for wo in wos:
            assigned_name = None
            if wo.assigned_user_id:
                u = db.get(User, wo.assigned_user_id)
                assigned_name = u.full_name if u else None
            work_orders.append(
                {
                    "id": wo.id,
                    "work_order_number": wo.work_order_number,
                    "status": wo.status,
                    "planned_quantity": float(wo.planned_quantity or 0),
                    "actual_quantity": float(wo.actual_quantity or 0) if wo.actual_quantity else None,
                    "assigned_user_id": wo.assigned_user_id,
                    "assigned_user_name": assigned_name,
                    "machine_id": wo.machine_id,
                    "production_order_id": po.id,
                }
            )

    qc_rows = list(
        db.scalars(
            select(QualityInspection).where(
                QualityInspection.tenant_id == tenant_id,
                QualityInspection.sales_order_number == so.order_number,
                QualityInspection.inspection_type == "final",
            )
            .order_by(QualityInspection.id.desc())
        ).all()
    )
    quality_inspections = [
        {
            "id": q.id,
            "inspection_number": q.inspection_number,
            "status": q.status,
            "result": q.result,
            "quantity": float(q.quantity or 0) if q.quantity else None,
        }
        for q in qc_rows
    ]

    dispatch = db.scalars(
        select(DispatchShipment).where(
            DispatchShipment.tenant_id == tenant_id,
            DispatchShipment.sales_order_id == so.id,
        )
        .order_by(DispatchShipment.id.desc())
    ).first()
    dispatch_data = None
    if dispatch:
        dispatch_data = {
            "id": dispatch.id,
            "dispatch_number": dispatch.dispatch_number,
            "status": dispatch.status,
            "courier": dispatch.courier,
            "lr_number": dispatch.lr_number,
            "dispatch_date": dispatch.dispatch_date.isoformat() if dispatch.dispatch_date else None,
        }

    invoice = db.scalars(
        select(Invoice).where(
            Invoice.tenant_id == tenant_id,
            Invoice.sales_order_id == so.id,
        )
        .order_by(Invoice.id.desc())
    ).first()
    invoice_data = None
    if invoice:
        invoice_data = {
            "id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "grand_total": float(invoice.grand_total or 0),
            "issue_date": invoice.issue_date.isoformat() if invoice.issue_date else None,
        }

    product_name = None
    qty = None
    if so.line_items:
        ln = so.line_items[0]
        qty = float(ln.quantity or 0)
        product_name = ln.item_description
        if ln.product_id:
            p = db.get(Product, ln.product_id)
            product_name = p.name if p else product_name

    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "customer_name": so.customer.name if so.customer else None,
        "product_name": product_name,
        "quantity": qty,
        "priority": normalize_priority(so.priority),
        "order_status": so.status,
        "workflow_status": ws,
        "delivery_date": so.delivery_date.isoformat() if so.delivery_date else None,
        "sales_person": so.sales_person,
        "material_check": _serialize_material_check(mc, db) if mc else None,
        "work_orders": work_orders,
        "quality_inspections": quality_inspections,
        "dispatch": dispatch_data,
        "invoice": invoice_data,
    }
