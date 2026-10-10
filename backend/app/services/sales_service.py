import logging
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

logger = logging.getLogger(__name__)

from app.models.sales import (
    Customer,
    DispatchShipment,
    Invoice,
    InvoiceItem,
    Lead,
    Payment,
    Quotation,
    SalesOrder,
    SalesOrderLine,
)
from app.schemas.sales import (
    CustomerCreate,
    CustomerUpdate,
    InvoiceCreate,
    InvoiceItemCreate,
    PaymentCreate,
    SalesOrderCreate,
    LeadCreate,
    QuotationCreate,
)
from app.schemas.sales_extended import DeliveryChallanRead, DispatchShipmentCreate



def _assert_no_customer_duplicates(
    db: Session,
    tenant_id: int,
    *,
    gstin: str | None,
    exclude_id: int | None = None,
) -> None:
    if gstin and gstin.strip():
        clean_gst = gstin.strip().upper()
        from sqlalchemy import func, or_
        q = select(Customer).where(
            Customer.tenant_id == tenant_id,
            func.upper(Customer.gstin) == clean_gst,
            or_(Customer.status.is_(None), Customer.status != "inactive"),
        )
        if exclude_id:
            q = q.where(Customer.id != exclude_id)
        if db.scalars(q).first():
            raise HTTPException(
                status_code=400,
                detail=f"A customer with GSTIN '{clean_gst}' already exists.",
            )


def create_customer(db: Session, payload: CustomerCreate) -> Customer:
    _assert_no_customer_duplicates(db, payload.tenant_id, gstin=payload.gstin)
    data = payload.model_dump(
        exclude={"party_basic_details", "party_other_details", "party_custom_fields"}
    )
    c = Customer(**data)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def list_customers(db: Session, tenant_id: int) -> list[Customer]:
    from sqlalchemy import or_

    stmt = select(Customer).where(
        Customer.tenant_id == tenant_id,
        or_(Customer.status.is_(None), Customer.status != "inactive"),
    )
    return list(db.scalars(stmt).all())


def get_customer(db: Session, tenant_id: int, customer_id: int) -> Customer | None:
    stmt = select(Customer).where(
        Customer.tenant_id == tenant_id, Customer.id == customer_id
    )
    return db.scalars(stmt).first()


def update_customer(
    db: Session, tenant_id: int, customer_id: int, payload: CustomerUpdate
) -> Customer | None:
    c = get_customer(db, tenant_id, customer_id)
    if not c:
        return None
    data = payload.model_dump(
        exclude_unset=True,
        exclude={"party_basic_details", "party_other_details", "party_custom_fields"},
    )
    if "gstin" in data and data["gstin"]:
        _assert_no_customer_duplicates(db, tenant_id, gstin=data["gstin"], exclude_id=customer_id)
    for key, value in data.items():
        setattr(c, key, value)
    db.commit()
    db.refresh(c)
    return c


def create_sales_order(db: Session, payload: SalesOrderCreate) -> SalesOrder:
    from fastapi import HTTPException
    from app.models.product import Product
    from app.utils.tenant_validation import assert_customer_owned, assert_product_owned

    tenant_id = payload.tenant_id
    if payload.customer_id:
        assert_customer_owned(db, tenant_id, payload.customer_id)
    for line in payload.line_items or []:
        if line.product_id:
            assert_product_owned(db, tenant_id, line.product_id)

    data = payload.model_dump(exclude={"line_items"})
    so = SalesOrder(**data)
    db.add(so)
    db.flush()
    total = 0.0
    for line in payload.line_items or []:
        line_total = float(line.line_total or (line.quantity * line.unit_price))
        sol = SalesOrderLine(
            sales_order_id=so.id,
            product_id=line.product_id,
            item_description=line.item_description,
            quantity=line.quantity,
            unit=line.unit,
            unit_price=line.unit_price,
            line_total=line_total,
        )
        db.add(sol)
        total += line_total
    if total:
        so.total_amount = total
    db.commit()
    db.refresh(so)
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=so.tenant_id,
            alert_type="sales_order",
            title=f"New sales order: {so.order_number}",
            message=f"SO {so.order_number} created — amount ₹{float(so.total_amount or 0):,.2f}",
            severity="medium",
            link=f"/sales/orders/{so.id}",
            reference_type="sales_order",
            reference_id=so.id,
            created_by="Sales",
        )
    except Exception:
        pass
    try:
        from app.services.automation.events import AutomationEvent
        from app.services.automation.hooks import dispatch_automation_event_isolated

        dispatch_automation_event_isolated(so.tenant_id, AutomationEvent.SALES_ORDER_CREATED)
    except Exception:
        pass
    return so


def list_sales_orders(db: Session, tenant_id: int, status: str | None = None) -> list[SalesOrder]:
    stmt = (
        select(SalesOrder)
        .options(joinedload(SalesOrder.customer))
        .where(SalesOrder.tenant_id == tenant_id)
    )
    if status:
        stmt = stmt.where(SalesOrder.status == status)
    stmt = stmt.order_by(SalesOrder.order_date.desc())
    return list(db.scalars(stmt).all())


_DELETABLE_SO_STATUSES = frozenset({
    "draft",
    "pending",
    "confirmed",
    "approved",
    "cancelled",
    "rejected",
    "on_hold",
})


def _count_records_by_sales_order(
    db: Session,
    tenant_id: int,
    order_ids: list[int],
    model,
    fk_column,
) -> dict[int, int]:
    if not order_ids:
        return {}
    rows = db.execute(
        select(fk_column, func.count())
        .where(model.tenant_id == tenant_id, fk_column.in_(order_ids))
        .group_by(fk_column)
    ).all()
    return {int(order_id): int(count) for order_id, count in rows}


def _count_work_orders_by_sales_order(
    db: Session, tenant_id: int, order_ids: list[int]
) -> dict[int, int]:
    if not order_ids:
        return {}
    from app.models.production import ProductionOrder, WorkOrder

    rows = db.execute(
        select(ProductionOrder.sales_order_id, func.count(WorkOrder.id))
        .join(WorkOrder, WorkOrder.production_order_id == ProductionOrder.id)
        .where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.sales_order_id.in_(order_ids),
        )
        .group_by(ProductionOrder.sales_order_id)
    ).all()
    return {int(so_id): int(count) for so_id, count in rows if so_id is not None}


def _count_quality_inspections_by_sales_order(
    db: Session, tenant_id: int, order_ids: list[int]
) -> dict[int, int]:
    if not order_ids:
        return {}
    from app.models.quality import QualityInspection

    orders = list(
        db.scalars(
            select(SalesOrder).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.id.in_(order_ids),
            )
        ).all()
    )
    if not orders:
        return {}
    number_by_id = {o.id: o.order_number for o in orders}
    numbers = list(number_by_id.values())
    rows = db.execute(
        select(QualityInspection.sales_order_number, func.count())
        .where(
            QualityInspection.tenant_id == tenant_id,
            QualityInspection.sales_order_number.in_(numbers),
        )
        .group_by(QualityInspection.sales_order_number)
    ).all()
    count_by_number = {str(num): int(count) for num, count in rows}
    result: dict[int, int] = {}
    for order_id, order_number in number_by_id.items():
        count = count_by_number.get(order_number, 0)
        if count:
            result[order_id] = count
    return result


def _append_delete_blocker(
    blockers_by_order: dict[int, list[str]], order_id: int, count: int, label: str
) -> None:
    if count:
        blockers_by_order.setdefault(order_id, []).append(f"{count} {label}")


def delete_blockers_by_sales_order_ids(
    db: Session, tenant_id: int, order_ids: list[int]
) -> dict[int, list[str]]:
    """Return downstream business-record blockers keyed by sales order id.

    Only counts records that are NOT cleaned up by ``delete_sales_order`` and
    represent real business dependencies (billing, dispatch, QC, etc.).
    Workflow artifacts (job cards, material checks, stage cards) are removed
    during delete and must not block deletion.
    """
    if not order_ids:
        return {}

    blocker_specs = [
        (DispatchShipment, DispatchShipment.sales_order_id, "dispatch"),
        (Invoice, Invoice.sales_order_id, "invoice"),
    ]

    blockers_by_order: dict[int, list[str]] = {order_id: [] for order_id in order_ids}
    for model, fk_column, label in blocker_specs:
        counts = _count_records_by_sales_order(db, tenant_id, order_ids, model, fk_column)
        for order_id, count in counts.items():
            _append_delete_blocker(blockers_by_order, order_id, count, label)

    for order_id, count in _count_quality_inspections_by_sales_order(
        db, tenant_id, order_ids
    ).items():
        _append_delete_blocker(blockers_by_order, order_id, count, "quality inspection")

    return blockers_by_order


def build_sales_order_delete_blocked_detail(
    order_number: str, blockers: list[str]
) -> dict[str, object]:
    display = order_number or "this sales order"
    return {
        "code": "downstream_dependencies",
        "message": (
            f"Sales Order {display} cannot be deleted because it is already linked to "
            "downstream records."
        ),
        "blockers": blockers,
    }


def sales_order_can_delete(order: SalesOrder, blockers: list[str] | None = None) -> bool:
    """True when the sales order has no linked downstream business records."""
    if blockers:
        return False
    if order.invoiced or order.packed or order.shipped:
        return False
    return True

def _purge_sales_order_audit_rows(db: Session, tenant_id: int, order_id: int) -> None:
    """Remove workflow audit rows that are not business dependencies but block FK delete."""
    from app.models.manufacturing_workflow import ManufacturingWorkflowTransition

    transitions = list(
        db.scalars(
            select(ManufacturingWorkflowTransition).where(
                ManufacturingWorkflowTransition.tenant_id == tenant_id,
                ManufacturingWorkflowTransition.sales_order_id == order_id,
            )
        ).all()
    )
    for row in transitions:
        db.delete(row)
    if transitions:
        db.flush()


def delete_sales_order(db: Session, tenant_id: int, order_id: int) -> bool:
    """Hard-delete a sales order and clean up associated workflow documents when not invoiced or dispatched."""
    from fastapi import HTTPException
    from sqlalchemy.exc import IntegrityError

    from app.models.manufacturing_workflow import (
        ManufacturingWorkflowTransition,
        SalesJobCard,
        SalesOrderMaterialCheck,
        WorkflowStageJobCard,
    )
    from app.models.production import ProductionOrder

    order = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == order_id,
            SalesOrder.tenant_id == tenant_id,
        )
    ).first()
    if not order:
        return False

    status = (order.status or "").lower().strip()
    if status not in _DELETABLE_SO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete sales order {order.order_number} with status "
                f"'{order.status}'."
            ),
        )

    if order.invoiced or order.packed or order.shipped:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete sales order {order.order_number} because it has already been "
                "invoiced, packed, or shipped."
            ),
        )

    blockers = delete_blockers_by_sales_order_ids(db, tenant_id, [order_id]).get(order_id, [])
    if blockers:
        raise HTTPException(
            status_code=409,
            detail=build_sales_order_delete_blocked_detail(order.order_number, blockers),
        )

    try:
        # Delete linked stage job cards (and cascaded material issue lines)
        stage_cards = list(
            db.scalars(
                select(WorkflowStageJobCard).where(
                    WorkflowStageJobCard.sales_order_id == order_id,
                    WorkflowStageJobCard.tenant_id == tenant_id,
                )
            ).all()
        )
        for card in stage_cards:
            db.delete(card)

        # Delete linked sales job cards
        sales_cards = list(
            db.scalars(
                select(SalesJobCard).where(
                    SalesJobCard.sales_order_id == order_id,
                    SalesJobCard.tenant_id == tenant_id,
                )
            ).all()
        )
        for sc in sales_cards:
            db.delete(sc)

        # Delete linked material checks (and cascaded material check lines)
        mat_checks = list(
            db.scalars(
                select(SalesOrderMaterialCheck).where(
                    SalesOrderMaterialCheck.sales_order_id == order_id,
                    SalesOrderMaterialCheck.tenant_id == tenant_id,
                )
            ).all()
        )
        for mc in mat_checks:
            db.delete(mc)

        # Delete linked workflow transitions
        transitions = list(
            db.scalars(
                select(ManufacturingWorkflowTransition).where(
                    ManufacturingWorkflowTransition.sales_order_id == order_id,
                    ManufacturingWorkflowTransition.tenant_id == tenant_id,
                )
            ).all()
        )
        for tr in transitions:
            db.delete(tr)

        # Unlink or delete production orders
        prod_orders = list(
            db.scalars(
                select(ProductionOrder).where(
                    ProductionOrder.sales_order_id == order_id,
                    ProductionOrder.tenant_id == tenant_id,
                )
            ).all()
        )
        for po in prod_orders:
            if po.status in ("completed", "in_progress"):
                po.sales_order_id = None
            else:
                db.delete(po)

        from app.models.task import Task

        for t in db.scalars(
            select(Task).where(
                Task.tenant_id == tenant_id,
                Task.module == "sales_order",
            )
        ).all():
            db.delete(t)

        _purge_sales_order_audit_rows(db, tenant_id, order_id)
        db.delete(order)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "delete_conflict",
                "message": (
                    "This sales order cannot be deleted because it is referenced by other records."
                ),
            },
        )
    except Exception:
        db.rollback()
        raise
    return True


def update_sales_order_status(
    db: Session,
    tenant_id: int,
    order_id: int,
    status: str,
    *,
    user=None,
    expected_version: int | None = None,
) -> SalesOrder | None:
    from app.core.concurrency import assert_entity_version, bump_entity_version

    order = db.scalars(
        select(SalesOrder)
        .where(SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id)
        .with_for_update()
    ).first()
    if not order:
        return None
    assert_entity_version(order, expected_version)
    previous = (order.status or "").lower()
    new_status = (status or "").lower()
    if new_status in {"confirmed", "approved"} and previous not in {
        "confirmed",
        "approved",
    }:
        from fastapi import HTTPException

        from app.services.workflow_team_service import confirm_sales_order_with_workflow

        if user is None:
            raise HTTPException(
                status_code=400,
                detail="Authenticated user required to confirm sales order",
            )
        confirm_sales_order_with_workflow(db, tenant_id, order.id, user)
        db.refresh(order)
        return order

    order.status = status
    bump_entity_version(order)
    db.commit()
    db.refresh(order)
    return order


def confirm_sales_order(
    db: Session,
    tenant_id: int,
    order_id: int,
    user,
    *,
    requested_by: str | None = None,
) -> dict:
    """Confirm SO through the team workflow engine (material check queue)."""
    from app.services.workflow_team_service import confirm_sales_order_with_workflow

    if user is None:
        raise ValueError("User required to confirm sales order")
    return confirm_sales_order_with_workflow(db, tenant_id, order_id, user)


def convert_quotation_to_sales_order(
    db: Session,
    tenant_id: int,
    quote_id: int,
    *,
    items: list[dict] | None = None,
    product_id: int | None = None,
    item_description: str | None = None,
    quantity: float | None = None,
    unit: str = "pcs",
    unit_price: float | None = None,
) -> SalesOrder:
    """Create a sales order from an accepted/sent quotation."""
    from datetime import date as date_cls
    from fastapi import HTTPException

    from app.models.product import Product

    quote = db.scalars(
        select(Quotation).where(
            Quotation.id == quote_id, Quotation.tenant_id == tenant_id
        )
    ).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not quote.customer_id:
        raise HTTPException(
            status_code=400,
            detail="Quotation has no customer — link a customer before converting.",
        )
    qstatus = (quote.status or "").lower()
    if qstatus not in {"accepted", "sent", "approved"}:
        raise HTTPException(
            status_code=400,
            detail=(
                "Quotation must be approved/sent/accepted by the customer "
                f"before creating a sales order (current: {quote.status})."
            ),
        )

    # Avoid duplicate convert for same quote reference
    existing = db.scalars(
        select(SalesOrder).where(
            SalesOrder.tenant_id == tenant_id,
            SalesOrder.reference_number == quote.quote_number,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Sales order {existing.order_number} already exists for this quotation.",
        )

    requested_items = list(items or [])
    if not requested_items and (product_id or item_description):
        requested_items = [{
            "product_id": product_id,
            "item_description": item_description or "",
            "quantity": quantity or 1,
            "unit": unit,
            "unit_price": unit_price,
        }]
    if not requested_items:
        raise HTTPException(status_code=400, detail="Select at least one quotation item before converting.")

    ts = date_cls.today().strftime("%Y%m%d")
    so = SalesOrder(
        tenant_id=tenant_id,
        customer_id=quote.customer_id,
        order_number=f"SO-{quote.quote_number}",
        reference_number=quote.quote_number,
        order_date=date_cls.today(),
        status="draft",
        total_amount=float(quote.total_amount or 0),
        sales_person=quote.sales_person,
    )
    db.add(so)
    db.flush()

    order_total = 0.0
    for line in requested_items:
        line_product_id = line.get("product_id")
        product = None
        if line_product_id:
            product = db.scalars(
                select(Product).where(
                    Product.id == line_product_id,
                    Product.tenant_id == tenant_id,
                )
            ).first()
            if not product:
                raise HTTPException(
                    status_code=404,
                    detail="Product not found or does not belong to the current tenant.",
                )
        qty = float(line.get("quantity") or 1)
        price = float(
            line.get("unit_price")
            if line.get("unit_price") is not None
            else (product.unit_price if product and product.unit_price else 0)
        )
        desc = line.get("item_description") or (product.name if product else f"Product #{line_product_id}")
        line_total = round(qty * price, 2)
        order_total += line_total
        db.add(
            SalesOrderLine(
                sales_order_id=so.id,
                product_id=line_product_id,
                item_description=desc,
                quantity=qty,
                unit=line.get("unit") or "pcs",
                unit_price=price,
                line_total=line_total,
            )
        )
    so.total_amount = round(order_total, 2)

    quote.status = "accepted"
    db.commit()
    db.refresh(so)
    return so


def list_production_orders_for_sales_order(
    db: Session, tenant_id: int, sales_order_id: int, order_number: str | None = None
) -> list:
    from app.models.production import ProductionOrder

    stmt = select(ProductionOrder).where(
        ProductionOrder.tenant_id == tenant_id,
        ProductionOrder.sales_order_id == sales_order_id,
    )
    rows = list(db.scalars(stmt).all())
    if not rows and order_number:
        rows = list(
            db.scalars(
                select(ProductionOrder).where(
                    ProductionOrder.tenant_id == tenant_id,
                    ProductionOrder.sales_order_number == order_number,
                )
            ).all()
        )
    return rows


def get_sales_order_with_items(
    db: Session, tenant_id: int, order_id: int
) -> SalesOrder | None:
    stmt = (
        select(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            selectinload(SalesOrder.line_items),
        )
        .where(SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id)
    )
    return db.scalars(stmt).first()


def _calc_gst(subtotal: float, sgst_pct: float, cgst_pct: float, igst_pct: float) -> tuple[float, float, float]:
    sgst = round(subtotal * (sgst_pct / 100), 2)
    cgst = round(subtotal * (cgst_pct / 100), 2)
    igst = round(subtotal * (igst_pct / 100), 2)
    return sgst, cgst, igst


def create_invoice(db: Session, payload: InvoiceCreate, *, commit: bool = True) -> Invoice:
    data = payload.model_dump(exclude={"items"})
    inv = Invoice(**data)
    db.add(inv)
    db.flush()
    subtotal = 0.0
    for item_data in payload.items:
        if hasattr(item_data, "model_dump"):
            item_payload = item_data.model_dump()
        elif isinstance(item_data, dict):
            item_payload = dict(item_data)
        else:
            item_payload = {"item_description": str(item_data), "qty": 0, "unit": "pcs", "rate": 0, "amount": 0}

        item = InvoiceItem(invoice_id=inv.id, **item_payload)
        db.add(item)
        subtotal += float(item.amount or 0)
    inv.subtotal = subtotal
    sgst, cgst, igst = _calc_gst(
        subtotal, inv.sgst_pct, inv.cgst_pct, inv.igst_pct
    )
    inv.sgst_amount = sgst
    inv.cgst_amount = cgst
    inv.igst_amount = igst
    inv.grand_total = round(
        subtotal - inv.discount + sgst + cgst + igst + inv.round_off, 2
    )
    if inv.status in (None, "", "draft"):
        inv.status = "issued"

    if inv.sales_order_id:
        so = db.get(SalesOrder, inv.sales_order_id)
        if so and so.tenant_id == inv.tenant_id:
            so.invoiced = True
            if so.status not in ("shipped", "delivered", "closed"):
                so.status = so.status or "invoiced"

    if commit:
        db.commit()
        db.refresh(inv)
        try:
            from app.services.alert_event_service import emit_alert

            emit_alert(
                db,
                tenant_id=inv.tenant_id,
                alert_type="invoice_generated",
                title=f"Invoice generated: {inv.invoice_number}",
                message=f"Invoice {inv.invoice_number} — ₹{float(inv.grand_total or 0):,.2f}",
                severity="medium",
                link="/sales/invoices",
                reference_type="invoice",
                reference_id=inv.id,
                created_by="Sales",
            )
        except Exception:
            pass
        try:
            from app.services.automation.events import AutomationEvent
            from app.services.automation.hooks import dispatch_automation_event_isolated

            dispatch_automation_event_isolated(inv.tenant_id, AutomationEvent.INVOICE_CREATED)
        except Exception:
            pass
    else:
        db.flush()
        db.refresh(inv)
    return inv


def get_invoice_with_items(db: Session, invoice_id: int) -> Invoice | None:
    stmt = (
        select(Invoice)
        .options(
            joinedload(Invoice.customer),
            selectinload(Invoice.items),
        )
        .where(Invoice.id == invoice_id)
    )
    return db.scalars(stmt).first()


def list_invoices(
    db: Session, tenant_id: int, status: str | None = None
) -> list[Invoice]:
    stmt = (
        select(Invoice)
        .options(joinedload(Invoice.customer), selectinload(Invoice.items))
        .where(Invoice.tenant_id == tenant_id)
    )
    if status:
        stmt = stmt.where(Invoice.status == status)
    stmt = stmt.order_by(Invoice.issue_date.desc())
    return list(db.scalars(stmt).all())


def create_payment(
    db: Session,
    payload: PaymentCreate,
    *,
    idempotency_key: str | None = None,
) -> Payment:
    from fastapi import HTTPException
    from sqlalchemy.exc import IntegrityError, SQLAlchemyError

    from app.core.concurrency import bump_entity_version
    from app.core.idempotency import find_idempotent_record, normalize_idempotency_key

    key = normalize_idempotency_key(idempotency_key or payload.idempotency_key)
    existing = find_idempotent_record(db, Payment, payload.tenant_id, key)
    if existing:
        return existing

    try:
        inv = None
        if payload.invoice_id:
            inv = db.scalars(
                select(Invoice)
                .where(
                    Invoice.id == payload.invoice_id,
                    Invoice.tenant_id == payload.tenant_id,
                )
                .with_for_update()
            ).first()
            if not inv:
                raise HTTPException(
                    status_code=404,
                    detail="Invoice not found or does not belong to the current tenant.",
                )
            grand_total = float(inv.grand_total or 0)
            amount_paid = float(inv.amount_paid or 0)
            balance = max(0.0, grand_total - amount_paid)
            pay_amount = float(payload.amount or 0)
            if pay_amount > balance + 0.009:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Payment amount exceeds invoice balance. "
                        f"Outstanding balance is {balance:.2f}."
                    ),
                )

        data = payload.model_dump()
        if key:
            data["idempotency_key"] = key
        p = Payment(**data)
        db.add(p)
        if inv:
            paid = float(inv.amount_paid or 0) + float(payload.amount or 0)
            inv.amount_paid = paid
            inv.status = "paid" if paid >= float(inv.grand_total or 0) else "partial"
            try:
                from app.services.invoice_v2_service import sync_payment_status

                sync_payment_status(inv)
            except Exception:
                inv.payment_status = inv.status if inv.status in ("paid", "partial") else "unpaid"

        from app.models.accounts import Income

        income = Income(
            tenant_id=payload.tenant_id,
            income_date=payload.payment_date,
            category="Sales Payment",
            source=inv.invoice_number if inv else "Direct Receipt",
            description=f"Payment for invoice #{inv.invoice_number}" if inv else "Direct/Advance Payment Receipt",
            amount=float(payload.amount),
        )
        db.add(income)

        if inv and inv.status == "paid" and inv.sales_order_id:
            so = db.scalars(
                select(SalesOrder)
                .where(
                    SalesOrder.id == inv.sales_order_id,
                    SalesOrder.tenant_id == payload.tenant_id,
                )
                .with_for_update()
            ).first()
            if so:
                if (so.status or "").lower() in {
                    "shipped",
                    "delivered",
                    "invoiced",
                    "confirmed",
                } or so.shipped or so.invoiced:
                    so.status = "closed"
                    bump_entity_version(so)

        db.commit()
        db.refresh(p)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        if key:
            dup = find_idempotent_record(db, Payment, payload.tenant_id, key)
            if dup:
                return dup
        logger.warning("Payment integrity conflict: %s", exc)
        raise HTTPException(
            status_code=409,
            detail="A payment with this reference or idempotency key already exists.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Database error recording payment: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to record payment due to a database error.",
        ) from exc

    try:
        from app.services.alert_event_service import emit_alert

        inv_no = inv.invoice_number if inv else (f"Receipt #{p.id}")
        emit_alert(
            db,
            tenant_id=payload.tenant_id,
            alert_type="payment_received",
            title=f"Payment received: {inv_no}",
            message=f"Payment of ₹{float(payload.amount):,.2f} recorded for {inv_no}",
            severity="low",
            link="/sales/payment-receipts",
            reference_type="payment",
            reference_id=p.id,
            created_by="Finance",
        )
        if inv and inv.status == "paid" and inv.sales_order_id:
            so = db.get(SalesOrder, inv.sales_order_id)
            if so and (so.status or "").lower() == "closed":
                emit_alert(
                    db,
                    tenant_id=payload.tenant_id,
                    alert_type="sales_order_closed",
                    title=f"Order closed: {so.order_number}",
                    message=f"Sales order {so.order_number} closed after full payment",
                    severity="low",
                    link=f"/sales/orders/{so.id}",
                    reference_type="sales_order",
                    reference_id=so.id,
                    created_by="Finance",
                )
    except Exception:
        pass
    try:
        from app.services.automation.events import AutomationEvent
        from app.services.automation.hooks import dispatch_automation_event_isolated

        dispatch_automation_event_isolated(payload.tenant_id, AutomationEvent.PAYMENT_RECEIVED)
    except Exception:
        pass
    return p


def list_payments(
    db: Session,
    tenant_id: int,
    invoice_id: int | None = None,
    *,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[Payment]:
    stmt = select(Payment).where(Payment.tenant_id == tenant_id)
    if invoice_id:
        stmt = stmt.where(Payment.invoice_id == invoice_id)
    if customer_id is not None or date_from is not None or date_to is not None:
        stmt = stmt.join(Invoice, Payment.invoice_id == Invoice.id)
        if customer_id is not None:
            stmt = stmt.where(Invoice.customer_id == customer_id)
        if date_from is not None:
            stmt = stmt.where(Payment.payment_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(Payment.payment_date <= date_to)
    stmt = stmt.order_by(Payment.payment_date.desc())
    return list(db.scalars(stmt).all())


def get_payment(db: Session, tenant_id: int, payment_id: int) -> Payment | None:
    return db.scalars(
        select(Payment).where(
            Payment.id == payment_id, Payment.tenant_id == tenant_id
        )
    ).first()


def _resync_invoice_payment(db: Session, inv: Invoice | None) -> None:
    if not inv:
        return
    try:
        from app.services.invoice_v2_service import sync_payment_status

        sync_payment_status(inv)
    except Exception:
        paid = float(inv.amount_paid or 0)
        total = float(inv.grand_total or 0)
        if paid <= 0:
            inv.status = "issued"
            inv.payment_status = "unpaid"
        elif paid >= total:
            inv.status = "paid"
            inv.payment_status = "paid"
        else:
            inv.status = "partial"
            inv.payment_status = "partial"


def update_payment(
    db: Session, tenant_id: int, payment_id: int, data: dict
) -> Payment | None:
    from fastapi import HTTPException
    from sqlalchemy.exc import SQLAlchemyError

    payment = get_payment(db, tenant_id, payment_id)
    if not payment:
        return None

    try:
        new_invoice_id = data.get("invoice_id")
        if new_invoice_id is not None:
            new_inv_check = db.scalars(
                select(Invoice).where(
                    Invoice.id == new_invoice_id,
                    Invoice.tenant_id == tenant_id,
                )
            ).first()
            if not new_inv_check:
                raise HTTPException(
                    status_code=404,
                    detail="Invoice not found or does not belong to the current tenant.",
                )

        old_inv = db.scalars(
            select(Invoice).where(
                Invoice.id == payment.invoice_id,
                Invoice.tenant_id == tenant_id,
            )
        ).first()
        old_amount = float(payment.amount or 0)
        if old_inv:
            old_inv.amount_paid = max(0.0, float(old_inv.amount_paid or 0) - old_amount)

        for key in ("invoice_id", "amount", "payment_date", "method", "notes"):
            if key in data and data[key] is not None:
                setattr(payment, key, data[key])

        new_inv = db.scalars(
            select(Invoice).where(
                Invoice.id == payment.invoice_id,
                Invoice.tenant_id == tenant_id,
            )
        ).first()
        if new_inv:
            new_inv.amount_paid = float(new_inv.amount_paid or 0) + float(payment.amount or 0)
        if old_inv and (not new_inv or old_inv.id != new_inv.id):
            _resync_invoice_payment(db, old_inv)
        if new_inv:
            _resync_invoice_payment(db, new_inv)
        db.commit()
        db.refresh(payment)
        return payment
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("update_payment failed for payment_id=%s: %s", payment_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to update payment due to a database error.",
        ) from exc


def delete_payment(db: Session, tenant_id: int, payment_id: int) -> bool:
    from fastapi import HTTPException
    from sqlalchemy.exc import SQLAlchemyError

    payment = get_payment(db, tenant_id, payment_id)
    if not payment:
        return False
    try:
        inv = db.scalars(
            select(Invoice).where(
                Invoice.id == payment.invoice_id,
                Invoice.tenant_id == tenant_id,
            )
        ).first()
        if inv:
            inv.amount_paid = max(0.0, float(inv.amount_paid or 0) - float(payment.amount or 0))
            _resync_invoice_payment(db, inv)
        db.delete(payment)
        db.commit()
        return True
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("delete_payment failed for payment_id=%s: %s", payment_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to delete payment due to a database error.",
        ) from exc


def ensure_dispatch_shipment(
    db: Session,
    tenant_id: int,
    order: SalesOrder,
    *,
    status: str = "packed",
    dispatch_number: str | None = None,
    dispatch_date: date | None = None,
    courier: str | None = None,
    vehicle_number: str | None = None,
    driver_name: str | None = None,
    lr_number: str | None = None,
    eta: date | None = None,
    tracking_url: str | None = None,
    notes: str | None = None,
    box_count: int | None = None,
    total_weight: float | None = None,
) -> DispatchShipment:
    """Create or update a DispatchShipment / delivery challan for a sales order."""
    existing = db.scalars(
        select(DispatchShipment).where(
            DispatchShipment.tenant_id == tenant_id,
            DispatchShipment.sales_order_id == order.id,
        )
    ).first()
    challan = dispatch_number or f"DC-{order.order_number}"
    if existing:
        existing.status = status
        if dispatch_number is not None:
            existing.dispatch_number = dispatch_number
        if dispatch_date is not None:
            existing.dispatch_date = dispatch_date
        if courier is not None:
            existing.courier = courier
        if vehicle_number is not None:
            existing.vehicle_number = vehicle_number
        if driver_name is not None:
            existing.driver_name = driver_name
        if lr_number is not None:
            existing.lr_number = lr_number
        if eta is not None:
            existing.eta = eta
        if tracking_url is not None:
            existing.tracking_url = tracking_url
        if notes is not None:
            existing.notes = notes
        if box_count is not None:
            existing.box_count = box_count
        if total_weight is not None:
            existing.total_weight = total_weight
        return existing

    shipment = DispatchShipment(
        tenant_id=tenant_id,
        dispatch_number=challan,
        sales_order_id=order.id,
        customer_id=order.customer_id,
        courier=courier,
        vehicle_number=vehicle_number,
        driver_name=driver_name,
        lr_number=lr_number,
        dispatch_date=dispatch_date or date.today(),
        eta=eta or getattr(order, "delivery_date", None),
        status=status,
        tracking_url=tracking_url,
        notes=notes,
        box_count=box_count,
        total_weight=total_weight,
    )
    db.add(shipment)
    db.flush()
    return shipment


def create_or_update_dispatch_shipment(
    db: Session, tenant_id: int, payload: DispatchShipmentCreate
) -> DispatchShipment:
    order = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == payload.sales_order_id,
            SalesOrder.tenant_id == tenant_id,
        )
    ).first()
    if not order:
        from fastapi import HTTPException

        raise HTTPException(404, "Sales order not found")
    order.packed = True
    shipment = ensure_dispatch_shipment(
        db,
        tenant_id,
        order,
        status=payload.status or "packed",
        dispatch_number=payload.dispatch_number,
        dispatch_date=payload.dispatch_date,
        courier=payload.courier,
        vehicle_number=payload.vehicle_number,
        driver_name=payload.driver_name,
        lr_number=payload.lr_number,
        eta=payload.eta,
        tracking_url=payload.tracking_url,
        notes=payload.notes,
        box_count=payload.box_count,
        total_weight=payload.total_weight,
    )
    db.commit()
    db.refresh(shipment)
    return shipment


def get_delivery_challan(
    db: Session, tenant_id: int, sales_order_id: int
) -> DeliveryChallanRead | None:
    order = db.scalars(
        select(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            selectinload(SalesOrder.line_items),
        )
        .where(SalesOrder.id == sales_order_id, SalesOrder.tenant_id == tenant_id)
    ).first()
    if not order:
        return None

    shipment = db.scalars(
        select(DispatchShipment).where(
            DispatchShipment.tenant_id == tenant_id,
            DispatchShipment.sales_order_id == order.id,
        )
    ).first()
    if not shipment and order.packed:
        shipment = ensure_dispatch_shipment(db, tenant_id, order, status="packed")
        db.commit()
        db.refresh(shipment)

    challan_no = shipment.dispatch_number if shipment else f"DC-{order.order_number}"
    customer = order.customer
    address_parts = []
    if customer:
        for attr in ("address_line1", "address_line2", "state", "gstin"):
            val = getattr(customer, attr, None)
            if val:
                address_parts.append(str(val))

    lines = []
    for line in order.line_items or []:
        lines.append(
            {
                "product_id": line.product_id,
                "description": line.item_description or f"Item #{line.product_id}",
                "quantity": float(line.quantity or 0),
                "unit": line.unit,
                "unit_price": float(line.unit_price or 0),
                "line_total": float(line.line_total or 0),
            }
        )

    return DeliveryChallanRead(
        challan_number=challan_no,
        dispatch_number=challan_no,
        sales_order_id=order.id,
        so_number=order.order_number,
        customer_name=customer.name if customer else None,
        customer_address=", ".join(address_parts) if address_parts else None,
        dispatch_date=(
            shipment.dispatch_date.isoformat()
            if shipment and shipment.dispatch_date
            else (order.order_date.isoformat() if order.order_date else None)
        ),
        courier=shipment.courier if shipment else None,
        vehicle_number=shipment.vehicle_number if shipment else None,
        driver_name=shipment.driver_name if shipment else None,
        lr_number=shipment.lr_number if shipment else None,
        status=shipment.status if shipment else ("packed" if order.packed else "draft"),
        lines=lines,
        total_amount=float(order.total_amount or 0),
    )


def create_lead(db: Session, payload: LeadCreate) -> Lead:
    lead = Lead(**payload.model_dump())
    db.add(lead)
    db.commit()
    db.refresh(lead)
    try:
        from app.services.automation.events import AutomationEvent
        from app.services.automation.hooks import dispatch_automation_event_isolated

        dispatch_automation_event_isolated(lead.tenant_id, AutomationEvent.LEAD_CREATED)
    except Exception:
        pass
    return lead


def list_leads(db: Session, tenant_id: int, status: str | None = None) -> list[Lead]:
    stmt = select(Lead).where(Lead.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(Lead.status == status)
    stmt = stmt.order_by(Lead.id.desc())
    return list(db.scalars(stmt).all())


def update_lead_status(
    db: Session, tenant_id: int, lead_id: int, status: str
) -> Lead | None:
    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        return None
    lead.status = status
    db.commit()
    db.refresh(lead)
    return lead


def update_lead(db: Session, tenant_id: int, lead_id: int, payload) -> Lead | None:
    from app.services.lead_form_service import assert_lead_assignee, assert_lead_product

    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        return None
    data = payload.model_dump(exclude_unset=True)
    data.pop("discussions", None)
    if "next_follow_up" in data:
        data["next_followup"] = data.pop("next_follow_up")
    if "product_id" in data:
        assert_lead_product(db, tenant_id, data["product_id"])
    if "assigned_user_id" in data:
        assert_lead_assignee(db, tenant_id, data["assigned_user_id"])
    if "status" in data and data["status"]:
        data["status"] = str(data["status"]).strip().lower()
    if "priority" in data and data["priority"]:
        data["priority"] = str(data["priority"]).strip().lower()
    for key, value in data.items():
        if hasattr(lead, key):
            setattr(lead, key, value)
    if "contact_person" in data and data["contact_person"]:
        lead.name = data["contact_person"]
    if "company_name" in data:
        lead.company = data["company_name"]
    db.commit()
    db.refresh(lead)
    return lead


def delete_lead(db: Session, tenant_id: int, lead_id: int) -> bool:
    from fastapi import HTTPException

    from app.models.sales import LeadActivity, Quotation
    from app.models.task import Task

    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        return False
    linked = db.scalars(
        select(Quotation).where(
            Quotation.tenant_id == tenant_id,
            Quotation.lead_id == lead_id,
        )
    ).first()
    if linked:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete lead: quotation {linked.quote_number} is linked.",
        )

    # Clean up lead activities and linked tasks
    activities = list(
        db.scalars(
            select(LeadActivity).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.tenant_id == tenant_id,
            )
        ).all()
    )
    for act in activities:
        db.delete(act)

    tasks = list(
        db.scalars(
            select(Task).where(
                Task.tenant_id == tenant_id,
                Task.module == "lead",
            )
        ).all()
    )
    for t in tasks:
        db.delete(t)

    db.delete(lead)
    db.commit()
    return True


def list_lead_activities(db: Session, tenant_id: int, lead_id: int) -> list[dict]:
    from fastapi import HTTPException

    from app.models.sales import Lead, LeadActivity

    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        raise HTTPException(404, "Lead not found")
    rows = list(
        db.scalars(
            select(LeadActivity)
            .where(LeadActivity.lead_id == lead_id, LeadActivity.tenant_id == tenant_id)
            .order_by(LeadActivity.id.desc())
        ).all()
    )
    return [
        {
            "id": row.id,
            "type": row.activity_type,
            "subject": row.subject,
            "user": row.user_name,
            "notes": row.notes,
            "date": row.created_at.strftime("%m/%d/%y, %I:%M %p") if row.created_at else None,
        }
        for row in rows
    ]


def create_lead_activity(
    db: Session,
    tenant_id: int,
    lead_id: int,
    payload,
    user,
) -> dict:
    from fastapi import HTTPException

    from app.models.sales import Lead, LeadActivity

    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        raise HTTPException(404, "Lead not found")
    row = LeadActivity(
        tenant_id=tenant_id,
        lead_id=lead_id,
        activity_type=(payload.type or "Call").strip(),
        subject=payload.subject.strip(),
        user_name=(payload.user or user.full_name or user.email or "Sales").strip(),
        notes=(payload.notes or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "type": row.activity_type,
        "subject": row.subject,
        "user": row.user_name,
        "notes": row.notes,
        "date": row.created_at.strftime("%m/%d/%y, %I:%M %p") if row.created_at else None,
    }


def _next_quotation_number(db: Session, tenant_id: int) -> str:
    from app.services.document_builder_service import allocate_next_quotation_number

    return allocate_next_quotation_number(db, tenant_id)


def create_quotation(db: Session, payload: QuotationCreate) -> Quotation:
    from datetime import timedelta

    data = payload.model_dump()
    tenant_id = int(data.get("tenant_id") or 0)
    customer_id = data.get("customer_id")
    customer_name = (data.get("customer_name") or "").strip() or None

    if customer_id and not customer_name:
        customer = db.scalars(
            select(Customer).where(
                Customer.id == customer_id, Customer.tenant_id == tenant_id
            )
        ).first()
        if customer:
            customer_name = customer.name

    quote_date = data.get("quote_date") or date.today()
    valid_until = data.get("valid_until")
    if valid_until is None:
        valid_until = quote_date + timedelta(days=30)

    quote_number = (data.get("quote_number") or "").strip()
    if not quote_number:
        for _ in range(10):
            candidate = _next_quotation_number(db, tenant_id)
            stmt = select(Quotation).where(
                Quotation.tenant_id == tenant_id,
                Quotation.quote_number == candidate,
            )
            if not db.scalars(stmt).first():
                quote_number = candidate
                break
        if not quote_number:
            quote_number = _next_quotation_number(db, tenant_id)

    meta_json = data.get("meta_json")
    if meta_json is not None and not isinstance(meta_json, str):
        import json as _json
        meta_json = _json.dumps(meta_json)

    quote = Quotation(
        tenant_id=tenant_id,
        quote_number=quote_number,
        customer_id=customer_id,
        lead_id=data.get("lead_id"),
        customer_name=customer_name,
        quote_date=quote_date,
        valid_until=valid_until,
        status=data.get("status") or "draft",
        total_amount=float(data.get("total_amount") or 0),
        notes=data.get("notes"),
        sales_person=data.get("sales_person"),
        discount=float(data.get("discount") or 0),
        meta_json=meta_json,
    )
    db.add(quote)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        candidate = _next_quotation_number(db, tenant_id)
        counter = 1
        while db.scalars(
            select(Quotation).where(
                Quotation.tenant_id == tenant_id,
                Quotation.quote_number == candidate,
            )
        ).first():
            candidate = f"{_next_quotation_number(db, tenant_id)}-{counter}"
            counter += 1
        quote.quote_number = candidate
        db.add(quote)
        db.commit()

    db.refresh(quote)
    try:
        from app.services.automation.events import AutomationEvent
        from app.services.automation.hooks import dispatch_automation_event_isolated

        dispatch_automation_event_isolated(quote.tenant_id, AutomationEvent.QUOTATION_CREATED)
    except Exception:
        pass
    return quote


def list_quotations(
    db: Session, tenant_id: int, status: str | None = None
) -> list[Quotation]:
    stmt = (
        select(Quotation)
        .options(joinedload(Quotation.customer), joinedload(Quotation.lead))
        .where(Quotation.tenant_id == tenant_id)
    )
    if status:
        stmt = stmt.where(Quotation.status == status)
    stmt = stmt.order_by(Quotation.quote_date.desc())
    quotes = list(db.scalars(stmt).all())
    _attach_quotation_conversion_flags(db, tenant_id, quotes)
    return quotes


def _attach_quotation_conversion_flags(
    db: Session, tenant_id: int, quotes: list[Quotation]
) -> None:
    """Expose whether an SO already exists without changing quotation status."""
    if not quotes:
        return
    references = {quote.quote_number for quote in quotes if quote.quote_number}
    converted_references = set(
        db.scalars(
            select(SalesOrder.reference_number).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.reference_number.in_(references),
            )
        ).all()
    ) if references else set()
    for quote in quotes:
        quote.converted_to_so = quote.quote_number in converted_references


def get_quotation(db: Session, tenant_id: int, quote_id: int) -> Quotation | None:
    quote = db.scalars(
        select(Quotation)
        .options(joinedload(Quotation.customer), joinedload(Quotation.lead))
        .where(Quotation.id == quote_id, Quotation.tenant_id == tenant_id)
    ).first()
    if quote:
        _attach_quotation_conversion_flags(db, tenant_id, [quote])
    return quote


def update_quotation(
    db: Session, tenant_id: int, quote_id: int, data: dict
) -> Quotation | None:
    quote = get_quotation(db, tenant_id, quote_id)
    if not quote:
        return None
    for key in (
        "customer_id",
        "customer_name",
        "quote_date",
        "valid_until",
        "status",
        "total_amount",
        "notes",
        "sales_person",
        "discount",
        "meta_json",
    ):
        if key in data and data[key] is not None:
            if key == "meta_json" and not isinstance(data[key], str):
                import json as _json
                setattr(quote, key, _json.dumps(data[key]))
            else:
                setattr(quote, key, data[key])
    db.commit()
    db.refresh(quote)
    return quote


def delete_quotation(db: Session, tenant_id: int, quote_id: int) -> bool:
    """Hard-delete quotation from database."""
    from app.models.task import Task

    quote = get_quotation(db, tenant_id, quote_id)
    if not quote:
        return False

    tasks = list(
        db.scalars(
            select(Task).where(
                Task.tenant_id == tenant_id,
                Task.module == "quotation",
            )
        ).all()
    )
    for t in tasks:
        db.delete(t)

    db.delete(quote)
    db.commit()
    return True


def update_quotation_status(
    db: Session, tenant_id: int, quote_id: int, status: str
) -> Quotation | None:
    """Enforce manufacturing sales quotation approval chain."""
    from fastapi import HTTPException

    quote = get_quotation(db, tenant_id, quote_id)
    if not quote:
        return None

    new_status = (status or "").lower().strip()
    current = (quote.status or "draft").lower().strip()
    allowed = {
        "draft": {"pending_approval", "sent", "approved", "accepted", "cancelled"},
        "pending_approval": {"approved", "rejected", "draft", "cancelled"},
        "approved": {"sent", "draft", "accepted", "cancelled"},
        "sent": {"accepted", "rejected", "expired", "cancelled", "draft"},
        "accepted": {"cancelled", "draft"},
        "rejected": {"draft", "cancelled"},
        "expired": {"draft", "cancelled"},
        "cancelled": {"draft"},
    }
    # Allow same-status no-op and admin-style free jumps only within known set
    known = set(allowed) | {"accepted", "rejected", "expired", "cancelled", "sent", "approved", "pending_approval", "draft"}
    if new_status not in known:
        raise HTTPException(400, f"Invalid quotation status '{status}'")
    if new_status != current and new_status not in allowed.get(current, known):
        raise HTTPException(
            400,
            f"Cannot move quotation from '{current}' to '{new_status}'. "
            f"Allowed: {', '.join(sorted(allowed.get(current, []))) or 'none'}",
        )

    quote.status = new_status
    db.commit()
    db.refresh(quote)
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type=f"quotation_{new_status}",
            title=f"Quotation {new_status}: {quote.quote_number}",
            message=f"Quotation {quote.quote_number} marked {new_status}",
            severity="low",
            link="/sales/quotations",
            reference_type="quotation",
            reference_id=quote.id,
            created_by="Sales",
        )
    except Exception:
        pass
    return quote


def convert_lead_to_quotation(
    db: Session,
    tenant_id: int,
    lead_id: int,
    *,
    total_amount: float | None = None,
    valid_days: int = 30,
    notes: str | None = None,
    sales_person: str | None = None,
) -> Quotation:
    """Customer enquiry (Lead) → Quotation. Creates/links Customer when needed."""
    from datetime import timedelta

    from fastapi import HTTPException

    lead = db.scalars(
        select(Lead).where(Lead.id == lead_id, Lead.tenant_id == tenant_id)
    ).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    existing = db.scalars(
        select(Quotation).where(
            Quotation.tenant_id == tenant_id,
            Quotation.lead_id == lead.id,
            Quotation.status.not_in(["cancelled", "rejected", "lost"]),
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Lead already has quotation {existing.quote_number}",
        )

    customer = None
    if lead.company or lead.email:
        customer = db.scalars(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.name == (lead.company or lead.name),
            )
        ).first()
        if not customer:
            customer = Customer(
                tenant_id=tenant_id,
                name=lead.company or lead.name,
                contact_name=lead.name,
                email=lead.email,
                phone=lead.phone,
                status="active",
            )
            db.add(customer)
            db.flush()

    ts = date.today().strftime("%Y%m%d")
    quote = Quotation(
        tenant_id=tenant_id,
        quote_number=f"QT-L{lead.id}-{ts}",
        customer_id=customer.id if customer else None,
        lead_id=lead.id,
        customer_name=(customer.name if customer else None) or lead.company or lead.name,
        quote_date=date.today(),
        valid_until=date.today() + timedelta(days=max(1, int(valid_days or 30))),
        status="draft",
        total_amount=float(
            total_amount
            if total_amount is not None
            else (lead.opportunity_value or 0)
        ),
        notes=notes or lead.notes,
        sales_person=sales_person or lead.sales_executive,
        discount=0,
    )
    db.add(quote)
    lead.status = "converted"
    db.commit()
    db.refresh(quote)

    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="quotation_created",
            title=f"Quotation created from lead: {quote.quote_number}",
            message=f"Lead '{lead.name}' converted to quotation {quote.quote_number}",
            severity="low",
            link="/sales/quotations",
            reference_type="quotation",
            reference_id=quote.id,
            created_by="Sales",
        )
    except Exception:
        pass

    return quote


def update_sales_order_dispatch(
    db: Session,
    tenant_id: int,
    order_id: int,
    packed: bool | None = None,
    shipped: bool | None = None,
) -> SalesOrder | None:
    from fastapi import HTTPException

    order = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not order:
        return None

    becoming_shipped = shipped is True and not order.shipped
    becoming_packed = packed is True and not order.packed

    if becoming_packed or (packed is True):
        # Packing gate: Final QC should be ready (or already passed)
        from app.services.manufacturing_workflow_service import (
            sales_order_has_final_qc_pass,
        )

        lines = list(
            db.scalars(
                select(SalesOrderLine).where(SalesOrderLine.sales_order_id == order.id)
            ).all()
        )
        if any(l.product_id for l in lines) and not sales_order_has_final_qc_pass(
            db, tenant_id, order
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Final QC must pass before packing. "
                    "Complete Final Product Inspection first."
                ),
            )
        order.packed = True
        ensure_dispatch_shipment(db, tenant_id, order, status="packed")
        db.flush()

    if becoming_shipped:
        if not order.packed and packed is not True:
            raise HTTPException(
                status_code=400,
                detail="Packing verification required before dispatch. Mark packed first.",
            )
        order.packed = True
        db.flush()
        from app.services.manufacturing_workflow_service import ship_sales_order_stock_out

        ship_sales_order_stock_out(db, tenant_id, order.id)
        # ship_sales_order_stock_out commits; refresh and mark shipment in transit
        order = db.scalars(
            select(SalesOrder).where(
                SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id
            )
        ).first()
        if order:
            ensure_dispatch_shipment(db, tenant_id, order, status="in_transit")
            db.commit()
            db.refresh(order)
        return order

    if packed is not None:
        order.packed = packed
    if shipped is not None:
        order.shipped = shipped
    db.commit()
    db.refresh(order)
    return order


def confirm_delivery(
    db: Session,
    tenant_id: int,
    order_id: int,
) -> SalesOrder | None:
    """Mark shipment delivered and advance SO toward closure."""
    order = db.scalars(
        select(SalesOrder).where(
            SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id
        )
    ).first()
    if not order:
        return None
    if not order.shipped:
        from fastapi import HTTPException

        raise HTTPException(400, "Order must be shipped before delivery confirmation")
    order.status = "delivered"
    ensure_dispatch_shipment(db, tenant_id, order, status="delivered")
    db.commit()
    db.refresh(order)
    try:
        from app.services.alert_event_service import emit_alert

        emit_alert(
            db,
            tenant_id=tenant_id,
            alert_type="delivery_confirmed",
            title=f"Delivery confirmed: {order.order_number}",
            message=f"Customer delivery confirmed for {order.order_number}",
            severity="low",
            link=f"/sales/orders/{order.id}",
            reference_type="sales_order",
            reference_id=order.id,
            created_by="Dispatch",
        )
    except Exception:
        pass
    return order
