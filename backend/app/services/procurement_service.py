from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.inventory import Supplier
from app.models.procurement import (
    GoodsReceipt,
    GoodsReceiptLine,
    MaterialRequest,
    MaterialRequestLine,
    PurchaseOrder,
    PurchaseOrderLine,
    SupplierPayment,
)
from app.models.material_pricing import MaterialPricing
from app.schemas.procurement import (
    GoodsReceiptCreate,
    GoodsReceiptQCRequest,
    MaterialRequestConvertToPORequest,
    MaterialRequestCreate,
    PurchaseOrderCreate,
    SupplierPaymentCreate,
)
from app.schemas.inventory import StockMovementCreate
from app.services.inventory_service import record_stock_movement


def next_material_request_number(db: Session, tenant_id: int) -> str:
    request_count = int(
        db.scalar(
            select(func.count(MaterialRequest.id)).where(
                MaterialRequest.tenant_id == tenant_id
            )
        )
        or 0
    )
    return f"PR-{date.today().year}-{request_count + 1:04d}"


def update_purchase_order_status(
    db: Session, po_id: int, tenant_id: int, status: str
) -> PurchaseOrder | None:
    po = db.scalars(
        select(PurchaseOrder).where(
            PurchaseOrder.id == po_id, PurchaseOrder.tenant_id == tenant_id
        )
    ).first()
    if not po:
        return None
    po.status = status
    db.commit()
    db.refresh(po)
    return po


def create_purchase_order(db: Session, payload: PurchaseOrderCreate) -> PurchaseOrder:
    po = PurchaseOrder(
        tenant_id=payload.tenant_id,
        supplier_id=payload.supplier_id,
        po_number=payload.po_number,
        order_date=payload.order_date,
        expected_date=payload.expected_date,
        # New purchase orders always require explicit Purchase Manager approval.
        # Approval is recorded through the protected status endpoint.
        status="draft",
        total_amount=payload.total_amount,
        notes=payload.notes,
        material_request_id=payload.material_request_id,
    )
    db.add(po)
    db.flush()
    total = 0.0
    for line in payload.line_items:
        lt = (line.unit_price or 0) * line.quantity
        pol = PurchaseOrderLine(
            purchase_order_id=po.id,
            item_id=line.item_id,
            quantity=line.quantity,
            unit_price=line.unit_price,
            line_total=lt,
        )
        db.add(pol)
        total += lt
    if total:
        po.total_amount = total
    db.commit()
    db.refresh(po)
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=po.tenant_id,
            alert_type="purchase_order_created",
            title=f"Purchase order: {po.po_number}",
            message=f"PO {po.po_number} created — ₹{float(po.total_amount or 0):,.2f}",
            severity="medium",
            link="/procurement/purchase-orders",
            reference_type="purchase_order",
            reference_id=po.id,
            created_by="Procurement",
        )
    except Exception:
        pass
    return po


def get_purchase_order(
    db: Session, tenant_id: int, po_id: int
) -> PurchaseOrder | None:
    po = db.scalars(
        select(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.line_items).joinedload(PurchaseOrderLine.item),
        )
        .where(PurchaseOrder.id == po_id, PurchaseOrder.tenant_id == tenant_id)
    ).unique().first()
    if po:
        _apply_purchase_order_receipt_progress(db, po)
    return po


def _purchase_order_receipt_totals(
    db: Session, po: PurchaseOrder
) -> tuple[dict[int, float], dict[int, float], list[GoodsReceipt]]:
    ordered: dict[int, float] = {}
    received: dict[int, float] = {}
    for line in po.line_items or []:
        ordered[line.item_id] = ordered.get(line.item_id, 0.0) + float(line.quantity or 0)

    grns = list(
        db.scalars(
            select(GoodsReceipt)
            .options(selectinload(GoodsReceipt.line_items))
            .where(
                GoodsReceipt.purchase_order_id == po.id,
                GoodsReceipt.tenant_id == po.tenant_id,
            )
        ).unique().all()
    )
    for grn in grns:
        if grn.status == "rejected" or (grn.qc_status or "").lower() == "rejected":
            continue
        for line in grn.line_items or []:
            accepted = max(
                0.0,
                float(line.quantity_received or 0) - float(line.quantity_rejected or 0),
            )
            received[line.item_id] = received.get(line.item_id, 0.0) + accepted
    return ordered, received, grns


def _apply_purchase_order_receipt_progress(db: Session, po: PurchaseOrder) -> None:
    ordered, received, _ = _purchase_order_receipt_totals(db, po)
    unallocated_received = dict(received)
    for line in po.line_items or []:
        line_ordered = float(line.quantity or 0)
        received_for_line = min(line_ordered, unallocated_received.get(line.item_id, 0.0))
        unallocated_received[line.item_id] = max(
            0.0, unallocated_received.get(line.item_id, 0.0) - received_for_line
        )
        line.received_quantity = round(received_for_line, 2)
        line.remaining_quantity = round(max(0.0, line_ordered - received_for_line), 2)


def _refresh_purchase_order_receipt_status(db: Session, po: PurchaseOrder) -> None:
    ordered, received, grns = _purchase_order_receipt_totals(db, po)
    remaining = sum(max(0.0, qty - received.get(item_id, 0.0)) for item_id, qty in ordered.items())
    total_received = sum(received.values())
    if total_received <= 0:
        po.status = "approved"
    elif remaining > 0:
        po.status = "partially_received"
    elif any(
        (grn.qc_status or "pending").lower() == "pending"
        or grn.status == "pending_qc"
        for grn in grns
    ):
        po.status = "pending_qc"
    else:
        po.status = "received"


def update_purchase_order(
    db: Session, tenant_id: int, po_id: int, data: dict
) -> PurchaseOrder | None:
    po = get_purchase_order(db, tenant_id, po_id)
    if not po:
        return None
    for key in (
        "supplier_id",
        "po_number",
        "order_date",
        "expected_date",
        "status",
        "total_amount",
        "notes",
    ):
        if key in data and data[key] is not None:
            setattr(po, key, data[key])
    line_items = data.get("line_items")
    if line_items is not None:
        for existing in list(po.line_items or []):
            db.delete(existing)
        db.flush()
        total = 0.0
        for line in line_items:
            qty = float(getattr(line, "quantity", None) or line.get("quantity") or 0)
            price = getattr(line, "unit_price", None)
            if price is None and isinstance(line, dict):
                price = line.get("unit_price")
            price = float(price or 0)
            item_id = getattr(line, "item_id", None)
            if item_id is None and isinstance(line, dict):
                item_id = line.get("item_id")
            if not item_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Line item is missing required 'item_id'.",
                )
            try:
                parsed_item_id = int(item_id)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid 'item_id' value '{item_id}'. Must be a valid integer.",
                ) from exc
            lt = price * qty
            db.add(
                PurchaseOrderLine(
                    purchase_order_id=po.id,
                    item_id=parsed_item_id,
                    quantity=qty,
                    unit_price=price,
                    line_total=lt,
                )
            )
            total += lt
        po.total_amount = total
    db.commit()
    db.refresh(po)
    return po


def delete_purchase_order(db: Session, tenant_id: int, po_id: int) -> bool:
    po = get_purchase_order(db, tenant_id, po_id)
    if not po:
        return False
    po.status = "cancelled"
    db.commit()
    return True


def list_purchase_orders(db: Session, tenant_id: int) -> list[PurchaseOrder]:
    stmt = (
        select(PurchaseOrder)
        .options(
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.line_items).joinedload(PurchaseOrderLine.item),
        )
        .where(PurchaseOrder.tenant_id == tenant_id)
        .order_by(PurchaseOrder.order_date.desc())
    )
    orders = list(db.scalars(stmt).unique().all())
    for po in orders:
        _apply_purchase_order_receipt_progress(db, po)
    return orders


def create_material_request(
    db: Session, payload: MaterialRequestCreate, *, commit: bool = True
) -> MaterialRequest:
    mr = MaterialRequest(
        tenant_id=payload.tenant_id,
        mr_number=payload.mr_number,
        request_date=payload.request_date,
        required_date=payload.required_date,
        requested_by=payload.requested_by,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(mr)
    db.flush()
    for line in payload.line_items:
        mrl = MaterialRequestLine(
            material_request_id=mr.id,
            item_id=line.item_id,
            quantity=line.quantity,
            notes=line.notes,
        )
        db.add(mrl)
    if commit:
        db.commit()
        db.refresh(mr)
        try:
            from app.services.alert_event_service import emit_alert

            emit_alert(
                db,
                tenant_id=mr.tenant_id,
                alert_type="material_request",
                title=f"Purchase request: {mr.mr_number}",
                message=f"Material request {mr.mr_number} created",
                severity="medium",
                link=f"/procurement/material-requests?id={mr.id}",
                reference_type="material_request",
                reference_id=mr.id,
                created_by=mr.requested_by or "Procurement",
            )
        except Exception:
            pass
    else:
        db.flush()
        db.refresh(mr)
    return mr


def list_material_requests(db: Session, tenant_id: int) -> list[MaterialRequest]:
    stmt = (
        select(MaterialRequest)
        .options(joinedload(MaterialRequest.line_items).joinedload(MaterialRequestLine.item))
        .where(MaterialRequest.tenant_id == tenant_id)
        .order_by(MaterialRequest.id.desc())
    )
    return list(db.scalars(stmt).unique().all())


def get_material_request(
    db: Session, tenant_id: int, mr_id: int
) -> MaterialRequest | None:
    return db.scalars(
        select(MaterialRequest)
        .options(joinedload(MaterialRequest.line_items).joinedload(MaterialRequestLine.item))
        .where(
            MaterialRequest.id == mr_id,
            MaterialRequest.tenant_id == tenant_id,
        )
    ).unique().first()


def convert_material_request_to_purchase_order(
    db: Session,
    tenant_id: int,
    mr_id: int,
    payload: MaterialRequestConvertToPORequest,
) -> PurchaseOrder:
    """Create a PO from MR lines (MRP shortage path) and mark the MR converted."""
    mr = get_material_request(db, tenant_id, mr_id)
    if not mr:
        raise HTTPException(404, "Material request not found")
    if mr.status in ("converted", "fulfilled", "cancelled"):
        raise HTTPException(400, f"Material request already {mr.status}")
    if (mr.approval_status or "").lower() not in {"approved", "auto_approved"}:
        raise HTTPException(
            400,
            "Purchase Manager approval required before converting to Purchase Order.",
        )
    if not mr.line_items:
        raise HTTPException(400, "Material request has no line items to purchase")

    supplier = db.scalars(
        select(Supplier).where(
            Supplier.id == payload.supplier_id,
            Supplier.tenant_id == tenant_id,
        )
    ).first()
    if not supplier:
        raise HTTPException(404, "Supplier not found")

    unit_price_override = (
        float(payload.unit_price)
        if payload.unit_price is not None and float(payload.unit_price) > 0
        else None
    )
    line_item_prices = payload.line_item_prices or {}
    po_payload = PurchaseOrderCreate(
        tenant_id=tenant_id,
        supplier_id=payload.supplier_id,
        po_number=payload.po_number or f"PO-MR-{mr.mr_number}-{int(date.today().strftime('%Y%m%d'))}",
        order_date=date.today(),
        expected_date=payload.expected_date or mr.required_date,
        status=payload.status or "draft",
        notes=payload.notes or f"Converted from material request {mr.mr_number}",
        material_request_id=mr.id,
        line_items=[
            {
                "item_id": int(line.item_id),
                "quantity": float(line.quantity),
                "unit_price": _material_request_line_purchase_price(
                    db,
                    tenant_id,
                    payload.supplier_id,
                    line,
                    override=(
                        float(line_item_prices[str(line.item_id)])
                        if str(line.item_id) in line_item_prices
                        else float(line_item_prices[line.item_id])
                        if line.item_id in line_item_prices
                        else unit_price_override
                    ),
                ),
            }
            for line in mr.line_items
        ],
    )
    po = create_purchase_order(db, po_payload)

    # create_purchase_order commits; reload MR and update status
    mr = get_material_request(db, tenant_id, mr_id)
    if mr:
        mr.status = "converted"
        mr.approval_status = "approved"
        db.commit()
        db.refresh(po)
        try:
            from app.services.alert_event_service import emit_alert

            emit_alert(
                db,
                tenant_id=tenant_id,
                alert_type="purchase_order_created",
                title=f"PO created from PR: {po.po_number}",
                message=f"Material request {mr.mr_number} converted to {po.po_number}",
                severity="medium",
                link="/procurement/purchase-orders",
                reference_type="purchase_order",
                reference_id=po.id,
                created_by="Purchase",
            )
        except Exception:
            pass

    return po


def _material_request_line_purchase_price(
    db: Session,
    tenant_id: int,
    supplier_id: int,
    line: MaterialRequestLine,
    *,
    override: float | None,
) -> float:
    if override is not None:
        return max(0.0, override)

    vendor_price = db.scalar(
        select(MaterialPricing.purchase_price).where(
            MaterialPricing.tenant_id == tenant_id,
            MaterialPricing.supplier_id == supplier_id,
            MaterialPricing.inventory_item_id == line.item_id,
            MaterialPricing.is_active.is_(True),
        )
    )
    if vendor_price is not None and float(vendor_price) > 0:
        return float(vendor_price)

    item = line.item
    if item and item.unit_cost is not None:
        return max(0.0, float(item.unit_cost))
    return 0.0


def approve_material_request(
    db: Session,
    tenant_id: int,
    mr_id: int,
    *,
    approved: bool = True,
    notes: str | None = None,
    approved_by: str | None = None,
) -> MaterialRequest:
    """Purchase Manager approval gate before PO creation."""
    mr = get_material_request(db, tenant_id, mr_id)
    if not mr:
        raise HTTPException(404, "Material request not found")
    if mr.status in ("converted", "fulfilled", "cancelled"):
        raise HTTPException(400, f"Cannot change approval on {mr.status} request")

    if approved:
        mr.approval_status = "approved"
        mr.status = "approved"
        suffix = f"Approved by {approved_by or 'Purchase Manager'}"
    else:
        mr.approval_status = "rejected"
        mr.status = "rejected"
        suffix = f"Rejected by {approved_by or 'Purchase Manager'}"

    if notes or suffix:
        extra = " — ".join(p for p in (suffix, notes) if p)
        mr.notes = ((mr.notes or "") + f"\n{extra}").strip()

    db.commit()
    db.refresh(mr)
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="purchase_requisition_approved" if approved else "purchase_requisition_rejected",
            title=f"PR {mr.approval_status}: {mr.mr_number}",
            message=f"Material request {mr.mr_number} {mr.approval_status}",
            severity="medium" if approved else "high",
            link="/procurement/material-requests",
            reference_type="material_request",
            reference_id=mr.id,
            created_by="Purchase",
        )
    except Exception:
        pass
    return mr


def _post_grn_stock(db: Session, gr: GoodsReceipt, tenant_id: int) -> None:
    """Post accepted quantities (received − rejected) into warehouse stock (same txn)."""
    for line in gr.line_items:
        accepted = max(
            0.0, float(line.quantity_received or 0) - float(line.quantity_rejected or 0)
        )
        if accepted > 0:
            record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=gr.warehouse_id,
                    item_id=line.item_id,
                    quantity=accepted,
                    movement_type="in",
                    reference=f"GRN {gr.grn_number}",
                ),
                commit=False,
            )


def _reverse_grn_stock(db: Session, gr: GoodsReceipt, tenant_id: int) -> None:
    """Reverse accepted quantities from warehouse stock (same txn)."""
    for line in gr.line_items:
        accepted = max(
            0.0, float(line.quantity_received or 0) - float(line.quantity_rejected or 0)
        )
        if accepted > 0:
            record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=gr.warehouse_id,
                    item_id=line.item_id,
                    quantity=accepted,
                    movement_type="out",
                    reference=f"GRN reversal {gr.grn_number}",
                ),
                commit=False,
            )


def update_goods_receipt(
    db: Session, tenant_id: int, grn_id: int, data: dict
) -> GoodsReceipt | None:
    grn = db.scalars(
        select(GoodsReceipt).where(
            GoodsReceipt.id == grn_id,
            GoodsReceipt.tenant_id == tenant_id,
        )
    ).first()
    if not grn:
        return None
    for key in ("received_by", "notes"):
        if key in data:
            setattr(grn, key, data[key])
    db.commit()
    db.refresh(grn)
    return grn


def create_goods_receipt(db: Session, payload: GoodsReceiptCreate) -> GoodsReceipt:
    """
    Create GRN. Stock is posted only when qc_status is pass/passed.
    Pending QC keeps inventory unchanged until QC approval.
    """
    from app.utils.tenant_validation import assert_inventory_item_owned, assert_warehouse_owned

    if payload.purchase_order_id:
        purchase_order = db.scalars(
            select(PurchaseOrder)
            .options(selectinload(PurchaseOrder.line_items))
            .where(
                PurchaseOrder.id == payload.purchase_order_id,
                PurchaseOrder.tenant_id == payload.tenant_id,
            )
            .with_for_update()
        ).first()
        if not purchase_order:
            raise HTTPException(status_code=404, detail="Purchase order not found")
        ordered, received, _ = _purchase_order_receipt_totals(db, purchase_order)
        remaining_total = sum(
            max(0.0, qty - received.get(item_id, 0.0))
            for item_id, qty in ordered.items()
        )
        po_status = (purchase_order.status or "").strip().lower()
        can_receive = po_status in {"approved", "partially_received"} or (
            po_status == "received" and remaining_total > 0.000001
        )
        if not can_receive:
            raise HTTPException(
                status_code=400,
                detail="The purchase order must be approved by the Purchase Manager and have an outstanding quantity before creating a GRN.",
            )
        incoming: dict[int, float] = {}
        for line in payload.line_items:
            if line.item_id not in ordered:
                raise HTTPException(
                    status_code=400,
                    detail=f"Item {line.item_id} is not listed on this purchase order.",
                )
            accepted = max(0.0, float(line.quantity_received) - float(line.quantity_rejected or 0))
            incoming[line.item_id] = incoming.get(line.item_id, 0.0) + accepted
        for item_id, accepted in incoming.items():
            remaining = max(0.0, ordered[item_id] - received.get(item_id, 0.0))
            if accepted - remaining > 0.000001:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Received quantity exceeds the remaining purchase order quantity "
                        f"for item {item_id}. Remaining: {remaining:g}."
                    ),
                )

    assert_warehouse_owned(db, payload.tenant_id, payload.warehouse_id)
    for line in payload.line_items:
        assert_inventory_item_owned(db, payload.tenant_id, line.item_id)

    qc = (payload.qc_status or "pending").lower()
    post_stock_now = qc in ("pass", "passed", "approved")
    status = payload.status
    if not post_stock_now and status == "received":
        status = "pending_qc"

    gr = GoodsReceipt(
        tenant_id=payload.tenant_id,
        purchase_order_id=payload.purchase_order_id,
        grn_number=payload.grn_number,
        receipt_date=payload.receipt_date,
        warehouse_id=payload.warehouse_id,
        received_by=payload.received_by,
        status=status,
        qc_status="pass" if post_stock_now else "pending",
        notes=payload.notes,
    )
    db.add(gr)
    db.flush()
    for line in payload.line_items:
        grl = GoodsReceiptLine(
            goods_receipt_id=gr.id,
            item_id=line.item_id,
            quantity_received=line.quantity_received,
            quantity_rejected=line.quantity_rejected,
        )
        db.add(grl)
    db.flush()

    if post_stock_now:
        # Ensure line_items are loaded for stock posting
        db.refresh(gr)
        gr = db.scalars(
            select(GoodsReceipt)
            .options(joinedload(GoodsReceipt.line_items))
            .where(GoodsReceipt.id == gr.id)
        ).unique().first()
        _post_grn_stock(db, gr, payload.tenant_id)

    if payload.purchase_order_id:
        db.flush()
        po = db.get(PurchaseOrder, payload.purchase_order_id)
        if po and po.tenant_id == payload.tenant_id:
            _refresh_purchase_order_receipt_status(db, po)

    db.commit()
    db.refresh(gr)
    try:
        from app.services.alert_service import sync_low_stock_alerts

        sync_low_stock_alerts(db, payload.tenant_id)
    except Exception:
        pass
    return gr


def approve_goods_receipt_qc(
    db: Session,
    tenant_id: int,
    grn_id: int,
    payload: GoodsReceiptQCRequest,
) -> GoodsReceipt:
    """Pass QC → post stock; Fail QC → reject without stock."""
    gr = db.scalars(
        select(GoodsReceipt)
        .options(joinedload(GoodsReceipt.line_items))
        .where(GoodsReceipt.id == grn_id, GoodsReceipt.tenant_id == tenant_id)
    ).unique().first()
    if not gr:
        raise HTTPException(404, "Goods receipt not found")

    result = (payload.result or "").lower()
    if result not in ("pass", "passed", "fail", "failed", "reject", "rejected"):
        raise HTTPException(400, "result must be pass or fail")

    if gr.qc_status in ("pass", "passed") and gr.status == "received":
        raise HTTPException(400, "QC already passed and stock posted")

    if result in ("pass", "passed"):
        if gr.status == "received" and gr.qc_status == "pass":
            raise HTTPException(400, "Stock already posted for this GRN")
        _post_grn_stock(db, gr, tenant_id)
        gr.qc_status = "pass"
        gr.status = "received"
        if payload.notes:
            gr.notes = ((gr.notes or "") + f"\nQC pass: {payload.notes}").strip()
    else:
        gr.qc_status = "rejected"
        gr.status = "rejected"
        if payload.notes:
            gr.notes = ((gr.notes or "") + f"\nQC fail: {payload.notes}").strip()

    if gr.purchase_order_id:
        db.flush()
        po = db.get(PurchaseOrder, gr.purchase_order_id)
        if po and po.tenant_id == tenant_id:
            _refresh_purchase_order_receipt_status(db, po)

    db.commit()
    db.refresh(gr)
    try:
        from app.services.alert_event_service import emit_alert
        from app.services.alert_service import sync_low_stock_alerts

        if (gr.qc_status or "").lower() in ("passed", "pass", "approved"):
            emit_alert(
                db,
                tenant_id=tenant_id,
                alert_type="qc_passed",
                title=f"GRN QC passed: {gr.grn_number}",
                message=f"Goods receipt {gr.grn_number} QC approved — stock posted",
                severity="low",
                link="/procurement/goods-receipt",
                reference_type="goods_receipt",
                reference_id=gr.id,
                created_by="Quality",
            )
            try:
                from app.services.manufacturing_workflow_service import (
                    link_grn_to_incoming_quality_inspection,
                )

                link_grn_to_incoming_quality_inspection(db, tenant_id, gr, commit=False)
            except Exception:
                pass
        else:
            emit_alert(
                db,
                tenant_id=tenant_id,
                alert_type="qc_failed",
                title=f"GRN QC failed: {gr.grn_number}",
                message=f"Goods receipt {gr.grn_number} QC rejected",
                severity="high",
                link="/quality/inspection",
                reference_type="goods_receipt",
                reference_id=gr.id,
                created_by="Quality",
            )
        sync_low_stock_alerts(db, tenant_id)
    except Exception:
        pass
    return gr


def list_goods_receipts(db: Session, tenant_id: int) -> list[GoodsReceipt]:
    stmt = (
        select(GoodsReceipt)
        .options(joinedload(GoodsReceipt.line_items))
        .where(GoodsReceipt.tenant_id == tenant_id)
        .order_by(GoodsReceipt.receipt_date.desc())
    )
    return list(db.scalars(stmt).unique().all())


def create_supplier_payment(
    db: Session,
    payload: SupplierPaymentCreate,
    *,
    idempotency_key: str | None = None,
) -> SupplierPayment:
    from sqlalchemy.exc import IntegrityError, SQLAlchemyError

    from app.core.idempotency import find_idempotent_record, normalize_idempotency_key

    key = normalize_idempotency_key(idempotency_key or payload.idempotency_key)
    existing = find_idempotent_record(db, SupplierPayment, payload.tenant_id, key)
    if existing:
        return existing

    supplier = db.scalars(
        select(Supplier)
        .where(
            Supplier.id == payload.supplier_id,
            Supplier.tenant_id == payload.tenant_id,
        )
        .with_for_update()
    ).first()
    if not supplier:
        raise HTTPException(
            status_code=404,
            detail="Supplier not found or does not belong to the current tenant.",
        )

    data = payload.model_dump()
    if key:
        data["idempotency_key"] = key
    sp = SupplierPayment(**data)
    db.add(sp)
    try:
        db.commit()
        db.refresh(sp)
    except IntegrityError as exc:
        db.rollback()
        if key:
            dup = find_idempotent_record(db, SupplierPayment, payload.tenant_id, key)
            if dup:
                return dup
        raise HTTPException(
            status_code=409,
            detail="A supplier payment with this idempotency key already exists.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to record supplier payment due to a database error.",
        ) from exc
    return sp


def list_supplier_payments(db: Session, tenant_id: int) -> list[SupplierPayment]:
    stmt = select(SupplierPayment).where(SupplierPayment.tenant_id == tenant_id)
    return list(db.scalars(stmt).all())


def delete_material_request(db: Session, tenant_id: int, mr_id: int) -> bool:
    from app.models.procurement import MaterialRequestLine

    mr = get_material_request(db, tenant_id, mr_id)
    if not mr:
        return False

    for line in db.scalars(
        select(MaterialRequestLine).where(
            MaterialRequestLine.material_request_id == mr_id
        )
    ).all():
        db.delete(line)

    db.delete(mr)
    db.commit()
    return True


def update_material_request(
    db: Session, tenant_id: int, mr_id: int, data: dict
) -> MaterialRequest | None:
    mr = get_material_request(db, tenant_id, mr_id)
    if not mr:
        return None
    for key in ("mr_number", "request_date", "required_date", "requested_by", "status", "notes"):
        if key in data and data[key] is not None:
            setattr(mr, key, data[key])
    line_items = data.get("line_items")
    if line_items is not None:
        for existing in list(mr.line_items or []):
            db.delete(existing)
        db.flush()
        for line in line_items:
            item_id = getattr(line, "item_id", None)
            if item_id is None and isinstance(line, dict):
                item_id = line.get("item_id")
            if not item_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Material request line is missing required 'item_id'.",
                )
            try:
                parsed_item_id = int(item_id)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid 'item_id' value '{item_id}'. Must be a valid integer.",
                ) from exc
            qty = getattr(line, "quantity", None)
            if qty is None and isinstance(line, dict):
                qty = line.get("quantity")
            notes = getattr(line, "notes", None)
            if notes is None and isinstance(line, dict):
                notes = line.get("notes")
            db.add(
                MaterialRequestLine(
                    material_request_id=mr.id,
                    item_id=parsed_item_id,
                    quantity=float(qty or 0),
                    notes=notes,
                )
            )
    db.commit()
    db.refresh(mr)
    return mr


def get_goods_receipt(db: Session, tenant_id: int, grn_id: int) -> GoodsReceipt | None:
    return db.scalars(
        select(GoodsReceipt)
        .options(joinedload(GoodsReceipt.line_items))
        .where(GoodsReceipt.id == grn_id, GoodsReceipt.tenant_id == tenant_id)
    ).unique().first()


def delete_goods_receipt(db: Session, tenant_id: int, grn_id: int) -> bool:
    from app.models.procurement import GoodsReceiptLine

    gr = get_goods_receipt(db, tenant_id, grn_id)
    if not gr:
        return False
    qc = (gr.qc_status or "").lower()
    status_val = (gr.status or "").lower()
    if qc in ("pass", "passed", "approved") or status_val == "received":
        _reverse_grn_stock(db, gr, tenant_id)

    for line in db.scalars(
        select(GoodsReceiptLine).where(
            GoodsReceiptLine.goods_receipt_id == grn_id
        )
    ).all():
        db.delete(line)

    db.delete(gr)
    db.commit()
    return True


def get_supplier_payment(
    db: Session, tenant_id: int, payment_id: int
) -> SupplierPayment | None:
    return db.scalars(
        select(SupplierPayment).where(
            SupplierPayment.id == payment_id,
            SupplierPayment.tenant_id == tenant_id,
        )
    ).first()


def update_supplier_payment(
    db: Session, tenant_id: int, payment_id: int, data: dict
) -> SupplierPayment | None:
    sp = get_supplier_payment(db, tenant_id, payment_id)
    if not sp:
        return None
    for key in (
        "supplier_id",
        "payment_date",
        "amount",
        "payment_method",
        "reference",
        "notes",
    ):
        if key in data and data[key] is not None:
            setattr(sp, key, data[key])
    db.commit()
    db.refresh(sp)
    return sp


def delete_supplier_payment(db: Session, tenant_id: int, payment_id: int) -> bool:
    sp = get_supplier_payment(db, tenant_id, payment_id)
    if not sp:
        return False
    db.delete(sp)
    db.commit()
    return True
