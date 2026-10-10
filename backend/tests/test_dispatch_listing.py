from datetime import date
from uuid import uuid4

from app.core.database import SessionLocal
from app.models.sales import Customer, DispatchShipment, SalesOrder
from app.services.sales_extended_service import get_dispatch_summary, list_dispatch_enriched


def test_dispatch_list_includes_ready_orders_with_and_without_other_dispatches(register_admin):
    admin = register_admin()
    tenant_id = admin["user"]["tenant_id"]
    suffix = uuid4().hex[:8]
    db = SessionLocal()
    try:
        customer = Customer(
            tenant_id=tenant_id,
            name=f"Dispatch Test Customer {suffix}",
            status="active",
        )
        db.add(customer)
        db.flush()

        ready_order = SalesOrder(
            tenant_id=tenant_id,
            customer_id=customer.id,
            order_number=f"SO-READY-{suffix}",
            order_date=date.today(),
            status="confirmed",
        )
        packed_order = SalesOrder(
            tenant_id=tenant_id,
            customer_id=customer.id,
            order_number=f"SO-PACKED-{suffix}",
            order_date=date.today(),
            status="confirmed",
            packed=True,
        )
        dispatched_order = SalesOrder(
            tenant_id=tenant_id,
            customer_id=customer.id,
            order_number=f"SO-DISPATCHED-{suffix}",
            order_date=date.today(),
            status="confirmed",
            packed=True,
        )
        db.add_all([ready_order, packed_order, dispatched_order])
        db.flush()
        db.add(
            DispatchShipment(
                tenant_id=tenant_id,
                dispatch_number=f"DC-{dispatched_order.order_number}",
                sales_order_id=dispatched_order.id,
                customer_id=customer.id,
                dispatch_date=date.today(),
                status="packed",
            )
        )
        db.commit()

        summary = get_dispatch_summary(db, tenant_id)
        rows = list_dispatch_enriched(db, tenant_id)

        assert summary.ready_to_dispatch == 1
        assert any(row.so_number == ready_order.order_number and row.status == "ready" for row in rows)
        assert any(row.so_number == packed_order.order_number and row.packed for row in rows)
        assert sum(row.so_number == dispatched_order.order_number for row in rows) == 1
    finally:
        db.close()
