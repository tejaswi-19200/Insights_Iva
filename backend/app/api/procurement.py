import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

logger = logging.getLogger(__name__)
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.idempotency import get_idempotency_key_header
from app.core.permissions import (
    get_role_names,
    require_permission,
    tenant_scope,
    user_is_admin,
)
from app.models.user import User
from app.schemas.inventory import SupplierRead
from app.schemas.vendor import (
    VendorBulkStatusUpdate,
    VendorCreate,
    VendorDetailRead,
    VendorListRead,
    VendorProductRead,
    VendorPurchaseOrderRead,
    VendorSummaryRead,
    VendorUpdate,
)
from app.schemas.procurement import (
    GoodsReceiptCreate,
    GoodsReceiptQCRequest,
    GoodsReceiptRead,
    GoodsReceiptUpdate,
    MaterialRequestConvertToPORequest,
    MaterialRequestCreate,
    MaterialRequestRead,
    MaterialRequestUpdate,
    PurchaseOrderCreate,
    PurchaseOrderListRead,
    PurchaseOrderRead,
    PurchaseOrderUpdate,
    SupplierPaymentCreate,
    SupplierPaymentRead,
    SupplierPaymentUpdate,
)
from app.services.inventory_service import update_supplier_approval
from app.services.vendor_service import (
    bulk_update_vendor_status,
    create_vendor,
    deactivate_vendor,
    get_vendor_detail,
    get_vendor_purchase_history,
    get_vendor_summary,
    list_vendor_products,
    list_vendors_enriched,
    soft_delete_vendor,
    update_vendor,
)

VENDOR_ACCESS_ROLES = frozenset(
    {"Admin", "Purchase Manager", "Store Manager"}
)
VENDOR_WRITE_ROLES = frozenset(
    {"Admin", "Purchase Manager", "Store Manager"}
)


def _actor_label(user: User) -> str:
    return (user.full_name or user.email or f"user-{user.id}").strip()


def _require_vendor_access(user: User) -> User:
    if user_is_admin(user):
        return user
    roles = set(get_role_names(user))
    if roles & VENDOR_ACCESS_ROLES:
        return user
    raise HTTPException(status_code=403, detail="You do not have access to Vendor Master.")


def _require_vendor_write(user: User) -> User:
    _require_vendor_access(user)
    if user_is_admin(user):
        return user
    roles = set(get_role_names(user))
    if roles & VENDOR_WRITE_ROLES:
        return user
    raise HTTPException(
        status_code=403,
        detail="You do not have permission to modify Vendor Master.",
    )
from app.services.procurement_service import (
    approve_goods_receipt_qc,
    approve_material_request,
    convert_material_request_to_purchase_order,
    create_goods_receipt,
    create_material_request,
    create_purchase_order,
    create_supplier_payment,
    delete_goods_receipt,
    delete_material_request,
    delete_purchase_order,
    delete_supplier_payment,
    get_goods_receipt,
    get_material_request,
    get_purchase_order,
    get_supplier_payment,
    list_goods_receipts,
    list_material_requests,
    list_purchase_orders,
    list_supplier_payments,
    update_material_request,
    update_goods_receipt,
    update_purchase_order,
    update_purchase_order_status,
    update_supplier_payment,
)
from app.schemas.procurement_extended import (
    GRNListRead,
    GRNSummaryRead,
    MRListRead,
    MRSummaryRead,
    POListRead,
    POSummaryRead,
    ProcurementHubRead,
    RFQCreate,
    RFQListRead,
    RFQSummaryRead,
    RFQAward,
    VendorBillCreate,
    VendorBillListRead,
    VendorBillStatusUpdate,
    VendorBillSummaryRead,
    VendorBillUpdate,
    VendorComparisonRead,
    VendorQuotationCreate,
)
from app.services.procurement_extended_service import (
    award_rfq,
    create_rfq,
    create_vendor_bill,
    create_vendor_quotation,
    delete_rfq,
    delete_vendor_bill,
    update_vendor_bill,
    update_vendor_bill_status,
    get_grn_summary,
    get_mr_summary,
    get_po_summary,
    get_procurement_hub,
    get_rfq_comparison,
    get_rfq_summary,
    get_vendor_bill_summary,
    list_grn_enriched,
    list_mr_enriched,
    list_po_enriched,
    list_rfq_enriched,
    list_vendor_bills_enriched,
)

router = APIRouter(prefix="/procurement", tags=["procurement"])

MODULE = "procurement"


@router.post("/purchase-orders", response_model=PurchaseOrderRead)
def create_purchase_order_endpoint(
    payload: PurchaseOrderCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> PurchaseOrderRead:
    payload.tenant_id = user.tenant_id
    from app.services.purchase_order_document_service import purchase_order_to_read

    po = create_purchase_order(db, payload)
    po = get_purchase_order(db, user.tenant_id, po.id)
    return purchase_order_to_read(db, user.tenant_id, po)


@router.get("/purchase-orders", response_model=list[PurchaseOrderListRead])
def list_purchase_orders_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)
) -> list[PurchaseOrderListRead]:
    orders = list_purchase_orders(db, tenant_id)
    return [
        PurchaseOrderListRead(
            **PurchaseOrderRead.model_validate(o).model_dump(),
            supplier_name=o.supplier.name if o.supplier else None,
        )
        for o in orders
    ]


@router.patch("/purchase-orders/{po_id}/status", response_model=PurchaseOrderRead)
def update_purchase_order_status_endpoint(
    po_id: int,
    status: str = Query(..., description="e.g. draft, approved, received, cancelled"),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> PurchaseOrderRead:
    requested_status = status.strip().lower()
    approval_roles = {"Purchase Manager"}
    if requested_status in {"approved", "cancelled"} and not (
        user_is_admin(user) or approval_roles.intersection(get_role_names(user))
    ):
        raise HTTPException(
            status_code=403,
            detail="Only a Purchase Manager can approve or reject a Purchase Order.",
        )
    po = update_purchase_order_status(db, po_id, user.tenant_id, requested_status)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return po


@router.get("/vendors/summary", response_model=VendorSummaryRead)
def vendor_summary_endpoint(
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> VendorSummaryRead:
    _require_vendor_access(user)
    return get_vendor_summary(db, user.tenant_id)


@router.get("/vendors/export")
def export_vendors_endpoint(
    format: str = Query("excel", description="excel or pdf"),
    search: str | None = None,
    vendor_type: str | None = None,
    status: str | None = None,
    state: str | None = None,
    city: str | None = None,
    preferred: bool | None = None,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    """Return vendor rows for client-side Excel/PDF export."""
    _require_vendor_access(user)
    rows = list_vendors_enriched(
        db,
        user.tenant_id,
        search=search,
        vendor_type=vendor_type,
        status=status,
        state=state,
        city=city,
        preferred=preferred,
    )
    return {
        "format": format.lower(),
        "count": len(rows),
        "vendors": [r.model_dump(mode="json") for r in rows],
    }


def _vendor_bank_lookup_handler(
    ifsc: str,
    account_number: str,
    user: User,
):
    """Validate account + IFSC and return bank name / branch."""
    from fastapi import HTTPException, status

    from app.services.bank_lookup_service import lookup_bank_details

    _require_vendor_access(user)
    try:
        return lookup_bank_details(ifsc=ifsc, account_number=account_number)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Unexpected error during bank lookup for ifsc=%s: %s", ifsc, exc
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to verify bank details right now. Please try again.",
        ) from exc


@router.get("/vendors/bank-lookup")
def vendor_bank_lookup_endpoint(
    ifsc: str = Query(..., min_length=11, max_length=11),
    account_number: str = Query(..., min_length=9, max_length=18),
    user: User = Depends(require_permission(MODULE)),
):
    return _vendor_bank_lookup_handler(ifsc=ifsc, account_number=account_number, user=user)


@router.get("/vendors/verify-bank-details")
def vendor_verify_bank_details_endpoint(
    ifsc: str = Query(..., min_length=11, max_length=11),
    account_number: str = Query(..., min_length=9, max_length=18),
    user: User = Depends(require_permission(MODULE)),
):
    """Compatibility alias for bank verification."""
    return _vendor_bank_lookup_handler(ifsc=ifsc, account_number=account_number, user=user)


@router.get("/vendors", response_model=list[VendorListRead])
def list_vendors_endpoint(
    search: str | None = None,
    vendor_type: str | None = None,
    status: str | None = None,
    state: str | None = None,
    city: str | None = None,
    preferred: bool | None = None,
    min_rating: float | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> list[VendorListRead]:
    _require_vendor_access(user)
    from datetime import date as date_cls

    def _parse(d: str | None):
        if not d:
            return None
        try:
            return date_cls.fromisoformat(d[:10])
        except ValueError as exc:
            raise HTTPException(400, f"Invalid date: {d}") from exc

    return list_vendors_enriched(
        db,
        user.tenant_id,
        search=search,
        vendor_type=vendor_type,
        status=status,
        state=state,
        city=city,
        preferred=preferred,
        min_rating=min_rating,
        date_from=_parse(date_from),
        date_to=_parse(date_to),
    )


@router.post("/vendors", response_model=VendorListRead)
def create_vendor_endpoint(
    payload: VendorCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> VendorListRead:
    _require_vendor_write(user)
    payload.tenant_id = user.tenant_id
    try:
        supplier = create_vendor(db, payload, actor=_actor_label(user))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Failed to create vendor") from exc
    from app.services.vendor_service import _to_list_read

    return _to_list_read(db, user.tenant_id, supplier)


@router.post("/vendors/bulk-status")
def bulk_vendor_status_endpoint(
    payload: VendorBulkStatusUpdate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    _require_vendor_write(user)
    updated = bulk_update_vendor_status(
        db, user.tenant_id, payload.vendor_ids, payload.status, actor=_actor_label(user)
    )
    return {"updated": updated, "status": payload.status}


@router.get("/vendors/{vendor_id}", response_model=VendorDetailRead)
def get_vendor_endpoint(
    vendor_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> VendorDetailRead:
    _require_vendor_access(user)
    detail = get_vendor_detail(db, user.tenant_id, vendor_id)
    if not detail:
        raise HTTPException(404, "Vendor not found")
    return detail


@router.get("/vendors/{vendor_id}/purchase-history", response_model=list[VendorPurchaseOrderRead])
def vendor_purchase_history_endpoint(
    vendor_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> list[VendorPurchaseOrderRead]:
    _require_vendor_access(user)
    detail = get_vendor_detail(db, user.tenant_id, vendor_id)
    if not detail:
        raise HTTPException(404, "Vendor not found")
    return get_vendor_purchase_history(db, user.tenant_id, vendor_id)


@router.get("/vendors/{vendor_id}/products", response_model=list[VendorProductRead])
def vendor_products_endpoint(
    vendor_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> list[VendorProductRead]:
    _require_vendor_access(user)
    detail = get_vendor_detail(db, user.tenant_id, vendor_id)
    if not detail:
        raise HTTPException(404, "Vendor not found")
    return list_vendor_products(db, user.tenant_id, vendor_id)


@router.put("/vendors/{vendor_id}", response_model=VendorListRead)
def update_vendor_endpoint(
    vendor_id: int,
    payload: VendorUpdate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> VendorListRead:
    _require_vendor_write(user)
    try:
        supplier = update_vendor(
            db, user.tenant_id, vendor_id, payload, actor=_actor_label(user)
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Failed to update vendor") from exc
    if not supplier:
        raise HTTPException(404, "Vendor not found")
    from app.services.vendor_service import _to_list_read

    return _to_list_read(db, user.tenant_id, supplier)


@router.delete("/vendors/{vendor_id}")
def delete_vendor_endpoint(
    vendor_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    _require_vendor_write(user)
    supplier = soft_delete_vendor(db, user.tenant_id, vendor_id, actor=_actor_label(user))
    if not supplier:
        raise HTTPException(404, "Vendor not found")
    return {"ok": True, "id": vendor_id}


@router.patch("/vendors/{vendor_id}/deactivate", response_model=VendorListRead)
def deactivate_vendor_endpoint(
    vendor_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> VendorListRead:
    _require_vendor_write(user)
    supplier = deactivate_vendor(db, user.tenant_id, vendor_id)
    if not supplier:
        raise HTTPException(404, "Vendor not found")
    from app.services.vendor_service import _to_list_read

    return _to_list_read(db, user.tenant_id, supplier)


@router.patch("/vendors/{vendor_id}/approval", response_model=SupplierRead)
def update_vendor_approval_endpoint(
    vendor_id: int,
    status: str = Query(..., description="approved or rejected"),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> SupplierRead:
    _require_vendor_write(user)
    if status not in ("approved", "rejected", "pending"):
        raise HTTPException(400, "Invalid approval status")
    vendor = update_supplier_approval(db, user.tenant_id, vendor_id, status)
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    return vendor


@router.post("/material-requests", response_model=MaterialRequestRead)
def create_material_request_endpoint(
    payload: MaterialRequestCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> MaterialRequestRead:
    payload.tenant_id = user.tenant_id
    return create_material_request(db, payload)


@router.get("/material-requests", response_model=list[MaterialRequestRead])
def list_material_requests_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)
) -> list[MaterialRequestRead]:
    return list_material_requests(db, tenant_id)


@router.get("/material-requests/summary", response_model=MRSummaryRead)
def mr_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_mr_summary(db, tenant_id)


@router.get("/material-requests/enriched", response_model=list[MRListRead])
def mr_enriched(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_mr_enriched(db, tenant_id)


@router.get("/material-requests/{mr_id}", response_model=MaterialRequestRead)
def get_material_request_endpoint(
    mr_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> MaterialRequestRead:
    mr = get_material_request(db, tenant_id, mr_id)
    if not mr:
        raise HTTPException(404, "Material request not found")
    return mr


@router.put("/material-requests/{mr_id}", response_model=MaterialRequestRead)
def update_material_request_endpoint(
    mr_id: int,
    payload: MaterialRequestUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> MaterialRequestRead:
    mr = update_material_request(
        db, tenant_id, mr_id, payload.model_dump(exclude_unset=True)
    )
    if not mr:
        raise HTTPException(404, "Material request not found")
    return mr


@router.delete("/material-requests/{mr_id}", status_code=204)
def delete_material_request_endpoint(
    mr_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_material_request(db, tenant_id, mr_id):
        raise HTTPException(404, "Material request not found")
    return None


@router.post(
    "/material-requests/{mr_id}/approve",
    response_model=MaterialRequestRead,
)
def approve_material_request_endpoint(
    mr_id: int,
    approved: bool = Query(True),
    notes: str | None = Query(None),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> MaterialRequestRead:
    """Purchase Manager approval before convert-to-PO."""
    is_purchase_manager = any(
        str(role).strip().lower().replace("_", " ").replace("-", " ") == "purchase manager"
        for role in get_role_names(user)
    )
    if not user_is_admin(user) and not is_purchase_manager:
        raise HTTPException(
            status_code=403,
            detail="Only a Purchase Manager can approve or reject a purchase requisition.",
        )
    return approve_material_request(
        db,
        user.tenant_id,
        mr_id,
        approved=approved,
        notes=notes,
        approved_by=getattr(user, "full_name", None) or user.email,
    )


@router.post(
    "/material-requests/{mr_id}/convert-to-po",
    response_model=PurchaseOrderRead,
)
def convert_material_request_to_po_endpoint(
    mr_id: int,
    payload: MaterialRequestConvertToPORequest,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> PurchaseOrderRead:
    return convert_material_request_to_purchase_order(
        db, user.tenant_id, mr_id, payload
    )


@router.post("/goods-receipt", response_model=GoodsReceiptRead)
def create_goods_receipt_endpoint(
    payload: GoodsReceiptCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> GoodsReceiptRead:
    payload.tenant_id = user.tenant_id
    return create_goods_receipt(db, payload)


@router.get("/goods-receipt", response_model=list[GoodsReceiptRead])
def list_goods_receipts_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)
) -> list[GoodsReceiptRead]:
    return list_goods_receipts(db, tenant_id)


@router.get("/goods-receipt/summary", response_model=GRNSummaryRead)
def grn_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_grn_summary(db, tenant_id)


@router.get("/goods-receipt/enriched", response_model=list[GRNListRead])
def grn_enriched(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_grn_enriched(db, tenant_id)


@router.get("/goods-receipt/{grn_id}", response_model=GoodsReceiptRead)
def get_goods_receipt_endpoint(
    grn_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> GoodsReceiptRead:
    gr = get_goods_receipt(db, tenant_id, grn_id)
    if not gr:
        raise HTTPException(404, "Goods receipt not found")
    return gr


@router.put("/goods-receipt/{grn_id}", response_model=GoodsReceiptRead)
def update_goods_receipt_endpoint(
    grn_id: int,
    payload: GoodsReceiptUpdate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> GoodsReceiptRead:
    grn = update_goods_receipt(
        db, user.tenant_id, grn_id, payload.model_dump(exclude_unset=True)
    )
    if not grn:
        raise HTTPException(404, "Goods receipt not found")
    return grn


@router.delete("/goods-receipt/{grn_id}", status_code=204)
def delete_goods_receipt_endpoint(
    grn_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_goods_receipt(db, tenant_id, grn_id):
        raise HTTPException(404, "Goods receipt not found")
    return None


@router.post("/goods-receipt/{grn_id}/qc", response_model=GoodsReceiptRead)
def goods_receipt_qc_endpoint(
    grn_id: int,
    payload: GoodsReceiptQCRequest,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> GoodsReceiptRead:
    return approve_goods_receipt_qc(db, user.tenant_id, grn_id, payload)


@router.post("/supplier-payments", response_model=SupplierPaymentRead)
def create_supplier_payment_endpoint(
    payload: SupplierPaymentCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Depends(get_idempotency_key_header),
) -> SupplierPaymentRead:
    payload.tenant_id = user.tenant_id
    return create_supplier_payment(db, payload, idempotency_key=idempotency_key)


@router.get("/supplier-payments", response_model=list[SupplierPaymentRead])
def list_supplier_payments_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)
) -> list[SupplierPaymentRead]:
    return list_supplier_payments(db, tenant_id)


@router.get("/supplier-payments/{payment_id}", response_model=SupplierPaymentRead)
def get_supplier_payment_endpoint(
    payment_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> SupplierPaymentRead:
    sp = get_supplier_payment(db, tenant_id, payment_id)
    if not sp:
        raise HTTPException(404, "Supplier payment not found")
    return sp


@router.put("/supplier-payments/{payment_id}", response_model=SupplierPaymentRead)
def update_supplier_payment_endpoint(
    payment_id: int,
    payload: SupplierPaymentUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> SupplierPaymentRead:
    sp = update_supplier_payment(
        db, tenant_id, payment_id, payload.model_dump(exclude_unset=True)
    )
    if not sp:
        raise HTTPException(404, "Supplier payment not found")
    return sp


@router.delete("/supplier-payments/{payment_id}", status_code=204)
def delete_supplier_payment_endpoint(
    payment_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_supplier_payment(db, tenant_id, payment_id):
        raise HTTPException(404, "Supplier payment not found")
    return None


@router.get("/rfq/summary", response_model=RFQSummaryRead)
def rfq_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_rfq_summary(db, tenant_id)


@router.get("/rfq", response_model=list[RFQListRead])
def rfq_list(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_rfq_enriched(db, tenant_id)


@router.post("/rfq", response_model=RFQListRead)
def create_rfq_endpoint(
    payload: RFQCreate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    rfq = create_rfq(db, tenant_id, payload)
    rows = list_rfq_enriched(db, tenant_id)
    match = next((r for r in rows if r.id == rfq.id), None)
    if not match:
        raise HTTPException(500, "RFQ created but could not be loaded")
    return match


@router.post("/rfq/{rfq_id}/quotation")
def create_quotation_endpoint(
    rfq_id: int,
    payload: VendorQuotationCreate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    q = create_vendor_quotation(db, tenant_id, rfq_id, payload)
    return {"message": "Quotation recorded successfully", "id": q.id}


@router.patch("/rfq/{rfq_id}/award", response_model=RFQListRead)
def award_rfq_endpoint(
    rfq_id: int,
    payload: RFQAward,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    rfq = award_rfq(db, tenant_id, rfq_id, payload.supplier_id)
    if not rfq:
        raise HTTPException(404, "RFQ not found")
    rows = list_rfq_enriched(db, tenant_id)
    match = next((r for r in rows if r.id == rfq.id), None)
    if not match:
        raise HTTPException(500, "RFQ awarded but could not be loaded")
    return match


@router.get("/rfq/{rfq_id}/comparison", response_model=list[VendorComparisonRead])
def rfq_comparison(rfq_id: int, tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_rfq_comparison(db, tenant_id, rfq_id)


@router.delete("/rfq/{rfq_id}", status_code=204)
def delete_rfq_endpoint(
    rfq_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_rfq(db, tenant_id, rfq_id):
        raise HTTPException(404, "RFQ not found")
    return None



@router.get("/purchase-orders/summary", response_model=POSummaryRead)
def po_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_po_summary(db, tenant_id)


@router.get("/purchase-orders/enriched", response_model=list[POListRead])
def po_enriched(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_po_enriched(db, tenant_id)


@router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderRead)
def get_purchase_order_endpoint(
    po_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
) -> PurchaseOrderRead:
    po = get_purchase_order(db, tenant_id, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    from app.services.purchase_order_document_service import purchase_order_to_read

    return purchase_order_to_read(db, tenant_id, po)


@router.get("/purchase-orders/{po_id}/pdf")
def download_purchase_order_pdf(
    po_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    po = get_purchase_order(db, tenant_id, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    from app.services.purchase_order_document_service import build_purchase_order_pdf_bytes

    pdf_bytes = build_purchase_order_pdf_bytes(db, tenant_id, po)
    safe_no = (po.po_number or str(po_id)).replace("/", "-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="PO-{safe_no}.pdf"'},
    )


@router.put("/purchase-orders/{po_id}", response_model=PurchaseOrderRead)
def update_purchase_order_endpoint(
    po_id: int,
    payload: PurchaseOrderUpdate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
) -> PurchaseOrderRead:
    requested_status = (payload.status or "").strip().lower()
    if requested_status in {"approved", "cancelled"} and not (
        user_is_admin(user) or "Purchase Manager" in get_role_names(user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Only a Purchase Manager can approve or cancel a Purchase Order.",
        )
    po = update_purchase_order(
        db, user.tenant_id, po_id, payload.model_dump(exclude_unset=True)
    )
    if not po:
        raise HTTPException(404, "Purchase order not found")
    from app.services.purchase_order_document_service import purchase_order_to_read

    po = get_purchase_order(db, user.tenant_id, po_id)
    return purchase_order_to_read(db, user.tenant_id, po)


@router.delete("/purchase-orders/{po_id}")
def delete_purchase_order_endpoint(
    po_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_purchase_order(db, tenant_id, po_id):
        raise HTTPException(404, "Purchase order not found")
    return {"ok": True, "id": po_id}


@router.get("/vendor-bills/summary", response_model=VendorBillSummaryRead)
def vendor_bill_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_vendor_bill_summary(db, tenant_id)


@router.get("/vendor-bills", response_model=list[VendorBillListRead])
def vendor_bills_list(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_vendor_bills_enriched(db, tenant_id)


@router.post("/vendor-bills", response_model=VendorBillListRead)
def create_vendor_bill_endpoint(
    payload: VendorBillCreate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    bill = create_vendor_bill(db, tenant_id, payload)
    rows = list_vendor_bills_enriched(db, tenant_id)
    match = next((r for r in rows if r.id == bill.id), None)
    if not match:
        raise HTTPException(500, "Vendor bill created but could not be loaded")
    return match


@router.patch("/vendor-bills/{bill_id}/status", response_model=VendorBillListRead)
def update_vendor_bill_status_endpoint(
    bill_id: int,
    payload: VendorBillStatusUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    bill = update_vendor_bill_status(db, tenant_id, bill_id, payload.status)
    if not bill:
        raise HTTPException(404, "Vendor bill not found")
    rows = list_vendor_bills_enriched(db, tenant_id)
    match = next((r for r in rows if r.id == bill.id), None)
    if not match:
        raise HTTPException(500, "Vendor bill updated but could not be loaded")
    return match


@router.put("/vendor-bills/{bill_id}", response_model=VendorBillListRead)
def update_vendor_bill_endpoint(
    bill_id: int,
    payload: VendorBillUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    bill = update_vendor_bill(db, tenant_id, bill_id, payload)
    if not bill:
        raise HTTPException(404, "Vendor bill not found")
    rows = list_vendor_bills_enriched(db, tenant_id)
    match = next((r for r in rows if r.id == bill.id), None)
    if not match:
        raise HTTPException(500, "Vendor bill updated but could not be loaded")
    return match


@router.delete("/vendor-bills/{bill_id}", status_code=204)
def delete_vendor_bill_endpoint(
    bill_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_vendor_bill(db, tenant_id, bill_id):
        raise HTTPException(404, "Vendor bill not found")
    return None



@router.get("/hub", response_model=ProcurementHubRead)
def procurement_hub(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_procurement_hub(db, tenant_id)
