"""Sales extended — leads, quotations, SO, dispatch, invoices, hub."""

from calendar import monthrange
from datetime import date, datetime, time, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.sales import Customer, DispatchShipment, Invoice, Lead, Quotation, SalesOrder, SalesOrderLine
from app.models.user import User
from app.services.sales_person_scope import (
    monthly_revenue_scoped_to_sales_person,
    sqlalchemy_sales_person_column_matches,
)
from app.schemas.sales_extended import (
    DispatchListRead,
    DispatchSummaryRead,
    InvoiceListEnrichedRead,
    InvoiceSummaryRead,
    LeadListRead,
    LeadSummaryRead,
    QuotationListRead,
    QuotationSummaryRead,
    SalesHubRead,
    SOLineItemRead,
    SOListRead,
    SOSummaryRead,
)


def resolve_sales_hub_period(
    from_date: str | None = None,
    to_date: str | None = None,
) -> tuple[date, date]:
    """Default reporting period: start of current calendar month through today (local date)."""
    today = date.today()
    period_start = date(today.year, today.month, 1)
    period_end = today
    if from_date is not None and str(from_date).strip():
        period_start = date.fromisoformat(str(from_date).strip())
    if to_date is not None and str(to_date).strip():
        period_end = date.fromisoformat(str(to_date).strip())
    if period_start > period_end:
        raise ValueError("from_date must be on or before to_date")
    return period_start, period_end


def _dt_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _dt_end(d: date) -> datetime:
    return datetime.combine(d, time(23, 59, 59, 999999), tzinfo=timezone.utc)


def _timestamp_in_period(ts: datetime | None, period_start: date, period_end: date) -> bool:
    """True if ts falls on a calendar day within [period_start, period_end] (UTC day for aware ts)."""
    if ts is None:
        return False
    if ts.tzinfo is not None:
        day = ts.astimezone(timezone.utc).date()
    else:
        day = ts.date()
    return period_start <= day <= period_end


def get_lead_summary(db: Session, tenant_id: int) -> LeadSummaryRead:
    leads = list(db.scalars(select(Lead).where(Lead.tenant_id == tenant_id)).all())
    total = len(leads)
    new = sum(1 for l in leads if l.status == "new")
    qualified = sum(1 for l in leads if l.status == "qualified")
    won = sum(1 for l in leads if l.status == "converted")
    lost = sum(1 for l in leads if l.status == "lost")
    rate = round((won / total * 100) if total else 0, 1)
    return LeadSummaryRead(
        total_leads=total,
        new_leads=new,
        qualified_leads=qualified,
        won_customers=won,
        lost_leads=lost,
        conversion_rate=rate,
    )


def list_leads_enriched(
    db: Session,
    tenant_id: int,
    *,
    followup_from: date | None = None,
    followup_to: date | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    open_only: bool = False,
    followup_due: bool = False,
) -> list[LeadListRead]:
    stmt = select(Lead).where(Lead.tenant_id == tenant_id)
    if followup_from is not None:
        stmt = stmt.where(Lead.next_followup >= followup_from)
    if followup_to is not None:
        stmt = stmt.where(Lead.next_followup <= followup_to)
    if created_from is not None:
        stmt = stmt.where(Lead.created_at >= _dt_start(created_from))
    if created_to is not None:
        stmt = stmt.where(Lead.created_at <= _dt_end(created_to))
    if open_only:
        stmt = stmt.where(func.lower(Lead.status).notin_(("converted", "lost")))
    if followup_due:
        stmt = stmt.where(
            Lead.next_followup.isnot(None),
            Lead.next_followup <= _dt_end(date.today()),
        )
    leads = list(db.scalars(stmt.order_by(Lead.id.desc())).all())
    quotations = list(
        db.scalars(
            select(Quotation)
            .where(
                Quotation.tenant_id == tenant_id,
                Quotation.lead_id.in_([lead.id for lead in leads]),
                Quotation.status.not_in(["cancelled", "rejected", "lost"]),
            )
            .order_by(Quotation.id.desc())
        ).all()
    ) if leads else []
    quotation_by_lead = {}
    for quotation in quotations:
        quotation_by_lead.setdefault(quotation.lead_id, quotation)
    return [
        LeadListRead(
            id=l.id,
            lead_id=f"LD-{l.id:05d}",
            customer_name=l.name,
            company=l.company,
            contact=l.phone or l.email,
            source=l.source,
            sales_executive=getattr(l, "sales_executive", None) or "Unassigned",
            priority=getattr(l, "priority", "medium") or "medium",
            next_followup=l.next_followup.isoformat() if getattr(l, "next_followup", None) else None,
            status=l.status,
            opportunity_value=float(l.opportunity_value) if getattr(l, "opportunity_value", None) else None,
            industry=getattr(l, "industry", None),
            region=getattr(l, "region", None),
            quotation_id=quotation_by_lead[l.id].id if l.id in quotation_by_lead else None,
            quotation_number=quotation_by_lead[l.id].quote_number if l.id in quotation_by_lead else None,
        )
        for l in leads
    ]


def get_quotation_summary(
    db: Session,
    tenant_id: int,
    *,
    period_start: date | None = None,
    period_end: date | None = None,
) -> QuotationSummaryRead:
    quotes = list(db.scalars(select(Quotation).where(Quotation.tenant_id == tenant_id)).all())
    if period_start is not None and period_end is not None:
        quotes = [
            q
            for q in quotes
            if q.quote_date and period_start <= q.quote_date <= period_end
        ]
    open_statuses = {"draft", "sent"}
    open_quotes = [q for q in quotes if (q.status or "").lower() in open_statuses]
    quote_numbers = [q.quote_number for q in quotes if q.quote_number]
    converted_refs: set[str] = set()
    if quote_numbers:
        orders = list(
            db.scalars(
                select(SalesOrder.reference_number).where(
                    SalesOrder.tenant_id == tenant_id,
                    SalesOrder.reference_number.in_(quote_numbers),
                )
            ).all()
        )
        converted_refs = {r for r in orders if r}

    pipeline_value = sum(float(q.total_amount or 0) for q in quotes if (q.status or "").lower() in open_statuses | {"accepted"})
    converted_count = sum(1 for q in quotes if q.quote_number and q.quote_number in converted_refs)

    return QuotationSummaryRead(
        total_quotations=len(quotes),
        draft=sum(1 for q in quotes if q.status == "draft"),
        sent=sum(1 for q in quotes if q.status == "sent"),
        accepted=sum(1 for q in quotes if q.status == "accepted"),
        rejected=sum(1 for q in quotes if q.status == "rejected"),
        expired=sum(1 for q in quotes if q.status == "expired"),
        open_quotations=len(open_quotes),
        pipeline_value=pipeline_value,
        converted_to_sales_orders=converted_count,
    )


def list_quotations_enriched(db: Session, tenant_id: int) -> list[QuotationListRead]:
    from app.models.sales import SalesOrder

    quotes = list(
        db.scalars(select(Quotation).where(Quotation.tenant_id == tenant_id).order_by(Quotation.id.desc())).all()
    )
    quote_numbers = [q.quote_number for q in quotes if q.quote_number]
    so_by_ref: dict[str, str] = {}
    if quote_numbers:
        orders = list(
            db.scalars(
                select(SalesOrder).where(
                    SalesOrder.tenant_id == tenant_id,
                    SalesOrder.reference_number.in_(quote_numbers),
                )
            ).all()
        )
        for order in orders:
            ref = order.reference_number
            if ref and ref not in so_by_ref:
                so_by_ref[ref] = order.order_number or ""
    return [
        QuotationListRead(
            id=q.id,
            quote_number=q.quote_number,
            customer_name=q.customer_name,
            sales_person=getattr(q, "sales_person", None),
            amount=float(q.total_amount or 0),
            quote_date=q.quote_date.isoformat() if q.quote_date else None,
            valid_until=q.valid_until.isoformat() if q.valid_until else None,
            status=q.status,
            converted_to_invoice=str(q.status or "").lower() in ("converted", "invoiced"),
            converted_to_so=bool(q.quote_number and q.quote_number in so_by_ref),
            converted_sales_order_number=so_by_ref.get(q.quote_number or ""),
        )
        for q in quotes
    ]


def get_so_summary(db: Session, tenant_id: int) -> SOSummaryRead:
    orders = list(db.scalars(select(SalesOrder).where(SalesOrder.tenant_id == tenant_id)).all())
    active = [o for o in orders if (o.status or "").lower() != "cancelled"]
    revenue = sum(float(o.total_amount or 0) for o in active)
    return SOSummaryRead(
        total_orders=len(active),
        pending=sum(1 for o in active if o.status in ("draft", "pending")),
        confirmed=sum(1 for o in active if o.status == "confirmed"),
        packed=sum(1 for o in active if o.packed),
        shipped=sum(1 for o in active if o.shipped),
        delivered=sum(1 for o in active if o.status in ("delivered", "closed")),
        cancelled=sum(1 for o in orders if (o.status or "").lower() == "cancelled"),
        revenue=revenue,
    )


def _invoice_is_open(i: Invoice) -> bool:
    st = (i.status or "").lower()
    if st in ("paid", "draft", "cancelled"):
        return False
    if (getattr(i, "invoice_status", None) or "active").lower() == "cancelled":
        return False
    return True


def _hub_period_label(period_start: date, period_end: date) -> str:
    if period_start == period_end:
        return period_start.strftime("%d %b %Y")
    if period_start.year == period_end.year and period_start.month == period_end.month:
        return f"{period_start.strftime('%d %b')} – {period_end.strftime('%d %b %Y')}"
    return f"{period_start.strftime('%d %b %Y')} – {period_end.strftime('%d %b %Y')}"


def _hub_period_revenue(
    db: Session,
    tenant_id: int,
    period_start: date,
    period_end: date,
    user: User | None = None,
) -> float:
    """
    Canonical hub period revenue: invoice grand_total in period, else sales order totals.
    When the user is a sales rep (not Admin / Sales Manager / Accountant), scope to their sales_person.
    """
    scoped = monthly_revenue_scoped_to_sales_person(user)

    inv_status_ok = func.lower(Invoice.status).notin_(("draft", "cancelled"))
    inv_lifecycle_ok = func.coalesce(func.lower(Invoice.invoice_status), "active") != "cancelled"
    inv_period = (Invoice.issue_date >= period_start) & (Invoice.issue_date <= period_end)

    inv_conditions = [
        Invoice.tenant_id == tenant_id,
        inv_period,
        inv_status_ok,
        inv_lifecycle_ok,
    ]
    if scoped and user is not None:
        inv_q = (
            select(func.coalesce(func.sum(Invoice.grand_total), 0))
            .select_from(Invoice)
            .outerjoin(SalesOrder, SalesOrder.id == Invoice.sales_order_id)
            .where(
                *inv_conditions,
                or_(
                    sqlalchemy_sales_person_column_matches(Invoice.sales_person, user),
                    sqlalchemy_sales_person_column_matches(SalesOrder.sales_person, user),
                ),
            )
        )
    else:
        inv_q = select(func.coalesce(func.sum(Invoice.grand_total), 0)).where(*inv_conditions)
    monthly_rev = float(db.scalar(inv_q) or 0)

    if monthly_rev <= 0:
        so_q = select(func.coalesce(func.sum(SalesOrder.total_amount), 0)).where(
            SalesOrder.tenant_id == tenant_id,
            func.lower(SalesOrder.status) != "cancelled",
            SalesOrder.order_date >= period_start,
            SalesOrder.order_date <= period_end,
        )
        if scoped and user is not None:
            so_q = so_q.where(sqlalchemy_sales_person_column_matches(SalesOrder.sales_person, user))
        monthly_rev = float(db.scalar(so_q) or 0)

    return monthly_rev


def _hub_monthly_revenue(
    db: Session,
    tenant_id: int,
    year: int,
    month: int,
    user: User | None = None,
) -> float:
    period_start = date(year, month, 1)
    period_end = date(year, month, monthrange(year, month)[1])
    return _hub_period_revenue(db, tenant_id, period_start, period_end, user=user)


def _hub_top_customers(
    db: Session,
    tenant_id: int,
    *,
    period_start: date,
    period_end: date,
    limit: int = 5,
) -> list[dict]:
    rows = db.execute(
        select(
            Customer.name,
            func.count(SalesOrder.id),
            func.coalesce(func.sum(SalesOrder.total_amount), 0),
        )
        .join(SalesOrder, SalesOrder.customer_id == Customer.id)
        .where(
            SalesOrder.tenant_id == tenant_id,
            Customer.tenant_id == tenant_id,
            func.lower(SalesOrder.status) != "cancelled",
            SalesOrder.order_date >= period_start,
            SalesOrder.order_date <= period_end,
        )
        .group_by(Customer.id, Customer.name)
        .order_by(func.sum(SalesOrder.total_amount).desc(), func.count(SalesOrder.id).desc())
        .limit(limit)
    ).all()
    return [
        {"name": str(name), "orders": int(order_count or 0), "revenue": float(revenue or 0)}
        for name, order_count, revenue in rows
    ]


def _hub_sales_executive_performance(
    db: Session,
    tenant_id: int,
    *,
    period_start: date,
    period_end: date,
    limit: int = 5,
) -> list[dict]:
    rows = db.execute(
        select(
            SalesOrder.sales_person,
            func.count(SalesOrder.id),
            func.coalesce(func.sum(SalesOrder.total_amount), 0),
        )
        .where(
            SalesOrder.tenant_id == tenant_id,
            func.lower(SalesOrder.status) != "cancelled",
            SalesOrder.sales_person.isnot(None),
            SalesOrder.sales_person != "",
            SalesOrder.order_date >= period_start,
            SalesOrder.order_date <= period_end,
        )
        .group_by(SalesOrder.sales_person)
        .order_by(func.sum(SalesOrder.total_amount).desc())
        .limit(limit)
    ).all()
    return [
        {
            "name": str(rep),
            "orders": int(order_count or 0),
            "revenue": float(revenue or 0),
        }
        for rep, order_count, revenue in rows
        if rep
    ]


def _hub_open_leads_count(
    db: Session,
    tenant_id: int,
    *,
    period_start: date,
    period_end: date,
) -> int:
    closed = ("converted", "lost")
    return int(
        db.scalar(
            select(func.count(Lead.id)).where(
                Lead.tenant_id == tenant_id,
                func.lower(Lead.status).notin_(closed),
                Lead.created_at >= _dt_start(period_start),
                Lead.created_at <= _dt_end(period_end),
            )
        )
        or 0
    )


def _hub_open_quotations(
    quotes: list[Quotation],
    *,
    period_start: date,
    period_end: date,
) -> tuple[int, float]:
    open_statuses = {"draft", "sent"}
    open_quotes = [
        q
        for q in quotes
        if (q.status or "").lower() in open_statuses
        and q.quote_date
        and period_start <= q.quote_date <= period_end
    ]
    return len(open_quotes), sum(float(q.total_amount or 0) for q in open_quotes)


def _hub_conversion_rate(
    quotes: list[Quotation],
    period_start: date,
    period_end: date,
) -> float:
    in_period = [
        q
        for q in quotes
        if q.quote_date and period_start <= q.quote_date <= period_end
    ]
    if not in_period:
        return 0.0
    won_statuses = {"accepted", "converted", "invoiced"}
    won = sum(1 for q in in_period if (q.status or "").lower() in won_statuses)
    return round((won / len(in_period)) * 100.0, 1)


def list_so_enriched(
    db: Session,
    tenant_id: int,
    *,
    period_start: date | None = None,
    period_end: date | None = None,
) -> list[SOListRead]:
    from sqlalchemy.orm import selectinload

    from app.services.sales_service import (
        delete_blockers_by_sales_order_ids,
        sales_order_can_delete,
    )

    stmt = (
        select(SalesOrder)
        .options(joinedload(SalesOrder.customer), selectinload(SalesOrder.line_items))
        .where(SalesOrder.tenant_id == tenant_id)
    )
    if period_start is not None:
        stmt = stmt.where(SalesOrder.order_date >= period_start)
    if period_end is not None:
        stmt = stmt.where(SalesOrder.order_date <= period_end)
    orders = list(db.scalars(stmt.order_by(SalesOrder.order_date.desc())).all())
    order_ids = [o.id for o in orders]
    blockers_by_order = delete_blockers_by_sales_order_ids(db, tenant_id, order_ids)
    result = []
    for o in orders:
        wh_name = None
        if getattr(o, "warehouse_id", None):
            from app.models.inventory import Warehouse
            wh = db.get(Warehouse, o.warehouse_id)
            wh_name = wh.name if wh else None
        lines = [
            SOLineItemRead(
                item_description=l.item_description,
                quantity=float(l.quantity or 0),
                unit=l.unit,
                unit_price=float(l.unit_price or 0),
                line_total=float(l.line_total or 0),
            )
            for l in (o.line_items or [])
        ]
        total = float(o.total_amount or 0)
        result.append(
            SOListRead(
                id=o.id,
                order_number=o.order_number,
                customer_name=o.customer.name if o.customer else None,
                order_date=o.order_date.isoformat() if o.order_date else "",
                delivery_date=o.delivery_date.isoformat() if getattr(o, "delivery_date", None) else None,
                amount=total,
                total_amount=total,
                payment_terms=getattr(o, "payment_terms", None) or "Not Specified",
                status=o.status,
                sales_person=getattr(o, "sales_person", None),
                warehouse_name=wh_name,
                packed=o.packed,
                shipped=o.shipped,
                invoiced=o.invoiced,
                workflow_status=getattr(o, "workflow_status", None),
                deletable=sales_order_can_delete(o, blockers_by_order.get(o.id, [])),
                delete_blockers=blockers_by_order.get(o.id, []),
                line_items=lines,
            )
        )
    return result


def get_dispatch_summary(db: Session, tenant_id: int) -> DispatchSummaryRead:
    orders = list(db.scalars(select(SalesOrder).where(SalesOrder.tenant_id == tenant_id)).all())
    packed = sum(1 for o in orders if o.packed and not o.shipped)
    in_transit = sum(1 for o in orders if o.shipped and o.status not in ("delivered", "closed"))
    delivered = sum(1 for o in orders if o.status in ("delivered", "closed"))
    ready = sum(
        1
        for o in orders
        if o.status in ("confirmed", "in_production", "ready") and not o.packed
    )
    dispatches = list(
        db.scalars(select(DispatchShipment).where(DispatchShipment.tenant_id == tenant_id)).all()
    )
    delayed = sum(
        1
        for d in dispatches
        if d.eta and d.eta < date.today() and d.status not in ("delivered", "closed")
    )
    return DispatchSummaryRead(
        ready_to_dispatch=ready,
        packed=packed,
        in_transit=in_transit,
        delivered=delivered,
        delayed=delayed,
    )


def list_dispatch_enriched(db: Session, tenant_id: int) -> list[DispatchListRead]:
    """List real shipments plus ready or packed sales orders without dispatch records."""
    dispatches = list(
        db.scalars(
            select(DispatchShipment)
            .options(
                joinedload(DispatchShipment.sales_order),
                joinedload(DispatchShipment.customer),
            )
            .where(DispatchShipment.tenant_id == tenant_id)
            .order_by(DispatchShipment.dispatch_date.desc())
        ).all()
    )
    result = [
        DispatchListRead(
            id=d.id,
            sales_order_id=d.sales_order_id,
            dispatch_number=d.dispatch_number,
            challan_number=d.dispatch_number,
            so_number=d.sales_order.order_number if d.sales_order else None,
            customer_name=d.customer.name if d.customer else None,
            courier=d.courier,
            vehicle_number=d.vehicle_number,
            driver_name=d.driver_name,
            dispatch_date=d.dispatch_date.isoformat() if d.dispatch_date else None,
            eta=d.eta.isoformat() if d.eta else None,
            status=d.status,
            lr_number=d.lr_number,
            tracking_url=d.tracking_url,
            notes=d.notes,
            box_count=d.box_count,
            total_weight=float(d.total_weight) if d.total_weight is not None else None,
            packed=bool(d.sales_order.packed) if d.sales_order else d.status == "packed",
            shipped=bool(d.sales_order.shipped) if d.sales_order else d.status in ("in_transit", "shipped", "delivered"),
            invoiced=bool(d.sales_order.invoiced) if d.sales_order else False,
        )
        for d in dispatches
    ]

    ready_statuses = ("confirmed", "in_production", "ready")
    orders = list(
        db.scalars(
            select(SalesOrder)
            .options(joinedload(SalesOrder.customer))
            .where(
                SalesOrder.tenant_id == tenant_id,
                or_(
                    SalesOrder.packed.is_(True),
                    SalesOrder.status.in_(ready_statuses) & SalesOrder.packed.is_(False),
                ),
                ~SalesOrder.dispatches.any(),
            )
            .order_by(SalesOrder.order_date.desc())
        ).all()
    )
    result.extend(
        [
            DispatchListRead(
                id=-o.id,
                sales_order_id=o.id,
                dispatch_number=f"DC-{o.order_number}",
                challan_number=f"DC-{o.order_number}",
                so_number=o.order_number,
                customer_name=o.customer.name if o.customer else None,
                courier=None,
                vehicle_number=None,
                driver_name=None,
                dispatch_date=o.order_date.isoformat() if o.order_date else None,
                eta=o.delivery_date.isoformat() if getattr(o, "delivery_date", None) else None,
                status=(
                    "in_transit"
                    if o.shipped
                    else "packed"
                    if o.packed
                    else "ready"
                ),
                lr_number=None,
                tracking_url=None,
                packed=bool(o.packed),
                shipped=bool(o.shipped),
                invoiced=bool(o.invoiced),
            )
            for o in orders
        ]
    )
    result.sort(key=lambda row: row.dispatch_date or "", reverse=True)
    return result


def get_invoice_summary(db: Session, tenant_id: int) -> InvoiceSummaryRead:
    invs = list(db.scalars(select(Invoice).where(Invoice.tenant_id == tenant_id)).all())
    today = date.today()
    revenue = sum(float(i.grand_total or 0) for i in invs if i.status == "paid")
    overdue = sum(
        1
        for i in invs
        if i.due_date and i.due_date < today and i.status not in ("paid", "draft")
    )
    return InvoiceSummaryRead(
        total_invoices=len(invs),
        draft=sum(1 for i in invs if i.status == "draft"),
        paid=sum(1 for i in invs if i.status == "paid"),
        pending=sum(1 for i in invs if i.status in ("sent", "partial", "issued")),
        overdue=overdue,
        revenue=revenue,
    )


def list_invoices_enriched(db: Session, tenant_id: int) -> list[InvoiceListEnrichedRead]:
    invs = list(
        db.scalars(
            select(Invoice)
            .options(joinedload(Invoice.customer), joinedload(Invoice.sales_order))
            .where(Invoice.tenant_id == tenant_id)
            .order_by(Invoice.issue_date.desc())
        ).all()
    )
    return [
        InvoiceListEnrichedRead(
            id=i.id,
            invoice_number=i.invoice_number,
            customer_name=i.customer.name if i.customer else None,
            sales_order_number=i.sales_order.order_number if i.sales_order else None,
            amount=float(i.grand_total or 0),
            gst_amount=float(i.sgst_amount or 0) + float(i.cgst_amount or 0) + float(i.igst_amount or 0),
            due_date=i.due_date.isoformat() if i.due_date else None,
            status=i.status,
            amount_paid=float(i.amount_paid or 0),
        )
        for i in invs
    ]


def _hub_period_order_counts(
    db: Session,
    tenant_id: int,
    period_start: date,
    period_end: date,
) -> tuple[int, int, int, int, int]:
    """total_orders, pending_orders, dispatch_pending, pipeline_production, pipeline_completed."""
    orders = list(
        db.scalars(
            select(SalesOrder).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.order_date >= period_start,
                SalesOrder.order_date <= period_end,
            )
        ).all()
    )
    active = [o for o in orders if (o.status or "").lower() != "cancelled"]
    total_orders = len(active)
    pending_orders = sum(1 for o in active if (o.status or "").lower() in ("draft", "pending"))
    dispatch_pending = sum(
        1
        for o in active
        if (o.status or "").lower() in ("confirmed", "in_production", "ready") and not o.packed
    ) + sum(1 for o in active if o.packed and not o.shipped)
    production_statuses = {"in_production", "production", "confirmed", "processing"}
    pipeline_production = sum(
        1 for o in active if (o.status or "").lower() in production_statuses
    )
    completed_statuses = {"delivered", "completed", "closed"}
    pipeline_completed = sum(1 for o in active if (o.status or "").lower() in completed_statuses)
    return total_orders, pending_orders, dispatch_pending, pipeline_production, pipeline_completed


def get_sales_hub(
    db: Session,
    tenant_id: int,
    user: User | None = None,
    *,
    from_date: str | None = None,
    to_date: str | None = None,
) -> SalesHubRead:
    period_start, period_end = resolve_sales_hub_period(from_date, to_date)
    inv_sum = get_invoice_summary(db, tenant_id)
    customers = list(db.scalars(select(Customer).where(Customer.tenant_id == tenant_id)).all())
    invoices = list(db.scalars(select(Invoice).where(Invoice.tenant_id == tenant_id)).all())
    quotes = list(db.scalars(select(Quotation).where(Quotation.tenant_id == tenant_id)).all())

    today = date.today()
    period_label = _hub_period_label(period_start, period_end)
    new_customers_count = sum(
        1
        for c in customers
        if _timestamp_in_period(getattr(c, "created_at", None), period_start, period_end)
    )

    monthly_rev = _hub_period_revenue(db, tenant_id, period_start, period_end, user=user)

    outstanding = sum(
        float(i.grand_total or 0) - float(i.amount_paid or 0)
        for i in invoices
        if _invoice_is_open(i)
    )

    overdue_amount = sum(
        float(i.grand_total or 0) - float(i.amount_paid or 0)
        for i in invoices
        if _invoice_is_open(i) and i.due_date and i.due_date < today
    )

    top_customers = _hub_top_customers(
        db, tenant_id, period_start=period_start, period_end=period_end
    )
    sales_executive_performance = _hub_sales_executive_performance(
        db, tenant_id, period_start=period_start, period_end=period_end
    )

    open_leads = _hub_open_leads_count(
        db, tenant_id, period_start=period_start, period_end=period_end
    )
    open_quotations, open_quotations_value = _hub_open_quotations(
        quotes, period_start=period_start, period_end=period_end
    )
    conversion_rate = _hub_conversion_rate(quotes, period_start, period_end)

    total_orders, pending_orders, dispatch_pending, pipeline_production, pipeline_completed = (
        _hub_period_order_counts(db, tenant_id, period_start, period_end)
    )

    alerts = []
    if overdue_amount > 0:
        alerts.append(
            {
                "type": "overdue_payment",
                "severity": "danger",
                "message": f"Overdue payments — ₹{overdue_amount:,.0f}",
            }
        )
    elif outstanding > 0:
        alerts.append(
            {
                "type": "outstanding_payment",
                "severity": "warning",
                "message": f"Outstanding payments (all time) — ₹{outstanding:,.0f}",
            }
        )
    if dispatch_pending > 0:
        alerts.append(
            {
                "type": "pending_dispatch",
                "severity": "info",
                "message": f"Pending dispatch — {dispatch_pending} orders ready to ship in period",
            }
        )
    if inv_sum.pending > 0:
        alerts.append(
            {
                "type": "pending_invoice",
                "severity": "warning",
                "message": f"Pending invoices — {inv_sum.pending}",
            }
        )

    return SalesHubRead(
        monthly_revenue=monthly_rev,
        total_orders=total_orders,
        pending_orders=pending_orders,
        dispatch_pending=dispatch_pending,
        outstanding_payments=outstanding,
        new_customers=new_customers_count,
        open_leads=open_leads,
        open_quotations=open_quotations,
        open_quotations_value=open_quotations_value,
        conversion_rate=conversion_rate,
        period_label=period_label,
        period_from=period_start.isoformat(),
        period_to=period_end.isoformat(),
        pipeline_production=pipeline_production,
        pipeline_completed=pipeline_completed,
        top_customers=top_customers,
        sales_executive_performance=sales_executive_performance,
        alerts=alerts,
    )
