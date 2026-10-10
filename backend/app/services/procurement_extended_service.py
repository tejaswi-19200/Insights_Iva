"""Procurement extended — MR, RFQ, PO, GRN, vendor bills, hub."""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.inventory import InventoryItem, StockLevel, Supplier
from app.models.procurement import (
    GoodsReceipt,
    GoodsReceiptLine,
    MaterialRequest,
    MaterialRequestLine,
    PurchaseOrder,
    PurchaseOrderLine,
    RFQ,
    VendorBill,
    VendorQuotation,
)
from app.schemas.procurement_extended import (
    GRNListRead,
    GRNSummaryRead,
    MRListRead,
    MRSummaryRead,
    POListRead,
    POSummaryRead,
    ProcurementHubRead,
    RFQListRead,
    RFQSummaryRead,
    VendorBillListRead,
    VendorBillSummaryRead,
    VendorComparisonRead,
)


def _mr_po_ids(db: Session, tenant_id: int) -> set[int]:
    from app.models.procurement import PurchaseOrder

    return {
        int(mid)
        for mid in db.scalars(
            select(PurchaseOrder.material_request_id).where(
                PurchaseOrder.tenant_id == tenant_id,
                PurchaseOrder.material_request_id.isnot(None),
            )
        ).all()
        if mid
    }


def _mr_is_converted(mr: MaterialRequest, po_mr_ids: set[int]) -> bool:
    return (mr.status or "") == "converted" or mr.id in po_mr_ids


def _mr_is_pending(mr: MaterialRequest) -> bool:
    if (mr.status or "") in ("converted", "fulfilled", "cancelled", "rejected"):
        return False
    if (mr.approval_status or "") == "rejected" or (mr.status or "") == "rejected":
        return False
    return (mr.approval_status or "pending") == "pending" or (mr.status or "") == "pending"


def _mr_is_approved(mr: MaterialRequest) -> bool:
    if (mr.status or "") in ("converted", "fulfilled", "cancelled", "rejected"):
        return False
    if (mr.approval_status or "") == "rejected":
        return False
    return (mr.approval_status or "") == "approved"


def get_mr_summary(db: Session, tenant_id: int) -> MRSummaryRead:
    mrs = list(db.scalars(select(MaterialRequest).where(MaterialRequest.tenant_id == tenant_id)).all())
    po_mr_ids = _mr_po_ids(db, tenant_id)
    pending = sum(1 for m in mrs if _mr_is_pending(m))
    approved = sum(1 for m in mrs if _mr_is_approved(m))
    rejected = sum(
        1
        for m in mrs
        if (m.status or "") == "rejected" or (m.approval_status or "") == "rejected"
    )
    converted_count = sum(1 for m in mrs if _mr_is_converted(m, po_mr_ids))
    urgent = sum(
        1
        for m in mrs
        if getattr(m, "priority", "medium") in ("high", "urgent")
    )
    return MRSummaryRead(
        total_requests=len(mrs),
        pending_approval=pending,
        approved=approved,
        rejected=rejected,
        converted_to_rfq=converted_count,
        urgent_requests=urgent,
    )


def list_mr_enriched(db: Session, tenant_id: int) -> list[MRListRead]:
    mrs = list(
        db.scalars(select(MaterialRequest).where(MaterialRequest.tenant_id == tenant_id).order_by(MaterialRequest.id.desc())).all()
    )
    po_mr_ids = _mr_po_ids(db, tenant_id)
    result = []
    for mr in mrs:
        lines = int(
            db.scalar(
                select(func.count(MaterialRequestLine.id)).where(MaterialRequestLine.material_request_id == mr.id)
            ) or 0
        )
        result.append(
            MRListRead(
                id=mr.id,
                mr_number=mr.mr_number,
                request_date=mr.request_date.isoformat() if mr.request_date else "",
                department=getattr(mr, "department", None) or "Production",
                requested_by=mr.requested_by,
                priority=getattr(mr, "priority", "medium") or "medium",
                item_count=lines,
                status=mr.status,
                approval_status=getattr(mr, "approval_status", mr.status) or "pending",
                required_date=mr.required_date.isoformat() if mr.required_date else None,
                converted_to_po=_mr_is_converted(mr, po_mr_ids),
            )
        )
    return result


def get_rfq_summary(db: Session, tenant_id: int) -> RFQSummaryRead:
    rfqs = list(db.scalars(select(RFQ).where(RFQ.tenant_id == tenant_id)).all())
    open_r = sum(1 for r in rfqs if r.status == "open")
    expired = sum(1 for r in rfqs if r.due_date and r.due_date < date.today() and r.status == "open")
    awarded = sum(1 for r in rfqs if r.status == "awarded")
    responses = int(
        db.scalar(select(func.count(VendorQuotation.id)).where(VendorQuotation.tenant_id == tenant_id)) or 0
    )
    return RFQSummaryRead(open_rfqs=open_r, vendor_responses=responses, expired_rfqs=expired, awarded_rfqs=awarded)


def list_rfq_enriched(db: Session, tenant_id: int) -> list[RFQListRead]:
    rfqs = list(db.scalars(select(RFQ).where(RFQ.tenant_id == tenant_id).order_by(RFQ.id.desc())).all())
    result = []
    for rfq in rfqs:
        mr = db.get(MaterialRequest, rfq.material_request_id) if rfq.material_request_id else None
        q_count = int(
            db.scalar(select(func.count(VendorQuotation.id)).where(VendorQuotation.rfq_id == rfq.id)) or 0
        )
        result.append(
            RFQListRead(
                id=rfq.id,
                rfq_number=rfq.rfq_number,
                material_request_number=mr.mr_number if mr else None,
                vendor_count=q_count,
                due_date=rfq.due_date.isoformat() if rfq.due_date else None,
                quotation_count=q_count,
                status=rfq.status,
            )
        )
    return result


def create_rfq(db: Session, tenant_id: int, payload) -> RFQ:
    count = int(db.scalar(select(func.count(RFQ.id)).where(RFQ.tenant_id == tenant_id)) or 0)
    d_date = None
    if payload.due_date:
        if isinstance(payload.due_date, date):
            d_date = payload.due_date
        elif isinstance(payload.due_date, str):
            try:
                d_date = date.fromisoformat(payload.due_date)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid due_date '{payload.due_date}'. Expected format YYYY-MM-DD.",
                ) from exc
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid due_date type. Expected string in YYYY-MM-DD format.",
            )

    rfq_num = payload.rfq_number.strip() if payload.rfq_number and payload.rfq_number.strip() else f"RFQ-{date.today().year}-{count + 1:04d}"

    rfq = RFQ(
        tenant_id=tenant_id,
        rfq_number=rfq_num,
        material_request_id=payload.material_request_id,
        due_date=d_date,
        status="open",
        notes=payload.notes,
    )
    db.add(rfq)
    db.commit()
    db.refresh(rfq)
    return rfq


def create_vendor_quotation(db: Session, tenant_id: int, rfq_id: int, payload) -> VendorQuotation:
    rfq = db.scalars(
        select(RFQ).where(RFQ.id == rfq_id, RFQ.tenant_id == tenant_id)
    ).first()
    if not rfq:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="RFQ not found or does not belong to the current tenant.",
        )

    supplier = db.scalars(
        select(Supplier).where(Supplier.id == payload.supplier_id, Supplier.tenant_id == tenant_id)
    ).first()
    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier not found or does not belong to the current tenant.",
        )

    quote = VendorQuotation(
        tenant_id=tenant_id,
        rfq_id=rfq_id,
        supplier_id=payload.supplier_id,
        price=payload.price,
        delivery_days=payload.delivery_days or 7,
        gst_pct=payload.gst_pct or 18.0,
        warranty=payload.warranty or "1 Year",
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return quote


def award_rfq(db: Session, tenant_id: int, rfq_id: int, supplier_id: int) -> RFQ | None:
    """Award RFQ → create Purchase Order (from linked Material Request when present)."""
    from datetime import date, timedelta

    from fastapi import HTTPException

    from app.models.procurement import VendorQuotation
    from app.schemas.procurement import MaterialRequestConvertToPORequest
    from app.services.procurement_service import (
        convert_material_request_to_purchase_order,
        create_purchase_order,
    )
    from app.schemas.procurement import PurchaseOrderCreate

    rfq = db.scalars(select(RFQ).where(RFQ.id == rfq_id, RFQ.tenant_id == tenant_id)).first()
    if not rfq:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="RFQ not found.",
        )

    current_status = (rfq.status or "").lower()
    if current_status == "awarded":
        return rfq

    if current_status not in {"open", "sent", "pending", "draft", "active"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"RFQ cannot be awarded because its current status is '{rfq.status}'. Only eligible open RFQs can be awarded.",
        )

    supplier = db.scalars(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.tenant_id == tenant_id)
    ).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    vendor_quote = db.scalars(
        select(VendorQuotation).where(
            VendorQuotation.rfq_id == rfq.id,
            VendorQuotation.tenant_id == tenant_id,
            VendorQuotation.supplier_id == supplier_id,
        )
    ).first()
    unit_price = float(vendor_quote.price) if vendor_quote else 0.0
    delivery_days = int(vendor_quote.delivery_days or 7) if vendor_quote else 7

    po = None
    if rfq.material_request_id:
        po = convert_material_request_to_purchase_order(
            db,
            tenant_id,
            rfq.material_request_id,
            MaterialRequestConvertToPORequest(
                supplier_id=supplier_id,
                unit_price=unit_price,
                expected_date=date.today() + timedelta(days=delivery_days),
                status="approved",
                notes=f"Auto-created from awarded RFQ {rfq.rfq_number}",
                po_number=f"PO-{rfq.rfq_number}",
            ),
        )
    else:
        # Header-only PO for RFQs without an MR link (lines added later)
        po = create_purchase_order(
            db,
            PurchaseOrderCreate(
                tenant_id=tenant_id,
                supplier_id=supplier_id,
                po_number=f"PO-{rfq.rfq_number}",
                order_date=date.today(),
                expected_date=date.today() + timedelta(days=delivery_days),
                status="approved",
                notes=f"Auto-created from awarded RFQ {rfq.rfq_number}",
                line_items=[],
            ),
        )

    rfq.status = "awarded"
    if vendor_quote:
        vendor_quote.status = "awarded"
    db.commit()
    db.refresh(rfq)

    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="rfq_awarded",
            title=f"RFQ awarded: {rfq.rfq_number}",
            message=(
                f"RFQ {rfq.rfq_number} awarded to {supplier.name}. "
                f"PO {getattr(po, 'po_number', '')} created."
            ),
            severity="medium",
            link="/procurement/purchase-orders",
            reference_type="rfq",
            reference_id=rfq.id,
            created_by="Procurement",
        )
    except Exception:
        pass

    return rfq


def get_rfq_comparison(db: Session, tenant_id: int, rfq_id: int) -> list[VendorComparisonRead]:
    quotes = list(
        db.scalars(
            select(VendorQuotation)
            .options(joinedload(VendorQuotation.supplier))
            .where(VendorQuotation.rfq_id == rfq_id, VendorQuotation.tenant_id == tenant_id)
        ).all()
    )
    if not quotes:
        return []
    items = []
    best_score = -999999
    best_id = None
    for q in quotes:
        supplier = q.supplier or db.get(Supplier, q.supplier_id)
        score = round(100 - (float(q.price) / 1000) + (float(q.rating or 4.0)) * 10 - (q.delivery_days or 0), 1)
        if score > best_score:
            best_score = score
            best_id = q.id
        items.append(
            VendorComparisonRead(
                supplier_id=q.supplier_id,
                supplier_name=supplier.name if supplier else "—",
                price=float(q.price),
                delivery_days=q.delivery_days,
                gst_pct=float(q.gst_pct or 0),
                warranty=q.warranty,
                rating=float(q.rating or 4.0),
                score=score,
                is_best=False,
            )
        )
    for it in items:
        if it.score == best_score:
            it.is_best = True
    return sorted(items, key=lambda x: x.score, reverse=True)



def get_po_summary(db: Session, tenant_id: int) -> POSummaryRead:
    pos = list(db.scalars(select(PurchaseOrder).where(PurchaseOrder.tenant_id == tenant_id)).all())
    value = sum(float(p.total_amount or 0) for p in pos)
    return POSummaryRead(
        total_po=len(pos),
        pending=sum(1 for p in pos if p.status in ("draft", "pending")),
        approved=sum(1 for p in pos if p.status == "approved"),
        delivered=sum(1 for p in pos if p.status in ("received", "delivered")),
        cancelled=sum(1 for p in pos if p.status == "cancelled"),
        po_value=value,
    )


def list_po_enriched(db: Session, tenant_id: int) -> list[POListRead]:
    pos = list(
        db.scalars(
            select(PurchaseOrder)
            .options(joinedload(PurchaseOrder.supplier))
            .where(PurchaseOrder.tenant_id == tenant_id)
            .order_by(PurchaseOrder.order_date.desc())
        ).all()
    )
    return [
        POListRead(
            id=po.id,
            po_number=po.po_number,
            vendor_name=po.supplier.name if po.supplier else "—",
            order_date=po.order_date.isoformat() if po.order_date else "",
            total_amount=float(po.total_amount) if po.total_amount else None,
            expected_date=po.expected_date.isoformat() if po.expected_date else None,
            payment_terms=getattr(po, "payment_terms", None) or "Not Specified",
            status=po.status,
            buyer=getattr(po, "buyer", None),
        )
        for po in pos
    ]


def get_grn_summary(db: Session, tenant_id: int) -> GRNSummaryRead:
    grns = list(
        db.scalars(
            select(GoodsReceipt)
            .options(
                selectinload(GoodsReceipt.line_items),
                joinedload(GoodsReceipt.purchase_order).selectinload(PurchaseOrder.line_items),
            )
            .where(GoodsReceipt.tenant_id == tenant_id)
        ).unique().all()
    )
    today = date.today()
    total_value = 0.0
    for grn in grns:
        if grn.status != "received" or (getattr(grn, "qc_status", "") or "").lower() not in {"pass", "passed", "approved"}:
            continue

        # GRN lines currently identify the inventory item, while PO lines hold
        # the agreed price. Use a quantity-weighted item price if the PO has
        # duplicate lines for the same item.
        weighted_prices: dict[int, tuple[float, float]] = {}
        for po_line in (grn.purchase_order.line_items if grn.purchase_order else []):
            po_qty = float(po_line.quantity or 0)
            unit_price = po_line.unit_price
            if unit_price is None and po_line.line_total is not None and po_qty > 0:
                unit_price = float(po_line.line_total) / po_qty
            if unit_price is None or po_qty <= 0:
                continue
            amount, quantity = weighted_prices.get(po_line.item_id, (0.0, 0.0))
            weighted_prices[po_line.item_id] = (amount + float(unit_price) * po_qty, quantity + po_qty)

        for grn_line in grn.line_items or []:
            accepted_qty = max(
                0.0,
                float(grn_line.quantity_received or 0) - float(grn_line.quantity_rejected or 0),
            )
            amount, quantity = weighted_prices.get(grn_line.item_id, (0.0, 0.0))
            if accepted_qty > 0 and quantity > 0:
                total_value += accepted_qty * (amount / quantity)

    return GRNSummaryRead(
        todays_grn=sum(1 for g in grns if g.receipt_date == today),
        pending_qc=sum(
            1
            for g in grns
            if (getattr(g, "qc_status", "pending") or "pending") == "pending"
            or g.status == "pending_qc"
        ),
        received=sum(1 for g in grns if g.status == "received"),
        rejected=sum(
            1
            for g in grns
            if g.status == "rejected"
            or (getattr(g, "qc_status", None) or "") == "rejected"
        ),
        total_value=round(total_value, 2),
    )


def list_grn_enriched(db: Session, tenant_id: int) -> list[GRNListRead]:
    grns = list(
        db.scalars(
            select(GoodsReceipt)
            .options(
                joinedload(GoodsReceipt.warehouse),
                selectinload(GoodsReceipt.purchase_order).options(
                    joinedload(PurchaseOrder.supplier),
                    selectinload(PurchaseOrder.line_items).joinedload(PurchaseOrderLine.item),
                ),
                selectinload(GoodsReceipt.line_items).joinedload(GoodsReceiptLine.item),
            )
            .where(GoodsReceipt.tenant_id == tenant_id)
            .order_by(GoodsReceipt.receipt_date.desc())
        ).all()
    )
    grns_by_po: dict[int, list[GoodsReceipt]] = {}
    for grn in grns:
        if grn.purchase_order_id:
            grns_by_po.setdefault(grn.purchase_order_id, []).append(grn)

    remaining_by_po: dict[int, float] = {}
    remaining_summary_by_po: dict[int, str] = {}
    for po_id, po_grns in grns_by_po.items():
        po = po_grns[0].purchase_order
        ordered_by_item: dict[int, float] = {}
        received_by_item: dict[int, float] = {}
        for po_line in (po.line_items or []) if po else []:
            ordered_by_item[po_line.item_id] = ordered_by_item.get(po_line.item_id, 0.0) + float(po_line.quantity or 0)
        for grn in po_grns:
            if grn.status == "rejected" or (grn.qc_status or "").lower() == "rejected":
                continue
            for line in grn.line_items or []:
                accepted = max(0.0, float(line.quantity_received or 0) - float(line.quantity_rejected or 0))
                received_by_item[line.item_id] = received_by_item.get(line.item_id, 0.0) + accepted
        remaining_by_po[po_id] = round(
            sum(max(0.0, qty - received_by_item.get(item_id, 0.0)) for item_id, qty in ordered_by_item.items()),
            2,
        )
        remaining_lines = []
        seen_items: set[int] = set()
        for po_line in (po.line_items or []) if po else []:
            item_id = po_line.item_id
            if item_id in seen_items:
                continue
            seen_items.add(item_id)
            remainder = max(0.0, ordered_by_item.get(item_id, 0.0) - received_by_item.get(item_id, 0.0))
            if remainder > 0.000001:
                item = po_line.item
                label = (item.name if item else None) or (item.sku if item else None) or f"Item {item_id}"
                unit = item.unit if item else ""
                remaining_lines.append(f"{label}: {remainder:g} {unit}".strip())
        remaining_summary_by_po[po_id] = " · ".join(remaining_lines)

    result = []
    for gr in grns:
        qty = sum(float(l.quantity_received or 0) for l in gr.line_items) if gr.line_items else 0
        po = gr.purchase_order
        vendor = po.supplier.name if po and po.supplier else None
        result.append(
            GRNListRead(
                id=gr.id,
                grn_number=gr.grn_number,
                po_number=po.po_number if po else None,
                vendor_name=vendor,
                warehouse_name=gr.warehouse.name if gr.warehouse else None,
                quantity=qty,
                line_items=[
                    {
                        "item_id": line.item_id,
                        "item_name": line.item.name if line.item else None,
                        "item_sku": line.item.sku if line.item else None,
                        "unit": line.item.unit if line.item else None,
                        "quantity_received": float(line.quantity_received or 0),
                        "quantity_rejected": float(line.quantity_rejected or 0),
                        "quantity_accepted": max(
                            0.0,
                            float(line.quantity_received or 0)
                            - float(line.quantity_rejected or 0),
                        ),
                    }
                    for line in gr.line_items or []
                ],
                remaining_quantity=remaining_by_po.get(gr.purchase_order_id) if gr.purchase_order_id else None,
                remaining_summary=remaining_summary_by_po.get(gr.purchase_order_id) if gr.purchase_order_id else None,
                qc_status=getattr(gr, "qc_status", "pending") or "pending",
                received_by=getattr(gr, "received_by", None),
                notes=gr.notes,
                status=gr.status,
                receipt_date=gr.receipt_date.isoformat() if gr.receipt_date else None,
            )
        )
    return result


def get_vendor_bill_summary(db: Session, tenant_id: int) -> VendorBillSummaryRead:
    bills = list(db.scalars(select(VendorBill).where(VendorBill.tenant_id == tenant_id)).all())
    outstanding = sum(float(b.amount or 0) for b in bills if b.status in ("pending", "due"))
    return VendorBillSummaryRead(
        total_bills=len(bills),
        due_bills=sum(1 for b in bills if b.status == "due"),
        paid=sum(1 for b in bills if b.status == "paid"),
        outstanding=outstanding,
    )


def list_vendor_bills_enriched(db: Session, tenant_id: int) -> list[VendorBillListRead]:
    bills = list(
        db.scalars(
            select(VendorBill)
            .options(joinedload(VendorBill.supplier))
            .where(VendorBill.tenant_id == tenant_id)
            .order_by(VendorBill.bill_date.desc())
        ).all()
    )
    result = []
    for b in bills:
        po = db.get(PurchaseOrder, b.purchase_order_id) if b.purchase_order_id else None
        grn = db.get(GoodsReceipt, b.goods_receipt_id) if b.goods_receipt_id else None
        result.append(
            VendorBillListRead(
                id=b.id,
                bill_number=b.bill_number,
                vendor_name=b.supplier.name if b.supplier else "—",
                po_number=po.po_number if po else None,
                grn_number=grn.grn_number if grn else None,
                amount=float(b.amount),
                gst_amount=float(b.gst_amount) if b.gst_amount else None,
                due_date=b.due_date.isoformat() if b.due_date else None,
                status=b.status,
            )
        )
    return result


def _parse_date(val: str | date | None, field_name: str) -> date | None:
    if not val:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        try:
            return date.fromisoformat(val)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {field_name} '{val}'. Expected format YYYY-MM-DD.",
            ) from exc
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid {field_name} type. Expected string in YYYY-MM-DD format.",
    )


def create_vendor_bill(db: Session, tenant_id: int, payload) -> VendorBill:
    count = int(db.scalar(select(func.count(VendorBill.id)).where(VendorBill.tenant_id == tenant_id)) or 0)
    b_date = _parse_date(payload.bill_date, "bill_date") or date.today()
    d_date = _parse_date(payload.due_date, "due_date")

    b_num = payload.bill_number.strip() if payload.bill_number and payload.bill_number.strip() else f"V-BILL-{date.today().year}-{count + 1:04d}"

    bill = VendorBill(
        tenant_id=tenant_id,
        bill_number=b_num,
        supplier_id=payload.supplier_id,
        purchase_order_id=payload.purchase_order_id,
        goods_receipt_id=payload.goods_receipt_id,
        bill_date=b_date,
        due_date=d_date,
        amount=payload.amount,
        gst_amount=payload.gst_amount,
        status="pending",
    )
    db.add(bill)
    db.commit()
    db.refresh(bill)
    return bill


def update_vendor_bill_status(db: Session, tenant_id: int, bill_id: int, new_status: str) -> VendorBill | None:
    bill = db.scalars(select(VendorBill).where(VendorBill.id == bill_id, VendorBill.tenant_id == tenant_id)).first()
    if not bill:
        return None
    bill.status = new_status
    db.commit()
    db.refresh(bill)
    return bill


def update_vendor_bill(db: Session, tenant_id: int, bill_id: int, payload) -> VendorBill | None:
    bill = db.scalars(select(VendorBill).where(VendorBill.id == bill_id, VendorBill.tenant_id == tenant_id)).first()
    if not bill:
        return None
    if payload.bill_number is not None:
        bill.bill_number = payload.bill_number.strip() or bill.bill_number
    if payload.amount is not None:
        bill.amount = payload.amount
    if payload.gst_amount is not None:
        bill.gst_amount = payload.gst_amount
    if payload.bill_date:
        try:
            bill.bill_date = date.fromisoformat(payload.bill_date)
        except ValueError:
            pass
    if payload.due_date is not None:
        if payload.due_date == "":
            bill.due_date = None
        else:
            try:
                bill.due_date = date.fromisoformat(payload.due_date)
            except ValueError:
                pass
    db.commit()
    db.refresh(bill)
    return bill


def delete_rfq(db: Session, tenant_id: int, rfq_id: int) -> bool:
    from app.models.procurement import VendorQuotation

    rfq = db.scalars(select(RFQ).where(RFQ.id == rfq_id, RFQ.tenant_id == tenant_id)).first()
    if not rfq:
        return False

    for vq in db.scalars(select(VendorQuotation).where(VendorQuotation.rfq_id == rfq_id)).all():
        db.delete(vq)

    db.delete(rfq)
    db.commit()
    return True


def delete_vendor_bill(db: Session, tenant_id: int, bill_id: int) -> bool:
    from app.models.procurement import VendorBillItem

    bill = db.scalars(
        select(VendorBill).where(VendorBill.id == bill_id, VendorBill.tenant_id == tenant_id)
    ).first()
    if not bill:
        return False

    for bi in db.scalars(select(VendorBillItem).where(VendorBillItem.vendor_bill_id == bill_id)).all():
        db.delete(bi)

    db.delete(bill)
    db.commit()
    return True


def get_procurement_hub(db: Session, tenant_id: int) -> ProcurementHubRead:
    po_sum = get_po_summary(db, tenant_id)
    rfq_sum = get_rfq_summary(db, tenant_id)
    bill_sum = get_vendor_bill_summary(db, tenant_id)
    mr_sum = get_mr_summary(db, tenant_id)
    active_vendor_filter = or_(Supplier.is_deleted.is_(False), Supplier.is_deleted.is_(None))
    vendors = int(
        db.scalar(
            select(func.count(Supplier.id)).where(
                Supplier.tenant_id == tenant_id,
                Supplier.status == "active",
                active_vendor_filter,
            )
        )
        or 0
    )
    top = list(
        db.scalars(
            select(Supplier)
            .where(Supplier.tenant_id == tenant_id, active_vendor_filter)
            .order_by(Supplier.rating.desc())
            .limit(5)
        ).all()
    )
    pending_pos = list_po_enriched(db, tenant_id)[:5]

    today_val = date.today()
    todays_grn_count = int(
        db.scalar(
            select(func.count(GoodsReceipt.id)).where(
                GoodsReceipt.tenant_id == tenant_id,
                GoodsReceipt.receipt_date == today_val,
            )
        ) or 0
    )
    todays_po_count = int(
        db.scalar(
            select(func.count(PurchaseOrder.id)).where(
                PurchaseOrder.tenant_id == tenant_id,
                PurchaseOrder.expected_date == today_val,
            )
        ) or 0
    )
    todays_deliveries = todays_grn_count + todays_po_count

    alerts = []
    stock_total = (
        select(func.coalesce(func.sum(StockLevel.quantity), 0))
        .where(StockLevel.item_id == InventoryItem.id)
        .correlate(InventoryItem)
        .scalar_subquery()
    )
    low_stock_count = int(
        db.scalar(
            select(func.count(InventoryItem.id)).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.is_active.is_(True),
                stock_total <= InventoryItem.reorder_level,
            )
        ) or 0
    )
    if low_stock_count > 0:
        alerts.append({
            "type": "low_stock",
            "message": f"Low Stock — {low_stock_count} item{'s' if low_stock_count != 1 else ''} below reorder",
        })

    overdue_pos = list(
        db.scalars(
            select(PurchaseOrder).where(
                PurchaseOrder.tenant_id == tenant_id,
                PurchaseOrder.expected_date < today_val,
                PurchaseOrder.status.notin_(["completed", "cancelled", "received"]),
            ).order_by(PurchaseOrder.expected_date.asc())
        ).all()
    )
    if overdue_pos:
        first_po = overdue_pos[0]
        alerts.append({
            "type": "delayed_po",
            "message": f"Delayed PO — {first_po.po_number} overdue",
        })

    pending_rfqs_count = rfq_sum.open_rfqs or 0
    if pending_rfqs_count > 0:
        alerts.append({
            "type": "pending_rfq",
            "message": f"Pending RFQ — {pending_rfqs_count} RFQ{'s' if pending_rfqs_count != 1 else ''} awaiting vendor response",
        })

    outstanding_bill_amount = bill_sum.outstanding or 0.0
    if outstanding_bill_amount > 0:
        formatted_amount = (
            f"₹{outstanding_bill_amount / 100000:.1f}L"
            if outstanding_bill_amount >= 100000
            else f"₹{outstanding_bill_amount:,.0f}"
        )
        alerts.append({
            "type": "overdue_bill",
            "message": f"Overdue Bill — {formatted_amount} outstanding",
        })

    return ProcurementHubRead(
        purchase_spend=po_sum.po_value,
        pending_approvals=mr_sum.pending_approval + po_sum.pending,
        open_rfqs=rfq_sum.open_rfqs,
        active_vendors=vendors,
        outstanding_bills=bill_sum.outstanding,
        todays_deliveries=todays_deliveries,
        top_vendors=[{"name": v.name, "rating": float(v.rating or 0)} for v in top],
        pending_orders=[{"po_number": p.po_number, "vendor": p.vendor_name, "amount": p.total_amount} for p in pending_pos],
        alerts=alerts,
    )
