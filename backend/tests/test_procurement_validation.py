from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.procurement import (
    GoodsReceiptLineCreate,
    GoodsReceiptQCRequest,
    MaterialRequestLineCreate,
    PurchaseOrderBase,
    PurchaseOrderLineCreate,
    PurchaseOrderSupplierRead,
    SupplierPaymentCreate,
    SupplierPaymentUpdate,
)
from app.schemas.procurement_extended import (
    ProcurementHubRead,
    VendorBillCreate,
    VendorBillStatusUpdate,
    VendorQuotationCreate,
)


def test_vendor_quotation_create_negative_price_rejected():
    """Negative quotation price raises ValidationError."""
    invalid_prices = [-100.0, -0.01, -50]
    for price in invalid_prices:
        with pytest.raises(ValidationError) as exc_info:
            VendorQuotationCreate(supplier_id=1, price=price)
        assert any(err["loc"] == ("price",) for err in exc_info.value.errors())


def test_vendor_quotation_create_valid_price():
    """Zero or positive quotation price passes validation."""
    req1 = VendorQuotationCreate(supplier_id=1, price=0.0)
    assert req1.price == 0.0

    req2 = VendorQuotationCreate(supplier_id=1, price=250.75)
    assert req2.price == 250.75


def test_vendor_bill_create_negative_amount_rejected():
    """Negative vendor bill amount (e.g. amount=-5000) raises ValidationError."""
    invalid_amounts = [-5000.0, -50.0, -0.01]
    for amount in invalid_amounts:
        with pytest.raises(ValidationError) as exc_info:
            VendorBillCreate(supplier_id=1, amount=amount)
        assert any(err["loc"] == ("amount",) for err in exc_info.value.errors())


def test_vendor_bill_create_valid_amount():
    """Zero or positive vendor bill amount passes validation."""
    req1 = VendorBillCreate(supplier_id=1, amount=0.0)
    assert req1.amount == 0.0

    req2 = VendorBillCreate(supplier_id=1, amount=5000.0)
    assert req2.amount == 5000.0


def test_vendor_bill_status_update_validation():
    """Vendor bill status update validates supported statuses."""
    with pytest.raises(ValidationError) as exc_info:
        VendorBillStatusUpdate(status="invalid_status")
    assert any(err["loc"] == ("status",) for err in exc_info.value.errors())

    for status in ("pending", "approved", "paid", "rejected", "overdue", "cancelled"):
        req = VendorBillStatusUpdate(status=status)
        assert req.status == status


def test_procurement_hub_read_independent_list_defaults():
    """Each ProcurementHubRead instance has its own independent list instances for defaults."""
    hub1 = ProcurementHubRead()
    hub2 = ProcurementHubRead()

    assert hub1.top_vendors is not hub2.top_vendors
    assert hub1.pending_orders is not hub2.pending_orders
    assert hub1.alerts is not hub2.alerts

    hub1.top_vendors.append({"name": "Vendor A"})
    hub1.pending_orders.append({"id": 1})
    hub1.alerts.append({"message": "Alert 1"})

    assert len(hub1.top_vendors) == 1
    assert len(hub2.top_vendors) == 0

    assert len(hub1.pending_orders) == 1
    assert len(hub2.pending_orders) == 0

    assert len(hub1.alerts) == 1
    assert len(hub2.alerts) == 0


def test_vendor_quotation_create_negative_delivery_days_rejected():
    """Negative delivery_days (e.g. delivery_days=-5) raises ValidationError."""
    invalid_delivery_days = [-5, -1, -100]
    for d in invalid_delivery_days:
        with pytest.raises(ValidationError) as exc_info:
            VendorQuotationCreate(supplier_id=1, price=100.0, delivery_days=d)
        assert any(err["loc"] == ("delivery_days",) for err in exc_info.value.errors())


def test_vendor_quotation_create_valid_delivery_days():
    """Zero or positive delivery_days passes validation."""
    req1 = VendorQuotationCreate(supplier_id=1, price=100.0, delivery_days=0)
    assert req1.delivery_days == 0

    req2 = VendorQuotationCreate(supplier_id=1, price=100.0, delivery_days=14)
    assert req2.delivery_days == 14


def test_vendor_quotation_create_invalid_gst_pct_rejected():
    """GST percentage outside [0, 100] (e.g. gst_pct=-10 or gst_pct=150) raises ValidationError."""
    invalid_gst_pcts = [-10.0, -0.1, 100.1, 150.0]
    for gst in invalid_gst_pcts:
        with pytest.raises(ValidationError) as exc_info:
            VendorQuotationCreate(supplier_id=1, price=100.0, gst_pct=gst)
        assert any(err["loc"] == ("gst_pct",) for err in exc_info.value.errors())


def test_vendor_quotation_create_valid_gst_pct():
    """GST percentage within [0, 100] passes validation."""
    for valid_gst in (0.0, 5.0, 12.0, 18.0, 28.0, 100.0):
        req = VendorQuotationCreate(supplier_id=1, price=100.0, gst_pct=valid_gst)
        assert req.gst_pct == valid_gst


def test_vendor_bill_create_negative_gst_amount_rejected():
    """Negative GST amount (e.g. gst_amount=-500) raises ValidationError."""
    invalid_gst_amounts = [-500.0, -50.0, -0.01]
    for gst in invalid_gst_amounts:
        with pytest.raises(ValidationError) as exc_info:
            VendorBillCreate(supplier_id=1, amount=1000.0, gst_amount=gst)
        assert any(err["loc"] == ("gst_amount",) for err in exc_info.value.errors())


def test_vendor_bill_create_valid_gst_amount():
    """Zero or positive GST amount passes validation."""
    req1 = VendorBillCreate(supplier_id=1, amount=1000.0, gst_amount=0.0)
    assert req1.gst_amount == 0.0

    req2 = VendorBillCreate(supplier_id=1, amount=1000.0, gst_amount=180.0)
    assert req2.gst_amount == 180.0


def test_purchase_order_line_create_negative_quantity_rejected():
    """Negative quantity (e.g. quantity=-10) raises ValidationError."""
    invalid_quantities = [-10.0, -1.0, -0.01]
    for q in invalid_quantities:
        with pytest.raises(ValidationError) as exc_info:
            PurchaseOrderLineCreate(item_id=1, quantity=q)
        assert any(err["loc"] == ("quantity",) for err in exc_info.value.errors())


def test_purchase_order_line_create_valid_quantity():
    """Zero or positive quantity passes validation."""
    line1 = PurchaseOrderLineCreate(item_id=1, quantity=0.0)
    assert line1.quantity == 0.0

    line2 = PurchaseOrderLineCreate(item_id=1, quantity=50.0)
    assert line2.quantity == 50.0


def test_purchase_order_supplier_read_accepts_orm_attributes():
    supplier = SimpleNamespace(id=1, name="ABC Industrial Supplies Pvt Ltd")

    result = PurchaseOrderSupplierRead.model_validate(supplier)

    assert result.id == 1
    assert result.name == "ABC Industrial Supplies Pvt Ltd"
    assert result.email is None


def test_purchase_order_line_create_negative_unit_price_rejected():
    """Negative unit_price (e.g. unit_price=-500) raises ValidationError."""
    invalid_prices = [-500.0, -1.0, -0.01]
    for price in invalid_prices:
        with pytest.raises(ValidationError) as exc_info:
            PurchaseOrderLineCreate(item_id=1, quantity=10.0, unit_price=price)
        assert any(err["loc"] == ("unit_price",) for err in exc_info.value.errors())


def test_purchase_order_line_create_valid_unit_price():
    """Zero or positive unit_price passes validation."""
    line1 = PurchaseOrderLineCreate(item_id=1, quantity=10.0, unit_price=0.0)
    assert line1.unit_price == 0.0

    line2 = PurchaseOrderLineCreate(item_id=1, quantity=10.0, unit_price=500.0)
    assert line2.unit_price == 500.0


def test_purchase_order_base_negative_total_amount_rejected():
    """Negative total_amount (e.g. total_amount=-1000) raises ValidationError."""
    invalid_totals = [-1000.0, -100.0, -0.01]
    for total in invalid_totals:
        with pytest.raises(ValidationError) as exc_info:
            PurchaseOrderBase(
                tenant_id=1,
                supplier_id=1,
                po_number="PO-001",
                order_date=date.today(),
                total_amount=total,
            )
        assert any(err["loc"] == ("total_amount",) for err in exc_info.value.errors())


def test_purchase_order_base_valid_total_amount():
    """Zero or positive total_amount passes validation."""
    po1 = PurchaseOrderBase(
        tenant_id=1,
        supplier_id=1,
        po_number="PO-001",
        order_date=date.today(),
        total_amount=0.0,
    )
    assert po1.total_amount == 0.0

    po2 = PurchaseOrderBase(
        tenant_id=1,
        supplier_id=1,
        po_number="PO-002",
        order_date=date.today(),
        total_amount=1000.0,
    )
    assert po2.total_amount == 1000.0


def test_goods_receipt_line_create_negative_received_quantity_rejected():
    """Negative quantity_received (e.g. quantity_received=-5) raises ValidationError."""
    invalid_quantities = [-5.0, -1.0, -0.01]
    for q in invalid_quantities:
        with pytest.raises(ValidationError) as exc_info:
            GoodsReceiptLineCreate(item_id=1, quantity_received=q)
        assert any(err["loc"] == ("quantity_received",) for err in exc_info.value.errors())


def test_goods_receipt_line_create_valid_received_quantity():
    """Zero or positive quantity_received passes validation."""
    grn_line1 = GoodsReceiptLineCreate(item_id=1, quantity_received=0.0)
    assert grn_line1.quantity_received == 0.0

    grn_line2 = GoodsReceiptLineCreate(item_id=1, quantity_received=100.0)
    assert grn_line2.quantity_received == 100.0


def test_goods_receipt_qc_request_invalid_result_rejected():
    """Arbitrary result like 'invalid' raises ValidationError."""
    invalid_results = ["invalid", "unknown", "maybe", "123", ""]
    for res in invalid_results:
        with pytest.raises(ValidationError) as exc_info:
            GoodsReceiptQCRequest(result=res)
        assert any(err["loc"] == ("result",) for err in exc_info.value.errors())


def test_goods_receipt_qc_request_valid_result():
    """Valid pass or fail QC results pass validation."""
    req1 = GoodsReceiptQCRequest(result="pass")
    assert req1.result == "pass"

    req2 = GoodsReceiptQCRequest(result="fail")
    assert req2.result == "fail"


def test_supplier_payment_create_negative_amount_rejected():
    """Negative supplier payment amount (e.g. amount=-5000) raises ValidationError."""
    invalid_amounts = [-5000.0, -100.0, -0.01]
    for amount in invalid_amounts:
        with pytest.raises(ValidationError) as exc_info:
            SupplierPaymentCreate(
                tenant_id=1,
                supplier_id=1,
                payment_date=date.today(),
                amount=amount,
            )
        assert any(err["loc"] == ("amount",) for err in exc_info.value.errors())


def test_supplier_payment_create_valid_amount():
    """Zero or positive supplier payment amount passes validation."""
    sp1 = SupplierPaymentCreate(
        tenant_id=1,
        supplier_id=1,
        payment_date=date.today(),
        amount=0.0,
    )
    assert sp1.amount == 0.0

    sp2 = SupplierPaymentCreate(
        tenant_id=1,
        supplier_id=1,
        payment_date=date.today(),
        amount=5000.0,
    )
    assert sp2.amount == 5000.0


def test_material_request_line_create_negative_quantity_rejected():
    """Negative quantity (e.g. quantity=-5) raises ValidationError."""
    invalid_quantities = [-5.0, -1.0, -0.01]
    for q in invalid_quantities:
        with pytest.raises(ValidationError) as exc_info:
            MaterialRequestLineCreate(item_id=1, quantity=q)
        assert any(err["loc"] == ("quantity",) for err in exc_info.value.errors())


def test_material_request_line_create_valid_quantity():
    """Zero or positive quantity passes validation."""
    mr_line1 = MaterialRequestLineCreate(item_id=1, quantity=0.0)
    assert mr_line1.quantity == 0.0

    mr_line2 = MaterialRequestLineCreate(item_id=1, quantity=25.0)
    assert mr_line2.quantity == 25.0


def test_goods_receipt_line_create_negative_rejected_quantity_rejected():
    """Negative quantity_rejected (e.g. quantity_rejected=-2) raises ValidationError."""
    invalid_quantities = [-2.0, -1.0, -0.01]
    for q in invalid_quantities:
        with pytest.raises(ValidationError) as exc_info:
            GoodsReceiptLineCreate(item_id=1, quantity_received=10.0, quantity_rejected=q)
        assert any(err["loc"] == ("quantity_rejected",) for err in exc_info.value.errors())


def test_goods_receipt_line_create_valid_rejected_quantity():
    """Zero or positive quantity_rejected passes validation."""
    grn_line1 = GoodsReceiptLineCreate(item_id=1, quantity_received=10.0, quantity_rejected=0.0)
    assert grn_line1.quantity_rejected == 0.0

    grn_line2 = GoodsReceiptLineCreate(item_id=1, quantity_received=10.0, quantity_rejected=2.0)
    assert grn_line2.quantity_rejected == 2.0


def test_supplier_payment_create_negative_supplier_id_rejected():
    """Non-positive supplier_id (e.g. supplier_id=-1 or 0) raises ValidationError."""
    invalid_ids = [-1, 0, -100]
    for s_id in invalid_ids:
        with pytest.raises(ValidationError) as exc_info:
            SupplierPaymentCreate(
                tenant_id=1,
                supplier_id=s_id,
                payment_date=date.today(),
                amount=100.0,
            )
        assert any(err["loc"] == ("supplier_id",) for err in exc_info.value.errors())


def test_supplier_payment_create_valid_supplier_id():
    """Positive supplier_id passes validation."""
    sp = SupplierPaymentCreate(
        tenant_id=1,
        supplier_id=1,
        payment_date=date.today(),
        amount=100.0,
    )
    assert sp.supplier_id == 1


def test_purchase_order_negative_supplier_or_item_id_rejected():
    """Non-positive supplier_id or item_id (e.g. -1 or 0) raises ValidationError."""
    invalid_ids = [-1, 0, -100]
    for s_id in invalid_ids:
        with pytest.raises(ValidationError) as exc_info:
            PurchaseOrderBase(
                tenant_id=1,
                supplier_id=s_id,
                po_number="PO-001",
                order_date=date.today(),
            )
        assert any(err["loc"] == ("supplier_id",) for err in exc_info.value.errors())

    for i_id in invalid_ids:
        with pytest.raises(ValidationError) as exc_info:
            PurchaseOrderLineCreate(item_id=i_id, quantity=10.0)
        assert any(err["loc"] == ("item_id",) for err in exc_info.value.errors())


def test_purchase_order_valid_supplier_and_item_id():
    """Positive supplier_id and item_id pass validation."""
    po = PurchaseOrderBase(
        tenant_id=1,
        supplier_id=1,
        po_number="PO-001",
        order_date=date.today(),
    )
    assert po.supplier_id == 1

    line = PurchaseOrderLineCreate(item_id=1, quantity=10.0)
    assert line.item_id == 1


def test_supplier_payment_update_negative_amount_rejected():
    """Negative supplier payment update amount (e.g. amount=-5000) raises ValidationError."""
    invalid_amounts = [-5000.0, -100.0, -0.01]
    for amount in invalid_amounts:
        with pytest.raises(ValidationError) as exc_info:
            SupplierPaymentUpdate(amount=amount)
        assert any(err["loc"] == ("amount",) for err in exc_info.value.errors())


def test_supplier_payment_update_valid_amount():
    """Zero or positive supplier payment update amount passes validation."""
    sp1 = SupplierPaymentUpdate(amount=0.0)
    assert sp1.amount == 0.0

    sp2 = SupplierPaymentUpdate(amount=5000.0)
    assert sp2.amount == 5000.0
