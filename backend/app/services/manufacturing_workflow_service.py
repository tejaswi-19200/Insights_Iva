"""End-to-end manufacturing workflow orchestration.

Connects Sales → MRP → Procurement → Inventory → Production → QC → FG → Dispatch
so each user action posts related modules in one transactional flow.
"""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.models.bom import BillOfMaterial
from app.models.inventory import InventoryItem, Warehouse
from app.models.product import Product
from app.models.production import ProductionOrder, WorkOrder
from app.models.quality import QualityInspection
from app.models.sales import SalesOrder, SalesOrderLine
from app.schemas.inventory import StockMovementCreate
from app.schemas.procurement import MaterialRequestCreate, MaterialRequestLineCreate
from app.schemas.work_order import WorkOrderActionResponse
from app.services.inventory_service import (
    find_or_create_finished_good_for_product,
    get_default_warehouse,
    get_total_stock,
    record_stock_movement,
)
from app.services.procurement_service import (
    create_material_request,
    next_material_request_number,
)


def _product_requires_bom(product: Product | None) -> bool:
    """Finished and assembled products need an explicit recipe before production planning."""
    if not product:
        return False
    category = (product.category or "").strip().lower().replace("_", " ")
    manufactured_categories = ("assembly", "manufactured", "make to order", "mto", "build to order")
    return any(token in category for token in manufactured_categories)


def sales_order_has_final_qc_pass(
    db: Session, tenant_id: int, sales_order: SalesOrder
) -> bool:
    """True when Final QC has passed for this sales order number."""
    rows = list(
        db.scalars(
            select(QualityInspection).where(
                QualityInspection.tenant_id == tenant_id,
                QualityInspection.sales_order_number == sales_order.order_number,
                QualityInspection.inspection_type == "final",
            )
        ).all()
    )
    return any((q.result or "").lower() == "pass" for q in rows)


def link_grn_to_incoming_quality_inspection(
    db: Session, tenant_id: int, gr, *, commit: bool = True
) -> QualityInspection | None:
    """Mirror GRN QC pass into QualityInspection (incoming) for spine consistency."""
    existing = db.scalars(
        select(QualityInspection).where(
            QualityInspection.tenant_id == tenant_id,
            QualityInspection.inspection_type == "incoming",
            QualityInspection.po_reference == (gr.grn_number or ""),
        )
    ).first()
    if existing:
        return existing

    first_line = (gr.line_items or [None])[0] if getattr(gr, "line_items", None) else None
    material_name = None
    qty = None
    if first_line is not None:
        qty = float(first_line.quantity_received or 0)
        item = getattr(first_line, "item", None)
        material_name = getattr(item, "name", None) if item else None

    qi = QualityInspection(
        tenant_id=tenant_id,
        inspection_number=f"QI-IN-{gr.grn_number}",
        inspection_date=date.today(),
        result="pass",
        inspection_type="incoming",
        status="completed",
        po_reference=gr.grn_number,
        material_name=material_name,
        quantity=qty,
        notes=f"Auto-linked from GRN {gr.grn_number} QC pass",
        approval="approved",
    )
    db.add(qi)
    if commit:
        db.commit()
        db.refresh(qi)
    else:
        db.flush()
    return qi


def create_gst_invoice_from_sales_order(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
    """Auto-generate GST tax invoice from SO lines after dispatch (idempotent)."""
    from app.models.sales import Invoice
    from app.schemas.sales import InvoiceCreate, InvoiceItemCreate
    from app.services.sales_service import create_invoice

    so = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not so:
        return None
    if so.invoiced:
        return {"skipped": True, "reason": "already_invoiced"}

    existing = db.scalars(
        select(Invoice).where(
            Invoice.tenant_id == tenant_id, Invoice.sales_order_id == so.id
        )
    ).first()
    if existing:
        so.invoiced = True
        if commit:
            db.commit()
        return {"skipped": True, "invoice_id": existing.id}

    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    items = []
    for line in lines:
        qty = float(line.quantity or 0)
        rate = float(line.unit_price or 0)
        amount = float(line.line_total or round(qty * rate, 2))
        items.append(
            InvoiceItemCreate(
                item_description=line.item_description or f"Line {line.id}",
                qty=qty,
                unit=line.unit or "pcs",
                rate=rate,
                amount=amount,
            )
        )
    if not items:
        items.append(
            InvoiceItemCreate(
                item_description=f"Sales order {so.order_number}",
                qty=1,
                unit="lot",
                rate=float(so.total_amount or 0),
                amount=float(so.total_amount or 0),
            )
        )

    inv = create_invoice(
        db,
        InvoiceCreate(
            tenant_id=tenant_id,
            customer_id=so.customer_id,
            sales_order_id=so.id,
            invoice_number=f"INV-{so.order_number}",
            issue_date=date.today(),
            sgst_pct=9,
            cgst_pct=9,
            items=items,
        ),
        commit=commit,
    )
    return {
        "invoice_id": inv.id,
        "invoice_number": inv.invoice_number,
        "grand_total": float(inv.grand_total or 0),
    }


def _qty_int(value: float) -> int:
    """Stock levels are integer; round up fractional BOM requirements."""
    return max(0, int(math.ceil(float(value or 0))))


def find_or_create_inventory_item_for_product(
    db: Session,
    tenant_id: int,
    product: Product,
    *,
    item_type: str = "raw_material",
) -> InventoryItem:
    from app.services.inventory_service import get_or_create_inventory_item_for_product

    return get_or_create_inventory_item_for_product(
        db, tenant_id, product, item_type=item_type
    )


def get_bom_requirements(
    db: Session,
    tenant_id: int,
    product_id: int,
    quantity: float,
) -> list[dict[str, Any]]:
    """Explode BOM for a finished product into inventory requirements."""
    bom_rows = list(
        db.scalars(
            select(BillOfMaterial).where(
                BillOfMaterial.tenant_id == tenant_id,
                BillOfMaterial.product_id == product_id,
            )
        ).all()
    )
    requirements: list[dict[str, Any]] = []
    for row in bom_rows:
        component = db.get(Product, row.component_product_id)
        if not component:
            continue
        item = find_or_create_inventory_item_for_product(
            db, tenant_id, component, item_type="raw_material"
        )
        required = float(row.quantity) * float(quantity or 0)
        available = float(get_total_stock(db, item.id))
        shortage = max(required - available, 0.0)
        requirements.append(
            {
                "component_product_id": component.id,
                "component_name": component.name,
                "sku": component.sku,
                "item_id": item.id,
                "unit": row.unit,
                "required_qty": round(required, 4),
                "available_qty": available,
                "shortage_qty": round(shortage, 4),
                "enough": shortage <= 0,
            }
        )
    return requirements


def run_mrp(
    db: Session,
    tenant_id: int,
    product_id: int,
    quantity: float,
    *,
    create_purchase_request: bool = True,
    requested_by: str | None = None,
    reference: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Material Requirement Planning: check stock; optionally open a material request."""
    product = db.scalars(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    requirements = get_bom_requirements(db, tenant_id, product_id, quantity)
    if not requirements and _product_requires_bom(product):
        raise HTTPException(
            status_code=400,
            detail=f"No verified BOM is available for '{product.name}'. A production-authorized member must create or replace the BOM before material planning.",
        )
    shortages = [r for r in requirements if not r["enough"]]
    material_request_id = None
    mr_number = None

    if create_purchase_request and shortages:
        mr_number = next_material_request_number(db, tenant_id)
        lines = [
            MaterialRequestLineCreate(
                item_id=s["item_id"],
                quantity=max(0.01, float(s["shortage_qty"])),
                notes=f"MRP shortage for {product.sku} x {quantity}",
            )
            for s in shortages
        ]
        mr = create_material_request(
            db,
            MaterialRequestCreate(
                tenant_id=tenant_id,
                mr_number=mr_number,
                request_date=date.today(),
                required_date=None,
                requested_by=requested_by or "MRP",
                status="pending",
                notes=f"Auto MRP for {product.name}"
                + (f" / {reference}" if reference else ""),
                line_items=lines,
            ),
            commit=commit,
        )
        material_request_id = mr.id

    return {
        "product_id": product_id,
        "product_name": product.name,
        "sku": product.sku,
        "quantity": float(quantity),
        "requirements": requirements,
        "enough_stock": len(shortages) == 0,
        "shortage_count": len(shortages),
        "material_request_id": material_request_id,
        "material_request_number": mr_number,
        "action": "produce" if len(shortages) == 0 else "purchase",
    }


def issue_materials_for_work_order(
    db: Session,
    tenant_id: int,
    work_order_id: int,
    *,
    warehouse_id: int | None = None,
    force: bool = False,
    commit: bool = True,
) -> dict[str, Any]:
    """Consume BOM materials for a work order (inventory OUT + stock ledger)."""
    wo = db.scalars(
        select(WorkOrder).where(
            WorkOrder.id == work_order_id, WorkOrder.tenant_id == tenant_id
        )
    ).first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo.status in {"completed", "closed", "done"}:
        raise HTTPException(status_code=400, detail="Work order already completed")
    if getattr(wo, "materials_issued", False) and not force:
        return {
            "success": True,
            "already_issued": True,
            "work_order_id": wo.id,
            "movements": [],
            "message": "Materials already issued",
        }

    po = db.get(ProductionOrder, wo.production_order_id)
    if not po:
        raise HTTPException(status_code=400, detail="Production order missing")

    warehouse = None
    if warehouse_id:
        w = db.get(Warehouse, warehouse_id)
        if not w or w.tenant_id != tenant_id:
            raise HTTPException(
                status_code=400,
                detail="Specified warehouse does not exist or does not belong to your company.",
            )
        warehouse = w
    if not warehouse:
        warehouse = get_default_warehouse(db, tenant_id)
    if not warehouse:
        raise HTTPException(
            status_code=400,
            detail="No warehouse found. Create a warehouse before issuing materials.",
        )

    requirements = get_bom_requirements(
        db, tenant_id, po.product_id, float(wo.planned_quantity or 0)
    )
    if not requirements:
        wo.materials_issued = True
        if commit:
            db.commit()
            db.refresh(wo)
        else:
            db.flush()
        return {
            "success": True,
            "already_issued": False,
            "work_order_id": wo.id,
            "movements": [],
            "message": "No BOM components — nothing to issue",
        }

    shortages = [r for r in requirements if not r["enough"]]
    if shortages and not force:
        names = ", ".join(f"{s['component_name']} (need {s['shortage_qty']})" for s in shortages[:5])
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock to issue materials: {names}. Run MRP / receive GRN first.",
        )

    movements = []
    try:
        for req in requirements:
            qty = _qty_int(req["required_qty"])
            if qty <= 0:
                continue
            mov = record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=warehouse.id,
                    item_id=req["item_id"],
                    quantity=qty,
                    movement_type="out",
                ),
                commit=False,
            )
            movements.append(
                {
                    "item_id": req["item_id"],
                    "sku": req["sku"],
                    "name": req["component_name"],
                    "quantity": qty,
                    "unit": req["unit"],
                    "movement_id": mov.id,
                }
            )

        wo.materials_issued = True
        if wo.status in {"draft", "planned", "pending", "released"}:
            wo.status = "material_ready"
        if commit:
            db.commit()
            db.refresh(wo)
        else:
            db.flush()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "issue_materials_for_work_order failed for work_order_id=%s: %s",
            work_order_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to issue materials for work order.",
        ) from exc
    return {
        "success": True,
        "already_issued": False,
        "work_order_id": wo.id,
        "warehouse_id": warehouse.id,
        "movements": movements,
        "message": f"Issued {len(movements)} material line(s)",
    }


def _ensure_final_qc_pass(
    db: Session,
    tenant_id: int,
    wo: WorkOrder,
    po: ProductionOrder,
    product: Product | None,
    *,
    qty: float,
    auto_pass: bool = True,
) -> QualityInspection:
    """Require a final QC pass before FG posting. Creates one if auto_pass."""
    existing = db.scalars(
        select(QualityInspection).where(
            QualityInspection.tenant_id == tenant_id,
            QualityInspection.work_order_number == wo.work_order_number,
            QualityInspection.inspection_type == "final",
            QualityInspection.result == "pass",
        )
    ).first()
    if existing:
        return existing

    if not auto_pass:
        raise HTTPException(
            status_code=400,
            detail="Final QC pass required before completing work order / posting finished goods.",
        )

    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    qi = QualityInspection(
        tenant_id=tenant_id,
        inspection_number=f"QC-WO-{ts}",
        inspection_date=date.today(),
        product_id=po.product_id,
        result="pass",
        inspector="System",
        notes=f"Auto final QC on WO complete {wo.work_order_number}",
        inspection_type="final",
        status="completed",
        work_order_number=wo.work_order_number,
        product_name=product.name if product else None,
        quantity=qty,
        sales_order_number=po.sales_order_number,
        approval="approved",
    )
    db.add(qi)
    db.flush()
    return qi


def receive_finished_goods(
    db: Session,
    tenant_id: int,
    product: Product,
    quantity: float,
    *,
    warehouse_id: int | None = None,
    reference: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Post finished goods into inventory (stock IN + ledger)."""
    qty = _qty_int(quantity)
    if qty <= 0:
        return {"posted": False, "quantity": 0, "message": "Nothing to post"}

    warehouse = None
    if warehouse_id:
        w = db.get(Warehouse, warehouse_id)
        if not w or w.tenant_id != tenant_id:
            raise HTTPException(
                status_code=400,
                detail="Specified warehouse does not exist or does not belong to your company.",
            )
        warehouse = w
    if not warehouse:
        warehouse = get_default_warehouse(db, tenant_id)
    if not warehouse:
        raise HTTPException(
            status_code=400,
            detail="No warehouse found. Create a warehouse before posting finished goods.",
        )

    item = find_or_create_finished_good_for_product(db, tenant_id, product)
    if item.item_type != "finished_good":
        item.item_type = "finished_good"

    mov = record_stock_movement(
        db,
        StockMovementCreate(
            tenant_id=tenant_id,
            warehouse_id=warehouse.id,
            item_id=item.id,
            quantity=qty,
            movement_type="in",
        ),
        commit=False,
    )
    if commit:
        db.commit()
    else:
        db.flush()

    return {
        "posted": True,
        "quantity": qty,
        "item_id": item.id,
        "sku": item.sku,
        "warehouse_id": warehouse.id,
        "movement_id": mov.id,
        "reference": reference,
    }


def complete_work_order_integrated(
    db: Session,
    tenant_id: int,
    work_order_id: int,
    *,
    auto_issue_materials: bool = True,
    auto_qc_pass: bool = False,
    user_id: int | None = None,
) -> WorkOrderActionResponse:
    """
    Complete WO with automatic cross-module updates:
    materials → Final QC (required) → FG inventory + batch → production status.
    auto_qc_pass defaults to False so mandatory Final QC cannot be skipped.
    """
    from app.services.work_order_service import _to_list_read

    wo = db.scalars(
        select(WorkOrder).where(
            WorkOrder.id == work_order_id, WorkOrder.tenant_id == tenant_id
        )
    ).first()
    if not wo:
        return WorkOrderActionResponse(success=False, message="Work order not found")
    if wo.status in {"completed", "closed", "done"}:
        return WorkOrderActionResponse(
            success=True,
            work_order=_to_list_read(db, tenant_id, wo),
            message="Work order already completed",
            steps=["Already completed"],
        )

    po = db.get(ProductionOrder, wo.production_order_id)
    if not po:
        return WorkOrderActionResponse(success=False, message="Production order missing")
    product = db.get(Product, po.product_id)

    steps: list[str] = []
    try:
        if auto_issue_materials and not getattr(wo, "materials_issued", False):
            issue_result = issue_materials_for_work_order(
                db, tenant_id, wo.id, commit=False
            )
            steps.append(issue_result.get("message") or "Materials issued")
            db.refresh(wo)

        qty = float(wo.actual_quantity or wo.planned_quantity or 0)
        qi = _ensure_final_qc_pass(
            db, tenant_id, wo, po, product, qty=qty, auto_pass=auto_qc_pass
        )
        steps.append(f"Quality inspection passed ({qi.inspection_number})")
        if not getattr(qi, "packing_status", None):
            qi.packing_status = "ready_for_pack"
            steps.append("Packing released (ready_for_pack)")

        if product:
            fg = receive_finished_goods(
                db,
                tenant_id,
                product,
                qty,
                reference=wo.work_order_number,
                commit=False,
            )
            if fg.get("posted"):
                steps.append(
                    f"Finished goods posted: {fg['sku']} +{fg['quantity']} to warehouse #{fg['warehouse_id']}"
                )
                batch = _ensure_production_batch(db, tenant_id, wo, qty)
                if batch:
                    steps.append(f"Batch generated: {batch.batch_code}")
                    _ensure_item_barcode(db, fg.get("item_id"), batch.batch_code)
            else:
                steps.append("Finished goods: nothing to post")
        else:
            steps.append("Finished goods skipped (product missing)")

        wo.actual_quantity = qty
        wo.status = "completed"
        wo.planned_end = datetime.now(timezone.utc)
        steps.append("Work order closed")

        # Roll up production order if all WOs completed
        sibling_wos = list(
            db.scalars(
                select(WorkOrder).where(WorkOrder.production_order_id == po.id)
            ).all()
        )
        if sibling_wos and all(
            w.status in {"completed", "closed", "done"} or w.id == wo.id
            for w in sibling_wos
        ):
            po.status = "completed"
            steps.append(f"Production order {po.order_number} completed")

        try:
            from app.services.audit_service import log_audit

            log_audit(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                action="work_order.complete",
                resource="work_orders",
                resource_id=wo.id,
                details="; ".join(steps),
            )
        except Exception:
            # Audit must not block completion
            pass

        actor = None
        if user_id:
            from app.models.user import User

            actor = db.get(User, user_id)
        from app.services.workflow_team_service import sync_sales_workflow_on_work_order_complete

        sync_sales_workflow_on_work_order_complete(db, tenant_id, wo, user=actor)

        db.commit()
        db.refresh(wo)
    except HTTPException as exc:
        db.rollback()
        return WorkOrderActionResponse(
            success=False,
            message=str(exc.detail),
            steps=steps,
        )
    except Exception as exc:
        db.rollback()
        return WorkOrderActionResponse(
            success=False,
            message=f"Completion failed: {exc}",
            steps=steps,
        )

    _emit_wo_completed(db, tenant_id, wo)

    return WorkOrderActionResponse(
        success=True,
        steps=steps,
        work_order=_to_list_read(db, tenant_id, wo),
        message="Work order completed — inventory, QC, and production updated",
    )


def _emit_wo_completed(db, tenant_id: int, wo) -> None:
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="work_order_completed",
            title=f"Work order completed: {wo.work_order_number}",
            message=f"WO {wo.work_order_number} completed — FG received",
            severity="medium",
            link=f"/production/work-orders?id={wo.id}",
            reference_type="work_order",
            reference_id=wo.id,
            created_by="Production",
        )
    except Exception:
        pass


def _ensure_production_batch(
    db: Session, tenant_id: int, wo: WorkOrder, qty: float
):
    """Create a production batch for FG traceability (idempotent per WO)."""
    from app.models.production import Batch

    existing = db.scalars(
        select(Batch).where(
            Batch.tenant_id == tenant_id,
            Batch.work_order_id == wo.id,
        )
    ).first()
    if existing:
        return existing
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    batch = Batch(
        tenant_id=tenant_id,
        work_order_id=wo.id,
        batch_code=f"BATCH-{wo.work_order_number}-{ts[-6:]}",
        quantity=float(qty or 0),
        produced_at=datetime.now(timezone.utc),
        status="completed",
    )
    db.add(batch)
    db.flush()
    return batch


def _ensure_item_barcode(db: Session, item_id: int | None, batch_code: str) -> None:
    """Stamp FG inventory item barcode from batch when missing."""
    if not item_id or not batch_code:
        return
    item = db.get(InventoryItem, item_id)
    if item and not getattr(item, "barcode", None):
        item.barcode = batch_code


def ensure_work_order_for_production_order(
    db: Session,
    tenant_id: int,
    po: ProductionOrder,
) -> WorkOrder:
    """Create a planned work order for a production order if none exists."""
    existing = db.scalars(
        select(WorkOrder).where(
            WorkOrder.tenant_id == tenant_id,
            WorkOrder.production_order_id == po.id,
        )
    ).first()
    if existing:
        return existing
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    wo = WorkOrder(
        tenant_id=tenant_id,
        production_order_id=po.id,
        machine_id=po.machine_id,
        work_order_number=f"WO-{po.order_number}-{ts[-4:]}",
        planned_quantity=float(po.planned_quantity or 0),
        status="planned",
        priority=po.priority or "medium",
        department=po.department,
        shift=po.shift,
        materials_issued=False,
    )
    db.add(wo)
    db.flush()
    return wo


def confirm_sales_order_workflow(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    *,
    create_production: bool = True,
    run_mrp_and_pr: bool = True,
    requested_by: str | None = None,
) -> dict[str, Any]:
    """
    Confirm SO → explode lines → MRP → optional production orders + purchase requests.
    """
    so = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")

    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    if not lines:
        # Header-only SO: cannot plan manufacturing without product lines
        so.status = "confirmed"
        db.commit()
        db.refresh(so)
        return {
            "sales_order_id": so.id,
            "order_number": so.order_number,
            "status": so.status,
            "warning": "Sales order has no line items — add products before MRP/production.",
            "mrp_results": [],
            "production_orders": [],
        }

    mrp_results = []
    production_orders = []
    work_orders = []
    try:
        for line in lines:
            if not line.product_id:
                continue
            product = db.get(Product, line.product_id)
            bom_reqs = get_bom_requirements(
                db, tenant_id, line.product_id, float(line.quantity)
            )
            if create_production and not bom_reqs:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No verified BOM for product "
                        f"'{product.name if product else line.product_id}'. "
                        "A production-authorized member must create or replace the BOM before confirming production."
                    ),
                )
            mrp = run_mrp(
                db,
                tenant_id,
                line.product_id,
                float(line.quantity),
                create_purchase_request=run_mrp_and_pr,
                requested_by=requested_by or "Sales Order Confirm",
                reference=so.order_number,
                commit=False,
            )
            mrp_results.append(mrp)

            if create_production:
                # Stable order number per SO line (idempotent re-confirm)
                order_number = f"PO-{so.order_number}-L{line.id}"
                po = db.scalars(
                    select(ProductionOrder).where(
                        ProductionOrder.tenant_id == tenant_id,
                        ProductionOrder.order_number == order_number,
                    )
                ).first()
                if not po:
                    po = ProductionOrder(
                        tenant_id=tenant_id,
                        product_id=line.product_id,
                        order_number=order_number,
                        planned_quantity=float(line.quantity),
                        status="planned",
                        priority="medium",
                        sales_order_number=so.order_number,
                        sales_order_id=so.id,
                        customer_name=None,
                    )
                    db.add(po)
                    db.flush()
                wo = ensure_work_order_for_production_order(db, tenant_id, po)
                production_orders.append(
                    {
                        "id": po.id,
                        "order_number": po.order_number,
                        "product": product.name if product else None,
                        "quantity": float(line.quantity),
                        "enough_stock": mrp["enough_stock"],
                        "work_order_id": wo.id,
                        "work_order_number": wo.work_order_number,
                        "bom_components": len(bom_reqs),
                    }
                )
                work_orders.append(
                    {
                        "id": wo.id,
                        "work_order_number": wo.work_order_number,
                        "production_order_id": po.id,
                        "status": wo.status,
                    }
                )

        so.status = "confirmed"
        db.commit()
        db.refresh(so)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "confirm_sales_order_workflow failed for sales_order_id=%s: %s",
            sales_order_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to confirm sales order workflow.",
        ) from exc

    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="sales_order_confirmed",
            title=f"Sales order confirmed: {so.order_number}",
            message=(
                f"SO {so.order_number} confirmed — MRP run, "
                f"{len(production_orders)} production order(s), "
                f"{len(work_orders)} work order(s) created."
            ),
            severity="medium",
            link=f"/sales/orders/{so.id}",
            reference_type="sales_order",
            reference_id=so.id,
            created_by="Sales",
        )
    except Exception:
        pass

    try:
        from app.services.audit_service import log_audit

        log_audit(
            db,
            tenant_id=tenant_id,
            user_id=None,
            action="sales_order.confirm",
            resource="sales_orders",
            resource_id=so.id,
            details=(
                f"MRP lines={len(mrp_results)}; "
                f"production={len(production_orders)}; work_orders={len(work_orders)}"
            ),
        )
    except Exception:
        pass

    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "status": so.status,
        "mrp_results": mrp_results,
        "production_orders": production_orders,
        "work_orders": work_orders,
        "next_steps": [
            "Review MRP / Purchase Requests if materials short",
            "Allocate machine & operator on Work Orders",
            "Issue materials → execute production → Final QC → Dispatch",
        ],
    }


def ship_sales_order_stock_out(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    *,
    warehouse_id: int | None = None,
    auto_invoice: bool = True,
) -> dict[str, Any]:
    """On dispatch/ship: deduct finished goods for each SO line; optionally GST invoice."""
    so = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if not so.packed:
        raise HTTPException(
            status_code=400,
            detail="Packing must be completed before dispatch.",
        )

    # Production lines require Final QC before dispatch (bottle mfg gate)
    lines_preview = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    has_product_lines = any(l.product_id for l in lines_preview)
    if has_product_lines and not sales_order_has_final_qc_pass(db, tenant_id, so):
        raise HTTPException(
            status_code=400,
            detail=(
                "Final quality inspection must pass before dispatch. "
                "Complete Final QC for this sales order first."
            ),
        )

    warehouse = None
    if warehouse_id:
        w = db.get(Warehouse, warehouse_id)
        if not w or w.tenant_id != tenant_id:
            raise HTTPException(
                status_code=400,
                detail="Specified warehouse does not exist or does not belong to your company.",
            )
        warehouse = w
    if not warehouse:
        warehouse = get_default_warehouse(db, tenant_id)
    if not warehouse:
        raise HTTPException(status_code=400, detail="No warehouse for stock-out")

    lines = lines_preview
    movements = []
    if not lines:
        so.shipped = True
        so.status = "shipped"
        invoice_info = None
        if auto_invoice and so.customer_id:
            try:
                invoice_info = create_gst_invoice_from_sales_order(
                    db, tenant_id, so.id, commit=False
                )
            except Exception as exc:
                db.rollback()
                raise HTTPException(
                    status_code=400,
                    detail=f"Dispatch failed during automatic invoice creation: {exc}",
                ) from exc
        db.commit()
        return {
            "sales_order_id": so.id,
            "shipped": True,
            "warning": "No line items — flags updated without stock movement",
            "movements": [],
            "invoice": invoice_info,
        }

    try:
        for line in lines:
            if not line.product_id:
                continue
            product = db.get(Product, line.product_id)
            if not product:
                continue
            item = find_or_create_finished_good_for_product(db, tenant_id, product)
            qty = _qty_int(line.quantity)
            available = get_total_stock(db, item.id)
            if available < qty:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Insufficient finished goods for {product.sku}: "
                        f"need {qty}, available {available}"
                    ),
                )
            mov = record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=warehouse.id,
                    item_id=item.id,
                    quantity=qty,
                    movement_type="out",
                ),
                commit=False,
            )
            movements.append(
                {
                    "sku": product.sku,
                    "quantity": qty,
                    "movement_id": mov.id,
                }
            )

        so.shipped = True
        so.packed = True
        so.status = "shipped"

        invoice_info = None
        if auto_invoice and so.customer_id:
            invoice_info = create_gst_invoice_from_sales_order(
                db, tenant_id, so.id, commit=False
            )

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        logger.exception("Failed dispatch/invoice for sales order id=%s: %s", sales_order_id, exc)
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Dispatch failed during automatic invoice creation: {exc}",
        ) from exc

    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="dispatch_completed",
            title=f"Dispatch completed: {so.order_number}",
            message=(
                f"Sales order {so.order_number} shipped — {len(movements)} FG movement(s)"
                + (
                    f"; invoice {invoice_info.get('invoice_number')}"
                    if invoice_info and invoice_info.get("invoice_number")
                    else ""
                )
            ),
            severity="medium",
            link="/sales/dispatch",
            reference_type="sales_order",
            reference_id=so.id,
            created_by="Dispatch",
        )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "shipped": True,
        "movements": movements,
        "invoice": invoice_info,
        "message": f"Shipped — {len(movements)} FG stock-out movement(s)",
    }


def get_order_traceability(
    db: Session, tenant_id: int, sales_order_id: int
) -> dict[str, Any]:
    """
    End-to-end traceability for a sales order using existing module records.
    Does not create new tables — aggregates linked CRM → Finance chain.
    """
    from app.models.procurement import GoodsReceipt, MaterialRequest, PurchaseOrder
    from app.models.production import Batch
    from app.models.sales import Invoice, Payment, Quotation

    so = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")

    quote = None
    if so.reference_number:
        quote = db.scalars(
            select(Quotation).where(
                Quotation.tenant_id == tenant_id,
                Quotation.quote_number == so.reference_number,
            )
        ).first()

    production_orders = list(
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.sales_order_id == so.id,
            )
        ).all()
    )
    wo_ids: list[int] = []
    work_orders: list[dict] = []
    for po in production_orders:
        for wo in list(
            db.scalars(
                select(WorkOrder).where(WorkOrder.production_order_id == po.id)
            ).all()
        ):
            wo_ids.append(wo.id)
            work_orders.append(
                {
                    "id": wo.id,
                    "work_order_number": wo.work_order_number,
                    "status": wo.status,
                    "materials_issued": bool(wo.materials_issued),
                    "machine_id": wo.machine_id,
                    "operator_name": wo.operator_name,
                }
            )

    batches = []
    if wo_ids:
        batches = [
            {
                "id": b.id,
                "batch_code": b.batch_code,
                "quantity": float(b.quantity or 0),
                "status": b.status,
                "work_order_id": b.work_order_id,
            }
            for b in db.scalars(
                select(Batch).where(
                    Batch.tenant_id == tenant_id, Batch.work_order_id.in_(wo_ids)
                )
            ).all()
        ]

    qc = [
        {
            "id": q.id,
            "inspection_number": q.inspection_number,
            "inspection_type": q.inspection_type,
            "result": q.result,
            "status": q.status,
            "packing_status": getattr(q, "packing_status", None),
            "work_order_number": q.work_order_number,
        }
        for q in db.scalars(
            select(QualityInspection).where(
                QualityInspection.tenant_id == tenant_id,
                QualityInspection.sales_order_number == so.order_number,
            )
        ).all()
    ]

    mrs = []
    if so.order_number:
        mrs = [
            {
                "id": m.id,
                "mr_number": m.mr_number,
                "status": m.status,
                "approval_status": m.approval_status,
            }
            for m in db.scalars(
                select(MaterialRequest).where(
                    MaterialRequest.tenant_id == tenant_id,
                    MaterialRequest.notes.contains(so.order_number),
                )
            ).all()
        ]

    mr_ids = [m["id"] for m in mrs]
    purchase_orders = []
    if mr_ids:
        purchase_orders = [
            {
                "id": p.id,
                "po_number": p.po_number,
                "status": p.status,
                "material_request_id": p.material_request_id,
            }
            for p in db.scalars(
                select(PurchaseOrder).where(
                    PurchaseOrder.tenant_id == tenant_id,
                    PurchaseOrder.material_request_id.in_(mr_ids),
                )
            ).all()
        ]

    grns = []
    if purchase_orders:
        po_ids = [p["id"] for p in purchase_orders]
        grns = [
            {
                "id": g.id,
                "grn_number": g.grn_number,
                "status": g.status,
                "qc_status": g.qc_status,
            }
            for g in db.scalars(
                select(GoodsReceipt).where(
                    GoodsReceipt.tenant_id == tenant_id,
                    GoodsReceipt.purchase_order_id.in_(po_ids),
                )
            ).all()
        ]

    invoices = [
        {
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "status": inv.status,
            "total_amount": float(inv.total_amount or 0),
            "amount_paid": float(getattr(inv, "amount_paid", 0) or 0),
        }
        for inv in db.scalars(
            select(Invoice).where(
                Invoice.tenant_id == tenant_id, Invoice.sales_order_id == so.id
            )
        ).all()
    ]
    invoice_ids = [i["id"] for i in invoices]
    payments = []
    if invoice_ids:
        payments = [
            {
                "id": p.id,
                "amount": float(p.amount or 0),
                "payment_date": str(p.payment_date) if p.payment_date else None,
                "invoice_id": p.invoice_id,
            }
            for p in db.scalars(
                select(Payment).where(
                    Payment.tenant_id == tenant_id, Payment.invoice_id.in_(invoice_ids)
                )
            ).all()
        ]

    steps = [
        {
            "id": "enquiry_quotation",
            "label": "Enquiry / Quotation",
            "done": bool(quote) or (so.status or "").lower() != "draft",
            "refs": {"quotation_id": quote.id if quote else None},
        },
        {
            "id": "sales_order",
            "label": "Sales Order",
            "done": True,
            "refs": {"sales_order_id": so.id, "status": so.status},
        },
        {
            "id": "mrp_procurement",
            "label": "MRP / Purchase",
            "done": bool(mrs)
            or bool(purchase_orders)
            or (so.status or "").lower()
            in {"confirmed", "approved", "shipped", "invoiced", "completed"},
            "refs": {
                "material_requests": mrs,
                "purchase_orders": purchase_orders,
                "grns": grns,
            },
        },
        {
            "id": "production",
            "label": "Production / Work Orders",
            "done": bool(production_orders),
            "refs": {
                "production_orders": [
                    {"id": p.id, "order_number": p.order_number, "status": p.status}
                    for p in production_orders
                ],
                "work_orders": work_orders,
            },
        },
        {
            "id": "quality_batch",
            "label": "Final QC / Batch / FG",
            "done": any(q.get("result") == "pass" for q in qc) or bool(batches),
            "refs": {"inspections": qc, "batches": batches},
        },
        {
            "id": "dispatch",
            "label": "Packing / Dispatch",
            "done": bool(so.packed) or bool(so.shipped),
            "refs": {"packed": so.packed, "shipped": so.shipped, "status": so.status},
        },
        {
            "id": "finance",
            "label": "Invoice / Payment",
            "done": bool(invoices),
            "refs": {"invoices": invoices, "payments": payments},
        },
    ]

    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "status": so.status,
        "steps": steps,
        "complete": all(s["done"] for s in steps),
    }


# ---------------------------------------------------------------------------
# Role-based workflow board (aggregates existing entities — no new tables)
# ---------------------------------------------------------------------------

WORKFLOW_STAGE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "enquiry",
        "label": "Customer Enquiry",
        "responsible_role": "Sales Manager",
        "path": "/sales/leads",
        "module": "sales",
        "tasks": ["Resolve customer enquiry", "Capture requirements"],
    },
    {
        "id": "quotation",
        "label": "Quotation Prep",
        "responsible_role": "Sales Manager",
        "path": "/sales/quotations",
        "module": "sales",
        "tasks": ["Prepare quotation", "Price, GST, validity"],
    },
    {
        "id": "quotation_approval",
        "label": "Quote Internal Approval",
        "responsible_role": "Sales Manager",
        "path": "/sales/quotations",
        "module": "sales",
        "tasks": ["Submit for approval", "Manage approve / reject"],
    },
    {
        "id": "quotation_sent",
        "label": "Quote Sent / Confirm",
        "responsible_role": "Sales Manager",
        "path": "/sales/quotations",
        "module": "sales",
        "tasks": ["Send to customer", "Customer confirmation"],
    },
    {
        "id": "sales_order",
        "label": "Sales Order",
        "responsible_role": "Sales Manager",
        "path": "/sales/orders",
        "module": "sales",
        "tasks": ["Create SO", "Approve / Confirm → Planning"],
    },
    {
        "id": "production_planning",
        "label": "Production Planning",
        "responsible_role": "Production Manager",
        "path": "/production/planning",
        "module": "production",
        "tasks": ["Review SO", "Create production plan"],
    },
    {
        "id": "bom",
        "label": "BOM",
        "responsible_role": "Production Manager",
        "path": "/masters/bom",
        "module": "masters",
        "tasks": ["Load active BOM", "Verify components"],
    },
    {
        "id": "capacity",
        "label": "Capacity / Schedule",
        "responsible_role": "Production Manager",
        "path": "/production/schedule",
        "module": "production",
        "tasks": ["Machine capacity check", "Production schedule"],
    },
    {
        "id": "purchase_request",
        "label": "Purchase Requisition",
        "responsible_role": "Production Manager",
        "path": "/procurement/material-requests",
        "module": "procurement",
        "tasks": ["Review shortages", "PM approve PR"],
    },
    {
        "id": "purchase_order",
        "label": "Purchase Order",
        "responsible_role": "Production Manager",
        "path": "/procurement/purchase-orders",
        "module": "procurement",
        "tasks": ["Create PO", "Supplier confirmation"],
    },
    {
        "id": "grn",
        "label": "GRN",
        "responsible_role": "Store Manager",
        "path": "/procurement/goods-receipt",
        "module": "procurement",
        "tasks": ["Material receipt", "Create GRN"],
    },
    {
        "id": "incoming_qc",
        "label": "Incoming QC",
        "responsible_role": "Production Manager",
        "path": "/quality/incoming",
        "module": "quality",
        "tasks": ["Incoming material inspection", "Approve or reject"],
    },
    {
        "id": "raw_material",
        "label": "Inventory Update",
        "responsible_role": "Store Manager",
        "path": "/inventory/raw-materials",
        "module": "inventory",
        "tasks": ["Post stock after QC"],
    },
    {
        "id": "work_order",
        "label": "Work Order",
        "responsible_role": "Production Manager",
        "path": "/production/work-orders",
        "module": "production",
        "tasks": ["Generate / release work order"],
    },
    {
        "id": "machine_assign",
        "label": "Assign Machine / Crew",
        "responsible_role": "Production Manager",
        "path": "/production/tasks",
        "module": "production",
        "tasks": [
            "Assign machines",
            "Assign operators",
            "Start production",
            "Monitor production progress",
        ],
    },
    {
        "id": "material_issue",
        "label": "Material Issue",
        "responsible_role": "Store Manager",
        "path": "/production/work-orders",
        "module": "inventory",
        "tasks": ["Reserve / issue raw materials"],
    },
    {
        "id": "production",
        "label": "Production Execution",
        "responsible_role": "Operator",
        "path": "/factory-monitor/live-production",
        "module": "production",
        "tasks": [
            "Setup",
            "Start",
            "Live tracking",
            "Downtime",
            "Complete",
        ],
    },
    {
        "id": "in_process_qc",
        "label": "In-Process QC",
        "responsible_role": "Production Manager",
        "path": "/quality/in-process",
        "module": "quality",
        "tasks": ["In-process quality inspection"],
    },
    {
        "id": "final_qc",
        "label": "Final QC",
        "responsible_role": "Production Manager",
        "path": "/quality/final",
        "module": "quality",
        "tasks": ["Final product inspection", "Approve / rework / reject"],
    },
    {
        "id": "batch",
        "label": "Batch / Lot",
        "responsible_role": "Production Manager",
        "path": "/production/batches",
        "module": "production",
        "tasks": ["Batch generation", "Lot tracking"],
    },
    {
        "id": "finished_goods",
        "label": "Finished Goods",
        "responsible_role": "Store Manager",
        "path": "/inventory/finished-goods",
        "module": "inventory",
        "tasks": ["Receive FG", "Put-away", "Stock update"],
    },
    {
        "id": "maintenance",
        "label": "Maintenance",
        "responsible_role": "Production Manager",
        "path": "/maintenance",
        "module": "maintenance",
        "tasks": ["Preventive / breakdown support"],
    },
    {
        "id": "dispatch",
        "label": "Packing & Dispatch",
        "responsible_role": "Store Manager",
        "path": "/sales/dispatch",
        "module": "sales",
        "tasks": ["Pack", "Vehicle", "Challan", "Dispatch"],
    },
    {
        "id": "delivery",
        "label": "Delivery Confirm",
        "responsible_role": "Store Manager",
        "path": "/sales/dispatch",
        "module": "sales",
        "tasks": ["Shipment tracking", "Delivery confirmation"],
    },
    {
        "id": "invoice",
        "label": "GST Invoice",
        "responsible_role": "Accountant",
        "path": "/sales/invoices",
        "module": "accounts",
        "tasks": ["Tax invoice", "Accounts receivable"],
    },
    {
        "id": "payment",
        "label": "Payment",
        "responsible_role": "Accountant",
        "path": "/sales/payments",
        "module": "accounts",
        "tasks": ["Collect payment", "Reconcile"],
    },
    {
        "id": "order_close",
        "label": "Order Closure",
        "responsible_role": "Accountant",
        "path": "/sales/orders",
        "module": "accounts",
        "tasks": ["Close invoice", "Close sales order"],
    },
    {
        "id": "after_sales",
        "label": "After-Sales",
        "responsible_role": "Sales Manager",
        "path": "/quality/defects",
        "module": "sales",
        "tasks": ["Feedback", "Complaint / return", "Satisfaction"],
    },
    {
        "id": "dashboard",
        "label": "Management KPIs",
        "responsible_role": "Admin",
        "path": "/analytics/executive",
        "module": "analytics",
        "tasks": ["Live dashboards", "Department KPIs"],
    },
]

# Login role → personas whose stages they may see ( "*" = full chain )
ROLE_WORKFLOW_VISIBILITY: dict[str, list[str]] = {
    "Admin": ["*"],
    "Sales Manager": ["Sales Manager"],
    "Production Manager": [
        "Production Manager",
        "Operator",
    ],
    "Store Manager": ["Store Manager"],
    "Accountant": ["Accountant"],
    "Operator": ["Operator"],
    "HR Manager": [],
}


def _primary_role_name(user) -> str | None:
    roles = getattr(user, "roles", None) or []
    names = []
    for r in roles:
        name = getattr(r, "name", None) or (r if isinstance(r, str) else None)
        if name:
            names.append(name)
    if names:
        if "Admin" in names:
            return "Admin"
        return names[0]
    return getattr(user, "role", None)


def _visibility_for_role(role_name: str | None) -> set[str] | None:
    """Return set of responsible_role labels visible, or None for full chain."""
    if not role_name:
        return set()
    vis = ROLE_WORKFLOW_VISIBILITY.get(role_name)
    if vis is None:
        # Unknown role: deny stage list (still can use module pages via RBAC)
        return set()
    if "*" in vis:
        return None
    return set(vis)


def _stage_payload(
    catalog: dict[str, Any],
    *,
    status: str,
    assigned_user: str | None,
    started_at: str | None,
    completed_at: str | None,
    pending_actions: list[str],
    approval_status: str | None,
    blocked: bool = False,
    block_reason: str | None = None,
) -> dict[str, Any]:
    return {
        "id": catalog["id"],
        "label": catalog["label"],
        "responsible_role": catalog["responsible_role"],
        "path": catalog["path"],
        "module": catalog["module"],
        "tasks": list(catalog.get("tasks") or []),
        "status": status,  # completed | current | pending | blocked
        "assigned_user": assigned_user,
        "started_at": started_at,
        "completed_at": completed_at,
        "pending_actions": pending_actions,
        "approval_status": approval_status,
        "blocked": blocked,
        "block_reason": block_reason,
    }


def build_order_workflow_stages(
    db: Session, tenant_id: int, sales_order_id: int
) -> dict[str, Any]:
    """Derive per-stage status from existing SO / MRP / QC / dispatch records."""
    from app.models.procurement import GoodsReceipt, MaterialRequest, PurchaseOrder
    from app.models.production import Batch
    from app.models.sales import Invoice, Payment, Quotation
    from app.models.user import User

    so = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")

    quote = None
    if so.reference_number:
        quote = db.scalars(
            select(Quotation).where(
                Quotation.tenant_id == tenant_id,
                Quotation.quote_number == so.reference_number,
            )
        ).first()
    if not quote and getattr(so, "customer_id", None):
        # Soft link: latest quote for same customer (optional)
        quote = None

    production_orders = list(
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.tenant_id == tenant_id,
                ProductionOrder.sales_order_id == so.id,
            )
        ).all()
    )
    work_orders: list[WorkOrder] = []
    for po in production_orders:
        work_orders.extend(
            list(
                db.scalars(
                    select(WorkOrder).where(WorkOrder.production_order_id == po.id)
                ).all()
            )
        )

    wo_ids = [w.id for w in work_orders]
    batches = []
    if wo_ids:
        batches = list(
            db.scalars(
                select(Batch).where(
                    Batch.tenant_id == tenant_id, Batch.work_order_id.in_(wo_ids)
                )
            ).all()
        )

    qc_rows = list(
        db.scalars(
            select(QualityInspection).where(
                QualityInspection.tenant_id == tenant_id,
                QualityInspection.sales_order_number == so.order_number,
            )
        ).all()
    )
    incoming_qc = [q for q in qc_rows if (q.inspection_type or "") == "incoming"]
    process_qc = [q for q in qc_rows if (q.inspection_type or "") in {"in_process", "process"}]
    final_qc = [q for q in qc_rows if (q.inspection_type or "") == "final"]

    mrs = []
    if so.order_number:
        mrs = list(
            db.scalars(
                select(MaterialRequest).where(
                    MaterialRequest.tenant_id == tenant_id,
                    MaterialRequest.notes.contains(so.order_number),
                )
            ).all()
        )
    mr_ids = [m.id for m in mrs]
    purchase_orders = []
    if mr_ids:
        purchase_orders = list(
            db.scalars(
                select(PurchaseOrder).where(
                    PurchaseOrder.tenant_id == tenant_id,
                    PurchaseOrder.material_request_id.in_(mr_ids),
                )
            ).all()
        )
    grns = []
    if purchase_orders:
        po_ids = [p.id for p in purchase_orders]
        grns = list(
            db.scalars(
                select(GoodsReceipt).where(
                    GoodsReceipt.tenant_id == tenant_id,
                    GoodsReceipt.purchase_order_id.in_(po_ids),
                )
            ).all()
        )

    invoices = list(
        db.scalars(
            select(Invoice).where(
                Invoice.tenant_id == tenant_id, Invoice.sales_order_id == so.id
            )
        ).all()
    )
    payments = []
    if invoices:
        payments = list(
            db.scalars(
                select(Payment).where(
                    Payment.tenant_id == tenant_id,
                    Payment.invoice_id.in_([i.id for i in invoices]),
                )
            ).all()
        )

    so_confirmed = (so.status or "").lower() in {
        "confirmed",
        "approved",
        "shipped",
        "invoiced",
        "completed",
    }
    mrs_done = bool(mrs) and all(
        (m.status or "").lower() in {"converted", "fulfilled", "approved", "closed"}
        or (m.approval_status or "").lower() == "approved"
        for m in mrs
    )
    # If no MR needed, purchase stages are skipped (auto-complete)
    skip_purchase = so_confirmed and not mrs

    grn_qc_pass = any((g.qc_status or "").lower() in {"pass", "passed", "approved"} for g in grns)
    any_wo = bool(work_orders)
    materials_issued = any(getattr(w, "materials_issued", False) for w in work_orders)
    wo_running = any((w.status or "").lower() in {"running", "in_progress", "started"} for w in work_orders)
    wo_completed = bool(work_orders) and all(
        (w.status or "").lower() in {"completed", "closed", "done"} for w in work_orders
    )
    assigned = any(w.machine_id or w.assigned_user_id or w.operator_name for w in work_orders)
    final_pass = any((q.result or "").lower() == "pass" for q in final_qc)
    process_done = bool(process_qc)
    incoming_done = bool(incoming_qc) or grn_qc_pass
    has_batch = bool(batches)
    has_invoice = bool(invoices)
    has_payment = bool(payments)

    def _user_name(user_id: int | None) -> str | None:
        if not user_id:
            return None
        u = db.get(User, user_id)
        return (u.full_name or u.email) if u else None

    primary_wo = work_orders[0] if work_orders else None
    operator_label = None
    if primary_wo:
        operator_label = primary_wo.operator_name or _user_name(primary_wo.assigned_user_id)

    # Evaluate completion flags in spine order (mandatory gating)
    qstatus = (getattr(quote, "status", None) or "").lower() if quote else ""
    so_closed = (so.status or "").lower() in {"closed", "completed"}
    so_delivered = (so.status or "").lower() == "delivered" or so_closed
    flags: dict[str, bool] = {
        "enquiry": bool(quote) or so_confirmed or bool(so.id),
        "quotation": bool(quote) or so_confirmed,
        "quotation_approval": qstatus in {
            "pending_approval", "approved", "sent", "accepted"
        } or so_confirmed,
        "quotation_sent": qstatus in {"sent", "accepted"} or so_confirmed,
        "sales_order": True,
        "production_planning": so_confirmed and bool(production_orders),
        "bom": so_confirmed and bool(production_orders),
        "mrp": so_confirmed,
        "capacity": so_confirmed and bool(work_orders),
        "purchase_request": skip_purchase or bool(mrs),
        "purchase_order": skip_purchase or bool(purchase_orders) or mrs_done,
        "grn": skip_purchase or bool(grns),
        "incoming_qc": skip_purchase or incoming_done,
        "raw_material": skip_purchase or grn_qc_pass or (bool(grns) and incoming_done),
        "work_order": any_wo,
        "machine_assign": assigned,
        "material_issue": materials_issued or (skip_purchase and any_wo and wo_running),
        "production": wo_running or wo_completed,
        "in_process_qc": process_done or wo_completed,
        "final_qc": final_pass,
        "batch": has_batch or (final_pass and wo_completed),
        "finished_goods": has_batch or (final_pass and wo_completed),
        "maintenance": True,  # parallel track — not blocking SO spine
        "dispatch": bool(so.packed) or bool(so.shipped),
        "delivery": so_delivered or so_closed,
        "invoice": has_invoice or bool(so.invoiced),
        "payment": has_payment,
        "order_close": so_closed,
        "after_sales": so_closed,  # available after close; tracked via defects module
        "dashboard": True,
    }

    # First incomplete mandatory stage (maintenance/dashboard/after_sales don't block)
    non_blocking = {"maintenance", "dashboard", "after_sales"}
    current_id = None
    for cat in WORKFLOW_STAGE_CATALOG:
        sid = cat["id"]
        if sid in non_blocking:
            continue
        if not flags.get(sid):
            current_id = sid
            break
    if current_id is None:
        current_id = "dashboard"

    current_idx = next(
        (i for i, c in enumerate(WORKFLOW_STAGE_CATALOG) if c["id"] == current_id),
        len(WORKFLOW_STAGE_CATALOG) - 1,
    )

    stages: list[dict[str, Any]] = []
    for idx, cat in enumerate(WORKFLOW_STAGE_CATALOG):
        sid = cat["id"]
        done = flags.get(sid, False)

        if sid in non_blocking:
            status = "completed" if done else "pending"
            blocked = False
            block_reason = None
        elif done:
            status = "completed"
            blocked = False
            block_reason = None
        elif sid == current_id:
            status = "current"
            blocked = False
            block_reason = None
        elif idx > current_idx:
            status = "blocked"
            blocked = True
            block_reason = "Previous mandatory stage is incomplete — cannot skip"
        else:
            status = "pending"
            blocked = False
            block_reason = None

        pending: list[str] = []
        approval = None
        assigned_user = None
        started_at = None
        completed_at = None

        if sid == "enquiry":
            assigned_user = getattr(quote, "sales_person", None) if quote else None
            pending = [] if done else list(cat["tasks"])
        elif sid == "quotation":
            assigned_user = getattr(quote, "sales_person", None) if quote else None
            approval = getattr(quote, "status", None) if quote else None
            pending = [] if done else list(cat["tasks"])
        elif sid == "sales_order":
            pending = [] if so_confirmed else ["Confirm Sales Order to release planning"]
            approval = so.status
            started_at = str(so.order_date) if getattr(so, "order_date", None) else None
        elif sid == "purchase_request":
            approval = mrs[0].approval_status if mrs else ("n/a" if skip_purchase else "pending")
            pending = [] if done else list(cat["tasks"])
        elif sid == "purchase_order":
            approval = (
                purchase_orders[0].status if purchase_orders else ("n/a" if skip_purchase else None)
            )
            pending = [] if done else list(cat["tasks"])
        elif sid == "grn":
            pending = [] if done else list(cat["tasks"])
            approval = grns[0].status if grns else None
        elif sid == "incoming_qc":
            approval = (incoming_qc[0].result if incoming_qc else None) or (
                grns[0].qc_status if grns else None
            )
            pending = [] if done else list(cat["tasks"])
        elif sid == "material_issue":
            pending = [] if done else ["Issue materials for work order"]
        elif sid == "machine_assign":
            assigned_user = operator_label
            pending = [] if done else list(cat["tasks"])
        elif sid == "production":
            assigned_user = operator_label
            pending = [] if done else list(cat["tasks"])
        elif sid == "final_qc":
            approval = final_qc[0].result if final_qc else "pending"
            pending = [] if done else ["Perform final QC — required before FG / WO complete"]
        elif sid == "dispatch":
            pending = [] if done else list(cat["tasks"])
            approval = "shipped" if so.shipped else ("packed" if so.packed else "pending")
        elif sid == "invoice":
            approval = invoices[0].status if invoices else None
            pending = [] if done else list(cat["tasks"])
        else:
            pending = [] if done else list(cat["tasks"])

        if status in {"completed", "blocked"}:
            if status == "completed":
                pending = []

        stages.append(
            _stage_payload(
                cat,
                status=status,
                assigned_user=assigned_user,
                started_at=started_at,
                completed_at=completed_at,
                pending_actions=pending,
                approval_status=approval,
                blocked=blocked,
                block_reason=block_reason,
            )
        )

    return {
        "sales_order_id": so.id,
        "order_number": so.order_number,
        "status": so.status,
        "current_stage_id": current_id,
        "stages": stages,
    }


def filter_stages_for_role(
    stages: list[dict[str, Any]], role_name: str | None
) -> list[dict[str, Any]]:
    vis = _visibility_for_role(role_name)
    if vis is None:
        return stages
    if not vis:
        return []
    return [s for s in stages if s.get("responsible_role") in vis]


def get_role_workflow_for_order(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user,
) -> dict[str, Any]:
    """Role-filtered workflow stages for one sales order."""
    role_name = _primary_role_name(user)
    payload = build_order_workflow_stages(db, tenant_id, sales_order_id)
    vis = _visibility_for_role(role_name)
    full_access = vis is None
    stages = payload["stages"] if full_access else filter_stages_for_role(payload["stages"], role_name)
    my_actions = [
        s for s in stages if s["status"] in {"current", "pending"} and not s.get("blocked")
    ]
    return {
        **payload,
        "viewer_role": role_name,
        "full_access": full_access,
        "stages": stages,
        "my_pending_stages": my_actions,
    }


def list_role_workflow_board(db: Session, tenant_id: int, user, *, limit: int = 25) -> dict[str, Any]:
    """Board of recent sales orders with role-filtered pending work."""
    role_name = _primary_role_name(user)
    orders = list(
        db.scalars(
            select(SalesOrder)
            .where(SalesOrder.tenant_id == tenant_id)
            .order_by(SalesOrder.id.desc())
            .limit(limit)
        ).all()
    )
    items = []
    for so in orders:
        try:
            detail = get_role_workflow_for_order(db, tenant_id, so.id, user)
        except HTTPException:
            continue
        items.append(
            {
                "sales_order_id": so.id,
                "order_number": so.order_number,
                "status": so.status,
                "current_stage_id": detail.get("current_stage_id"),
                "my_pending_stages": detail.get("my_pending_stages") or [],
                "stages": detail.get("stages") or [],
            }
        )
    catalog = WORKFLOW_STAGE_CATALOG
    vis = _visibility_for_role(role_name)
    my_catalog = (
        catalog
        if vis is None
        else [c for c in catalog if c["responsible_role"] in (vis or set())]
    )
    return {
        "viewer_role": role_name,
        "full_access": vis is None,
        "role_stages": my_catalog,
        "orders": items,
    }
