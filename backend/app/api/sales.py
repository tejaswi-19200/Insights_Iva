from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.idempotency import get_idempotency_key_header
from app.core.permissions import (
    require_any_permission,
    require_lead_create,
    require_permission,
    tenant_scope,
    tenant_scope_action,
    tenant_scope_any,
)
from app.schemas.lead_form import (
    LeadDetailRead,
    LeadDuplicateCheckResponse,
    LeadFormCreate,
    LeadNextIdResponse,
)
from app.services.lead_form_service import (
    _attachment_disk_path,
    check_lead_duplicates,
    create_lead_from_form,
    delete_lead_attachment,
    get_lead_attachment,
    get_lead_detail,
    peek_next_lead_no,
    save_lead_attachments,
    serialize_lead_detail,
)
from app.models.sales import Customer
from app.models.user import User
from app.schemas.sales import (
    CustomerCreate,
    CustomerRead,
    CustomerUpdate,
    LeadCreate,
    LeadUpdate,
    LeadActivityCreate,
    LeadRead,
    PaymentCreate,
    PaymentRead,
    PaymentUpdate,
    QuotationConvertRequest,
    QuotationCreate,
    QuotationRead,
    QuotationUpdate,
    SalesOrderCancelRequest,
    SalesOrderCreate,
    SalesOrderListRead,
    SalesOrderRead,
)
from app.schemas.invoice_v2 import (
    InvoiceEmailRequest,
    InvoiceV2Create,
    InvoiceV2ListResponse,
    InvoiceV2Read,
    InvoiceV2SummaryRead,
)
from app.services.sales_service import (
    create_customer,
    create_lead,
    delete_lead,
    create_payment,
    create_quotation,
    create_sales_order,
    delete_payment,
    delete_quotation,
    delete_sales_order,
    get_payment,
    get_quotation,
    list_customers,
    list_leads,
    list_payments,
    list_quotations,
    list_sales_orders,
    update_customer,
    update_lead,
    update_lead_status,
    update_payment,
    update_quotation,
    update_quotation_status,
    update_sales_order_dispatch,
)
from app.schemas.sales_extended import (
    DispatchListRead,
    DispatchSummaryRead,
    LeadListRead,
    LeadSummaryRead,
    QuotationListRead,
    QuotationSummaryRead,
    SalesHubRead,
    SalesMyWorkRead,
    SOListRead,
    SOSummaryRead,
)
from app.services.sales_extended_service import (
    get_dispatch_summary,
    get_lead_summary,
    get_quotation_summary,
    get_sales_hub,
    get_so_summary,
    list_dispatch_enriched,
    list_leads_enriched,
    list_quotations_enriched,
    list_so_enriched,
)
from app.services.invoice_v2_service import (
    cancel_invoice_v2,
    create_invoice_v2,
    delete_invoice_v2,
    get_invoice_v2,
    get_invoice_v2_summary,
    list_invoices_v2,
    update_invoice_v2,
)

router = APIRouter(prefix="/sales", tags=["sales"])

MODULE = "sales"


@router.post("/customers", response_model=CustomerRead)
def create_customer_endpoint(
    payload: CustomerCreate,
    user: User = Depends(require_any_permission(MODULE, "masters")),
    db: Session = Depends(get_db),
):
    payload.tenant_id = user.tenant_id
    return create_customer(db, payload)


@router.get("/customers", response_model=list[CustomerRead])
def list_customers_endpoint(
    tenant_id: int = Depends(tenant_scope_any(MODULE, "masters")), db: Session = Depends(get_db)
):
    return list_customers(db, tenant_id)


@router.put("/customers/{customer_id}", response_model=CustomerRead)
def update_customer_endpoint(
    customer_id: int,
    payload: CustomerUpdate,
    user: User = Depends(require_any_permission(MODULE, "masters")),
    db: Session = Depends(get_db),
):
    customer = update_customer(db, user.tenant_id, customer_id, payload)
    if not customer:
        raise HTTPException(404, "Customer not found")
    return customer


@router.delete("/customers/{customer_id}")
def delete_customer_endpoint(
    customer_id: int,
    user: User = Depends(require_any_permission(MODULE, "masters")),
    db: Session = Depends(get_db),
):
    customer = update_customer(db, user.tenant_id, customer_id, CustomerUpdate(status="inactive"))
    if not customer:
        raise HTTPException(404, "Customer not found")
    return {"ok": True, "id": customer.id, "status": customer.status}


@router.get("/leads/next-id", response_model=LeadNextIdResponse)
def lead_next_id_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    return LeadNextIdResponse(lead_no=peek_next_lead_no(db, tenant_id))


@router.get("/leads/check-duplicate", response_model=LeadDuplicateCheckResponse)
def lead_check_duplicate_endpoint(
    phone: str | None = Query(None),
    gst_number: str | None = Query(None),
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    matches = check_lead_duplicates(db, tenant_id, phone=phone, gst_number=gst_number)
    return LeadDuplicateCheckResponse(matches=matches)


@router.get("/leads/summary", response_model=LeadSummaryRead)
def leads_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_lead_summary(db, tenant_id)


@router.get("/leads/enriched", response_model=list[LeadListRead])
def leads_enriched(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
    followup_from: str | None = Query(None),
    followup_to: str | None = Query(None),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    open_only: bool = Query(False),
    followup_due: bool = Query(False),
):
    from app.services.sales_extended_service import list_leads_enriched, resolve_sales_hub_period

    fu_from = fu_to = created_from = created_to = None
    if followup_from or followup_to:
        try:
            fu_from, fu_to = resolve_sales_hub_period(followup_from, followup_to)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if from_date or to_date:
        try:
            created_from, created_to = resolve_sales_hub_period(from_date, to_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return list_leads_enriched(
        db,
        tenant_id,
        followup_from=fu_from,
        followup_to=fu_to,
        created_from=created_from,
        created_to=created_to,
        open_only=open_only,
        followup_due=followup_due,
    )


@router.post("/leads", response_model=LeadDetailRead)
def create_lead_endpoint(
    payload: LeadFormCreate,
    user: User = Depends(require_lead_create()),
    db: Session = Depends(get_db),
):
    payload.tenant_id = user.tenant_id
    if not (payload.sales_executive or "").strip():
        payload.sales_executive = (user.full_name or user.email or "").strip() or None
    try:
        lead = create_lead_from_form(db, user.tenant_id, user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    lead = get_lead_detail(db, user.tenant_id, lead.id) or lead
    return serialize_lead_detail(lead, db)


@router.get("/leads/{lead_id}", response_model=LeadDetailRead)
def get_lead_endpoint(
    lead_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    lead = get_lead_detail(db, tenant_id, lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    return serialize_lead_detail(lead, db)


@router.post("/leads/{lead_id}/attachments")
async def upload_lead_attachments_endpoint(
    lead_id: int,
    files: list[UploadFile] = File(...),
    user: User = Depends(require_lead_create()),
    db: Session = Depends(get_db),
):
    saved = await save_lead_attachments(db, user.tenant_id, lead_id, user.id, files)
    return {"items": [{"id": f.id, "file_name": f.file_name, "size": f.size} for f in saved]}


@router.get("/leads/{lead_id}/attachments/{attachment_id}")
def download_lead_attachment_endpoint(
    lead_id: int,
    attachment_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    row = get_lead_attachment(db, tenant_id, lead_id, attachment_id)
    disk = _attachment_disk_path(row)
    if not disk.is_file():
        raise HTTPException(404, "Attachment file not found")
    return FileResponse(path=disk, filename=row.file_name, media_type="application/octet-stream")


@router.delete("/leads/{lead_id}/attachments/{attachment_id}")
def delete_lead_attachment_endpoint(
    lead_id: int,
    attachment_id: int,
    user: User = Depends(require_lead_create()),
    db: Session = Depends(get_db),
):
    delete_lead_attachment(db, user.tenant_id, lead_id, attachment_id)
    return {"ok": True, "id": attachment_id}


@router.get("/leads", response_model=list[LeadRead])
def list_leads_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return list_leads(db, tenant_id, status)


@router.post("/leads/{lead_id}/convert-to-quotation", response_model=QuotationRead)
def convert_lead_to_quotation_endpoint(
    lead_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    """Customer enquiry (Lead) → Quotation."""
    from app.services.sales_service import convert_lead_to_quotation

    return convert_lead_to_quotation(
        db,
        user.tenant_id,
        lead_id,
        sales_person=user.full_name or user.email,
    )


@router.patch("/leads/{lead_id}/status", response_model=LeadRead)
def update_lead_status_endpoint(
    lead_id: int,
    status: str = Query(...),
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    lead = update_lead_status(db, tenant_id, lead_id, status)
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


@router.patch("/leads/{lead_id}", response_model=LeadDetailRead)
def update_lead_endpoint(
    lead_id: int,
    payload: LeadUpdate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    lead = update_lead(db, user.tenant_id, lead_id, payload)
    if not lead:
        raise HTTPException(404, "Lead not found")
    lead = get_lead_detail(db, user.tenant_id, lead.id) or lead
    return serialize_lead_detail(lead, db)


@router.delete("/leads/{lead_id}")
def delete_lead_endpoint(
    lead_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    deleted = delete_lead(db, user.tenant_id, lead_id)
    if not deleted:
        raise HTTPException(404, "Lead not found")
    return {"ok": True, "id": lead_id}


@router.get("/leads/{lead_id}/activities")
def list_lead_activities_endpoint(
    lead_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import list_lead_activities

    return list_lead_activities(db, tenant_id, lead_id)


@router.post("/leads/{lead_id}/activities", status_code=201)
def create_lead_activity_endpoint(
    lead_id: int,
    payload: LeadActivityCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import create_lead_activity

    return create_lead_activity(db, user.tenant_id, lead_id, payload, user)


@router.post("/quotations", response_model=QuotationRead)
def create_quotation_endpoint(
    payload: QuotationCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    payload.tenant_id = user.tenant_id
    return create_quotation(db, payload)


@router.get("/quotations", response_model=list[QuotationRead])
def list_quotations_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return list_quotations(db, tenant_id, status)


@router.patch("/quotations/{quote_id}/status", response_model=QuotationRead)
def update_quotation_status_endpoint(
    quote_id: int,
    status: str = Query(...),
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    quote = update_quotation_status(db, tenant_id, quote_id, status)
    if not quote:
        raise HTTPException(404, "Quotation not found")
    return quote


@router.post("/sales-orders", response_model=SalesOrderRead)
def create_sales_order_endpoint(
    payload: SalesOrderCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    payload.tenant_id = user.tenant_id
    data = payload.model_dump()
    if not (data.get("sales_person") or "").strip():
        data["sales_person"] = (user.full_name or user.email or "").strip() or None
    so = create_sales_order(db, SalesOrderCreate(**data))
    if (data.get("status") or "").lower() in {"confirmed", "approved"}:
        from app.services.workflow_team_service import confirm_sales_order_with_workflow

        confirm_sales_order_with_workflow(db, user.tenant_id, so.id, user)
        db.refresh(so)
    return so


@router.get("/sales-orders", response_model=list[SalesOrderListRead])
def list_sales_orders_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
):
    orders = list_sales_orders(db, tenant_id, status)
    return [
        SalesOrderListRead(
            **SalesOrderRead.model_validate(o).model_dump(),
            customer_name=o.customer.name if o.customer else None,
        )
        for o in orders
    ]


@router.get("/sales-orders/summary", response_model=SOSummaryRead)
def so_summary(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return get_so_summary(db, tenant_id)


@router.get("/sales-orders/enriched", response_model=list[SOListRead])
def so_enriched(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
):
    period_start = period_end = None
    if from_date or to_date:
        from app.services.sales_extended_service import resolve_sales_hub_period

        try:
            period_start, period_end = resolve_sales_hub_period(from_date, to_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return list_so_enriched(
        db, tenant_id, period_start=period_start, period_end=period_end
    )


@router.delete("/sales-orders/{order_id}")
def delete_sales_order_endpoint(
    order_id: int,
    tenant_id: int = Depends(tenant_scope_action(MODULE, "delete")),
    db: Session = Depends(get_db),
):
    if not delete_sales_order(db, tenant_id, order_id):
        raise HTTPException(404, "Sales order not found")
    return {"ok": True, "id": order_id}


@router.patch("/sales-orders/{order_id}/status", response_model=SalesOrderRead)
def update_sales_order_status_endpoint(
    order_id: int,
    status: str = Query(...),
    expected_version: int | None = Query(None),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import update_sales_order_status

    order = update_sales_order_status(
        db,
        user.tenant_id,
        order_id,
        status,
        user=user,
        expected_version=expected_version,
    )
    if not order:
        raise HTTPException(404, "Sales order not found")
    return order


@router.post("/sales-orders/{order_id}/confirm")
def confirm_sales_order_endpoint(
    order_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    """Confirm SO → workflow engine (material check + MRP)."""
    from app.services.workflow_team_service import confirm_sales_order_with_workflow

    try:
        return confirm_sales_order_with_workflow(db, user.tenant_id, order_id, user)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/sales-orders/{order_id}/cancel")
def cancel_sales_order_endpoint(
    order_id: int,
    payload: SalesOrderCancelRequest,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    """Customer-requested cancellation — Sales Manager / Admin only."""
    from app.services.sales_order_cancellation_service import cancel_sales_order_with_workflow

    return cancel_sales_order_with_workflow(
        db,
        user.tenant_id,
        order_id,
        user,
        cancellation_reason=payload.cancellation_reason,
        cancellation_type=payload.cancellation_type,
        expected_version=payload.expected_version,
    )


@router.post("/quotations/{quote_id}/convert-to-so", response_model=SalesOrderRead)
def convert_quotation_to_so_endpoint(
    quote_id: int,
    payload: QuotationConvertRequest | None = None,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import convert_quotation_to_sales_order

    body = payload or QuotationConvertRequest()
    so = convert_quotation_to_sales_order(
        db,
        user.tenant_id,
        quote_id,
        items=[item.model_dump() for item in body.items],
        product_id=body.product_id,
        item_description=body.item_description,
        quantity=body.quantity,
        unit=body.unit,
        unit_price=body.unit_price,
    )
    return so


@router.patch("/sales-orders/{order_id}/dispatch", response_model=SalesOrderRead)
def update_sales_order_dispatch_endpoint(
    order_id: int,
    packed: bool | None = Query(None),
    shipped: bool | None = Query(None),
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    order = update_sales_order_dispatch(db, tenant_id, order_id, packed, shipped)
    if not order:
        raise HTTPException(404, "Sales order not found")
    return order


@router.post("/sales-orders/{order_id}/confirm-delivery", response_model=SalesOrderRead)
def confirm_delivery_endpoint(
    order_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import confirm_delivery

    order = confirm_delivery(db, tenant_id, order_id)
    if not order:
        raise HTTPException(404, "Sales order not found")
    return order


@router.get("/workflow/board")
def get_manufacturing_workflow_board(
    user: User = Depends(
        require_any_permission(
            "sales",
            "production",
            "procurement",
            "inventory",
            "quality",
            "maintenance",
            "accounts",
            "analytics",
            "admin",
        )
    ),
    db: Session = Depends(get_db),
):
    """Role-filtered manufacturing workflow board (reuses existing SO chain)."""
    from app.services.manufacturing_workflow_service import list_role_workflow_board

    return list_role_workflow_board(db, user.tenant_id, user)


@router.get("/sales-orders/{order_id}/workflow")
def get_sales_order_workflow_endpoint(
    order_id: int,
    user: User = Depends(
        require_any_permission(
            "sales",
            "production",
            "procurement",
            "inventory",
            "quality",
            "maintenance",
            "accounts",
            "analytics",
            "admin",
        )
    ),
    db: Session = Depends(get_db),
):
    """Role-filtered step status for one sales order."""
    from app.services.manufacturing_workflow_service import get_role_workflow_for_order

    return get_role_workflow_for_order(db, user.tenant_id, order_id, user)


@router.get("/sales-orders/{order_id}/traceability")
def get_sales_order_traceability_endpoint(
    order_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    """Full manufacturing chain for a sales order (existing module records)."""
    from app.services.manufacturing_workflow_service import get_order_traceability

    return get_order_traceability(db, tenant_id, order_id)


@router.get("/sales-orders/{order_id}")
def get_sales_order_detail_endpoint(
    order_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.sales_service import get_sales_order_with_items

    order = get_sales_order_with_items(db, tenant_id, order_id)
    if not order:
        raise HTTPException(404, "Sales order not found")
    data = SalesOrderRead.model_validate(order)
    cust = CustomerRead.model_validate(order.customer) if order.customer else None
    lines = [
        {
            "id": line.id,
            "product_id": line.product_id,
            "item_description": line.item_description,
            "quantity": float(line.quantity),
            "unit": line.unit,
            "unit_price": float(line.unit_price or 0),
            "line_total": float(line.line_total or 0),
        }
        for line in (order.line_items or [])
    ]
    from app.services.sales_service import list_production_orders_for_sales_order

    production_orders = [
        {
            "id": po.id,
            "order_number": po.order_number,
            "product_id": po.product_id,
            "planned_quantity": float(po.planned_quantity or 0),
            "status": po.status,
        }
        for po in list_production_orders_for_sales_order(
            db, tenant_id, order.id, order.order_number
        )
    ]
    cancelled_by_name = None
    if order.cancelled_by_user_id:
        cancelled_user = db.get(User, order.cancelled_by_user_id)
        cancelled_by_name = cancelled_user.full_name if cancelled_user else None

    from app.services.sales_order_cancellation_service import (
        evaluate_sales_order_cancellation,
        user_can_cancel_sales_order,
    )

    cancellation_eval = evaluate_sales_order_cancellation(db, tenant_id, order)
    order_payload = data.model_dump()
    order_payload["cancelled_by_name"] = cancelled_by_name

    return {
        "order": order_payload,
        "customer": cust,
        "line_items": lines,
        "production_orders": production_orders,
        "cancellation": {
            "can_cancel": user_can_cancel_sales_order(user) and cancellation_eval.get("allowed"),
            "blockers": cancellation_eval.get("blockers") or [],
            "material_return_required": cancellation_eval.get("material_return_required", False),
        },
    }


@router.post("/invoices", response_model=InvoiceV2Read)
def create_invoice_endpoint(
    payload: InvoiceV2Create,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    """Invoice v2 create — Tax Invoice / Bill of Supply / Export + optional fields."""
    payload.tenant_id = user.tenant_id
    inv = create_invoice_v2(db, payload)
    return get_invoice_v2(db, user.tenant_id, inv.id)


@router.get("/invoices/summary", response_model=InvoiceV2SummaryRead)
def invoices_summary(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
):
    """KPI tabs: Total Sales / Unpaid / Paid / Partially Paid."""
    return get_invoice_v2_summary(db, tenant_id, date_from=date_from, date_to=date_to)


@router.get("/invoices/v2", response_model=InvoiceV2ListResponse)
def list_invoices_v2_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    search: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    payment_filter: str | None = Query("all", description="all|unpaid|paid|partial|partially_paid"),
    sort_by: str = Query("date_desc"),
    due: str | None = Query(None, description="overdue|today|tomorrow|custom"),
    custom_due_date: date | None = Query(None),
    invoice_status: str | None = Query(None, description="active|cancelled"),
    e_invoice_status: str | None = Query(None),
    e_waybill_status: str | None = Query(None),
    export_status: str | None = Query(None),
    document_type: str | None = Query(None, description="sale|bos|export"),
    amount_band: str | None = Query(None),
    customer_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Paginated Invoice v2 list with filters + sort."""
    return list_invoices_v2(
        db,
        tenant_id,
        page=page,
        page_size=page_size,
        search=search,
        date_from=date_from,
        date_to=date_to,
        customer_id=customer_id,
        payment_filter=payment_filter,
        sort_by=sort_by,
        due=due,
        custom_due_date=custom_due_date,
        invoice_status=invoice_status,
        e_invoice_status=e_invoice_status,
        e_waybill_status=e_waybill_status,
        export_status=export_status,
        document_type=document_type,
        amount_band=amount_band,
    )


@router.get("/invoices/enriched", response_model=InvoiceV2ListResponse)
def invoices_enriched(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    customer_id: int | None = Query(None),
    payment_filter: str | None = Query("all"),
    sort_by: str = Query("date_desc"),
    db: Session = Depends(get_db),
):
    """Alias for v2 list (replaces legacy enriched endpoint)."""
    return list_invoices_v2(
        db,
        tenant_id,
        page=page,
        page_size=page_size,
        search=search,
        date_from=date_from,
        date_to=date_to,
        customer_id=customer_id,
        payment_filter=payment_filter,
        sort_by=sort_by,
    )


@router.get("/invoices", response_model=InvoiceV2ListResponse)
def list_invoices_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    search: str | None = Query(None),
    status: str | None = Query(None, description="Legacy; prefer payment_filter"),
    payment_filter: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    customer_id: int | None = Query(None),
    sort_by: str = Query("date_desc"),
    db: Session = Depends(get_db),
):
    pf = payment_filter or status or "all"
    if pf in ("sent", "issued", "pending"):
        pf = "unpaid"
    return list_invoices_v2(
        db,
        tenant_id,
        page=page,
        page_size=page_size,
        search=search,
        date_from=date_from,
        date_to=date_to,
        customer_id=customer_id,
        payment_filter=pf,
        sort_by=sort_by,
    )


@router.get("/invoices/{invoice_id}")
def get_invoice_detail_endpoint(
    invoice_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    inv = get_invoice_v2(db, tenant_id, invoice_id)
    if not inv:
        raise HTTPException(404, "Invoice not found")
    customer = None
    if inv.customer_id:
        customer = db.scalars(
            select(Customer).where(
                Customer.id == inv.customer_id, Customer.tenant_id == tenant_id
            )
        ).first()
    cust_payload = None
    if customer:
        cust_payload = {
            "id": customer.id,
            "name": customer.name,
            "contact_name": customer.contact_name,
            "address_line1": customer.address_line1,
            "address_line2": customer.address_line2,
            "city": customer.city,
            "pincode": customer.pincode,
            "state": customer.state,
            "state_code": customer.state_code,
            "gstin": customer.gstin,
            "email": customer.email,
            "phone": customer.phone,
        }
    # Compatibility wrapper for BillDetail / InvoiceCopy pages
    return {
        "found": True,
        "invoice": inv,
        "items": inv.items,
        "customer": cust_payload
        or ({"id": inv.customer_id, "name": inv.buyer_name} if inv.buyer_name else None),
    }


@router.get("/invoices/{invoice_id}/document")
def get_invoice_document_endpoint(
    invoice_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.invoice_gst_service import build_invoice_document

    doc = build_invoice_document(db, tenant_id, invoice_id)
    if not doc:
        raise HTTPException(404, "Invoice not found")
    return doc


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf_endpoint(
    invoice_id: int,
    request: Request,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.audit_log_service import AuditLogService
    from app.services.invoice_gst_service import build_invoice_document
    from app.services.invoice_pdf_service import generate_invoice_pdf

    doc = build_invoice_document(db, tenant_id, invoice_id)
    if not doc:
        raise HTTPException(404, "Invoice not found")
    pdf_bytes = generate_invoice_pdf(doc)
    inv_no = doc.get("meta", {}).get("invoice_no", str(invoice_id))
    try:
        user = getattr(request.state, "user", None)
        if user:
            AuditLogService.log(
                db,
                request=request,
                current_user=user,
                action="invoice_pdf_download",
                module_name="sales",
                resource="invoice",
                resource_id=invoice_id,
                details=f"Downloaded PDF for invoice {inv_no}",
            )
    except Exception:
        pass
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Invoice-{inv_no}.pdf"'},
    )


@router.post("/invoices/{invoice_id}/email")
async def email_invoice_endpoint(
    invoice_id: int,
    payload: InvoiceEmailRequest,
    request: Request,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.audit_log_service import AuditLogService
    from app.services.email_service import EmailDeliveryError, send_email_async
    from app.services.invoice_gst_service import build_invoice_document
    from app.services.invoice_pdf_service import generate_invoice_pdf

    doc = build_invoice_document(db, user.tenant_id, invoice_id)
    if not doc:
        raise HTTPException(404, "Invoice not found")

    inv_read = get_invoice_v2(db, user.tenant_id, invoice_id)
    customer = db.get(Customer, inv_read.customer_id) if inv_read and inv_read.customer_id else None
    to_email = (payload.to_email or (customer.email if customer else "") or "").strip()
    if not to_email:
        raise HTTPException(400, "Recipient email is required")

    inv_no = doc.get("meta", {}).get("invoice_no", str(invoice_id))
    seller = doc.get("seller", {}).get("name", "Insights Iva")
    subject = payload.subject or f"Tax Invoice {inv_no} from {seller}"
    message = payload.message or f"Please find attached tax invoice {inv_no}."
    pdf_bytes = generate_invoice_pdf(doc)

    try:
        await send_email_async(
            to_email,
            subject,
            message,
            attachments=[(f"Invoice-{inv_no}.pdf", pdf_bytes, "application/pdf")],
        )
    except EmailDeliveryError as exc:
        raise HTTPException(503, exc.public_message) from exc

    try:
        AuditLogService.log(
            db,
            request=request,
            current_user=user,
            action="invoice_email",
            module_name="sales",
            resource="invoice",
            resource_id=invoice_id,
            details=f"Emailed invoice {inv_no} to {to_email}",
        )
    except Exception:
        pass

    return {"ok": True, "to": to_email, "invoice_number": inv_no}


@router.put("/invoices/{invoice_id}", response_model=InvoiceV2Read)
def update_invoice_endpoint(
    invoice_id: int,
    payload: InvoiceV2Create,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    payload.tenant_id = user.tenant_id
    try:
        inv = update_invoice_v2(db, user.tenant_id, invoice_id, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return get_invoice_v2(db, user.tenant_id, inv.id)


@router.patch("/invoices/{invoice_id}/status")
def patch_invoice_status_endpoint(
    invoice_id: int,
    status: str = Query(...),
    amount_paid: float | None = Query(None),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    from sqlalchemy import select

    from app.models.sales import Invoice
    from app.services.sales_service import _resync_invoice_payment

    inv = db.scalars(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == user.tenant_id)
    ).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv.status = status
    if amount_paid is not None:
        inv.amount_paid = amount_paid
    _resync_invoice_payment(db, inv)
    db.commit()
    db.refresh(inv)
    return {
        "ok": True,
        "id": inv.id,
        "status": inv.status,
        "amount_paid": float(inv.amount_paid or 0),
    }


@router.delete("/invoices/{invoice_id}")
def delete_invoice_endpoint(
    invoice_id: int,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
):
    ok = delete_invoice_v2(db, user.tenant_id, invoice_id)
    if not ok:
        raise HTTPException(404, "Invoice not found")
    return {"ok": True, "id": invoice_id}


@router.post("/payments", response_model=PaymentRead)
def create_payment_endpoint(
    payload: PaymentCreate,
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Depends(get_idempotency_key_header),
):
    payload.tenant_id = user.tenant_id
    return create_payment(db, payload, idempotency_key=idempotency_key)


@router.get("/payments", response_model=list[PaymentRead])
def list_payments_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    invoice_id: int | None = Query(None),
    customer_id: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
):
    return list_payments(
        db,
        tenant_id,
        invoice_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/payments/{payment_id}", response_model=PaymentRead)
def get_payment_endpoint(
    payment_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    payment = get_payment(db, tenant_id, payment_id)
    if not payment:
        raise HTTPException(404, "Payment not found")
    return payment


@router.put("/payments/{payment_id}", response_model=PaymentRead)
def update_payment_endpoint(
    payment_id: int,
    payload: PaymentUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    payment = update_payment(
        db, tenant_id, payment_id, payload.model_dump(exclude_unset=True)
    )
    if not payment:
        raise HTTPException(404, "Payment not found")
    return payment


@router.delete("/payments/{payment_id}")
def delete_payment_endpoint(
    payment_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_payment(db, tenant_id, payment_id):
        raise HTTPException(404, "Payment not found")
    return {"ok": True, "id": payment_id}


@router.get("/quotations/summary", response_model=QuotationSummaryRead)
def quotations_summary(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
):
    period_start = period_end = None
    if from_date or to_date:
        from app.services.sales_extended_service import resolve_sales_hub_period

        try:
            period_start, period_end = resolve_sales_hub_period(from_date, to_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_quotation_summary(
        db, tenant_id, period_start=period_start, period_end=period_end
    )


@router.get("/quotations/enriched", response_model=list[QuotationListRead])
def quotations_enriched(tenant_id: int = Depends(tenant_scope(MODULE)), db: Session = Depends(get_db)):
    return list_quotations_enriched(db, tenant_id)


@router.get("/quotations/{quote_id}", response_model=QuotationRead)
def get_quotation_endpoint(
    quote_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    quote = get_quotation(db, tenant_id, quote_id)
    if not quote:
        raise HTTPException(404, "Quotation not found")
    return quote


@router.put("/quotations/{quote_id}", response_model=QuotationRead)
def update_quotation_endpoint(
    quote_id: int,
    payload: QuotationUpdate,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    quote = update_quotation(
        db, tenant_id, quote_id, payload.model_dump(exclude_unset=True)
    )
    if not quote:
        raise HTTPException(404, "Quotation not found")
    return quote


@router.delete("/quotations/{quote_id}")
def delete_quotation_endpoint(
    quote_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    if not delete_quotation(db, tenant_id, quote_id):
        raise HTTPException(404, "Quotation not found")
    return {"ok": True, "id": quote_id}


@router.get("/quotations/{quote_id}/document")
def get_quotation_document_endpoint(
    quote_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.document_builder_service import build_quotation_document

    from app.services.quotation_public_service import enrich_quotation_document_for_qr

    doc = build_quotation_document(db, tenant_id, quote_id)
    if not doc:
        raise HTTPException(404, "Quotation not found")
    return enrich_quotation_document_for_qr(db, tenant_id, quote_id, doc)


@router.get("/quotations/{quote_id}/pdf")
def download_quotation_pdf_endpoint(
    quote_id: int,
    tenant_id: int = Depends(tenant_scope(MODULE)),
    db: Session = Depends(get_db),
):
    from app.services.document_builder_service import build_quotation_document
    from app.services.invoice_pdf_service import generate_invoice_pdf

    from app.services.quotation_public_service import enrich_quotation_document_for_qr

    doc = build_quotation_document(db, tenant_id, quote_id)
    if not doc:
        raise HTTPException(404, "Quotation not found")
    doc = enrich_quotation_document_for_qr(db, tenant_id, quote_id, doc)
    pdf_bytes = generate_invoice_pdf(doc)
    doc_no = doc.get("meta", {}).get("document_no", str(quote_id))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Quotation-{doc_no}.pdf"'},
    )


@router.get("/hub", response_model=SalesHubRead)
def sales_hub(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
):
    from app.services.sales_extended_service import resolve_sales_hub_period

    try:
        resolve_sales_hub_period(from_date, to_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return get_sales_hub(db, tenant_id, user=user, from_date=from_date, to_date=to_date)


@router.get("/my-work", response_model=SalesMyWorkRead)
def sales_my_work(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    user: User = Depends(require_permission(MODULE)),
    db: Session = Depends(get_db),
    date: str | None = Query(None, description="Activity date (YYYY-MM-DD)"),
):
    from app.services.sales_my_work_service import get_sales_my_work

    try:
        return get_sales_my_work(db, tenant_id, user, activity_date=date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/reports/summary")
def sales_reports_summary_endpoint(
    tenant_id: int = Depends(tenant_scope(MODULE)),
    year: int = Query(None),
    db: Session = Depends(get_db),
):
    """Sales-module analytics summary (same data as /analytics/sales/summary, sales RBAC only)."""
    from app.services.analytics_extended_service import get_sales_analytics

    return get_sales_analytics(db, tenant_id, year)
