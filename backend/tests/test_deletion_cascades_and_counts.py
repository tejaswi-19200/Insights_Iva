import uuid
import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.tenant import Tenant
from app.models.sales import Lead, LeadActivity
from app.models.product import Product, InventoryCategory
from app.models.inventory import InventoryItem, Supplier
from app.models.product_vendor_pricing import ProductVendorPricing
from app.models.procurement import RFQ, VendorQuotation
from app.models.task import Task
from app.services.sales_service import delete_lead
from app.services.product_service import delete_product
from app.services.inventory_v2_service import delete_category
from app.services.procurement_extended_service import delete_rfq


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tenant(db):
    uid = uuid.uuid4().hex[:6]
    t = Tenant(name=f"Tenant-{uid}", slug=f"tenant-{uid}")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def test_delete_lead_removes_activities_and_tasks(db, tenant):
    tenant_id = tenant.id
    lead = Lead(tenant_id=tenant_id, name="Test Lead", company="Test Co")
    db.add(lead)
    db.commit()

    activity = LeadActivity(tenant_id=tenant_id, lead_id=lead.id, activity_type="call", subject="Called lead", notes="Called lead")
    task = Task(tenant_id=tenant_id, title="Follow up lead", module="lead")
    db.add_all([activity, task])
    db.commit()

    success = delete_lead(db, tenant_id, lead.id)
    assert success is True

    # Verify lead and activity are deleted
    assert db.get(Lead, lead.id) is None
    assert db.get(LeadActivity, activity.id) is None


def test_delete_category_unlinks_products(db, tenant):
    tenant_id = tenant.id
    cat = InventoryCategory(tenant_id=tenant_id, name="Electronics")
    db.add(cat)
    db.commit()

    prod = Product(tenant_id=tenant_id, name="Smart Widget", category="Electronics", sku=f"WIDGET-{uuid.uuid4().hex[:4]}")
    db.add(prod)
    db.commit()

    success = delete_category(db, tenant_id, cat.id)
    assert success is True

    db.refresh(prod)
    assert prod.category is None


def test_delete_product_cleans_pricing(db, tenant):
    tenant_id = tenant.id
    supp = Supplier(tenant_id=tenant_id, name=f"Supplier-{uuid.uuid4().hex[:4]}")
    db.add(supp)
    db.commit()

    prod = Product(tenant_id=tenant_id, name="Base Component", sku=f"COMP-{uuid.uuid4().hex[:4]}")
    db.add(prod)
    db.commit()

    pvp = ProductVendorPricing(tenant_id=tenant_id, product_id=prod.id, supplier_id=supp.id, purchase_price=45.0)
    db.add(pvp)
    db.commit()

    success = delete_product(db, tenant_id, prod.id)
    assert success is True

    assert db.get(Product, prod.id) is None
    assert db.get(ProductVendorPricing, pvp.id) is None


def test_delete_rfq_cleans_quotations(db, tenant):
    tenant_id = tenant.id
    supp = Supplier(tenant_id=tenant_id, name=f"Supplier-{uuid.uuid4().hex[:4]}")
    db.add(supp)
    db.commit()

    rfq = RFQ(tenant_id=tenant_id, rfq_number=f"RFQ-{uuid.uuid4().hex[:4]}")
    db.add(rfq)
    db.commit()

    vq = VendorQuotation(tenant_id=tenant_id, rfq_id=rfq.id, supplier_id=supp.id, price=500.0)
    db.add(vq)
    db.commit()

    success = delete_rfq(db, tenant_id, rfq.id)
    assert success is True

    assert db.get(RFQ, rfq.id) is None
    assert db.get(VendorQuotation, vq.id) is None
