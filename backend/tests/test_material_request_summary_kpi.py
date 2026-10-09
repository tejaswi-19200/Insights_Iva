"""Material request KPI counts align with conversion rules."""

from datetime import date

from app.core.database import SessionLocal
from app.models.inventory import Supplier
from app.models.procurement import MaterialRequest, PurchaseOrder
from app.services.procurement_extended_service import get_mr_summary, list_mr_enriched
from app.services.procurement_service import approve_material_request


def test_converted_count_uses_purchase_order_link(register_admin):
    admin = register_admin()
    tenant_id = admin["user"]["tenant_id"]

    db = SessionLocal()
    try:
        supplier = Supplier(tenant_id=tenant_id, name="KPI Vendor")
        db.add(supplier)
        db.flush()
        mr = MaterialRequest(
            tenant_id=tenant_id,
            mr_number="MR-KPI-1",
            request_date=date.today(),
            requested_by="Store",
            status="approved",
            approval_status="approved",
        )
        db.add(mr)
        db.flush()
        po = PurchaseOrder(
            tenant_id=tenant_id,
            supplier_id=supplier.id,
            po_number="PO-KPI-1",
            order_date=date.today(),
            status="draft",
            material_request_id=mr.id,
        )
        db.add(po)
        db.commit()

        summary = get_mr_summary(db, tenant_id)
        enriched = list_mr_enriched(db, tenant_id)
        converted_rows = [r for r in enriched if r.converted_to_po]
        assert summary.converted_to_rfq == len(converted_rows)
        assert summary.converted_to_rfq >= 1
    finally:
        db.close()


def test_approving_material_request_updates_status_and_approval(register_admin):
    admin = register_admin()
    tenant_id = admin["user"]["tenant_id"]

    db = SessionLocal()
    try:
        mr = MaterialRequest(
            tenant_id=tenant_id,
            mr_number="MR-APPROVAL-STATUS",
            request_date=date.today(),
            requested_by="Store",
            status="submitted",
            approval_status="pending",
        )
        db.add(mr)
        db.commit()
        mr_id = mr.id

        approved = approve_material_request(db, tenant_id, mr_id, approved=True)

        assert approved.status == "approved"
        assert approved.approval_status == "approved"
    finally:
        db.close()
