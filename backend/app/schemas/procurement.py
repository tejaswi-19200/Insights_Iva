from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

VALID_QC_RESULTS = frozenset({"pass", "passed", "fail", "failed", "reject", "rejected"})


class PurchaseOrderLineBase(BaseModel):
    item_id: int = Field(..., ge=1)
    quantity: float = Field(..., ge=0.0)
    unit_price: float | None = Field(None, ge=0.0)
    line_total: float | None = Field(None, ge=0.0)


class PurchaseOrderLineCreate(PurchaseOrderLineBase):
    pass


class PurchaseOrderLineRead(PurchaseOrderLineBase):
    id: int
    purchase_order_id: int
    item_name: str | None = None
    item_sku: str | None = None
    item_unit: str | None = None
    received_quantity: float = 0
    remaining_quantity: float = 0
    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderBase(BaseModel):
    tenant_id: int = Field(..., ge=1)
    supplier_id: int = Field(..., ge=1)
    po_number: str
    order_date: date
    expected_date: date | None = None
    status: str = "draft"
    total_amount: float | None = Field(None, ge=0.0)
    notes: str | None = None
    material_request_id: int | None = Field(None, ge=1)


class PurchaseOrderCreate(PurchaseOrderBase):
    line_items: list[PurchaseOrderLineCreate] = []


class PurchaseOrderUpdate(BaseModel):
    supplier_id: int | None = Field(None, ge=1)
    po_number: str | None = None
    order_date: date | None = None
    expected_date: date | None = None
    status: str | None = None
    total_amount: float | None = Field(None, ge=0.0)
    notes: str | None = None
    line_items: list[PurchaseOrderLineCreate] | None = None


class EntityAttachmentRead(BaseModel):
    attachment_id: int
    id: int
    filename: str
    mime_type: str | None = None
    file_size: int = 0
    upload_status: str | None = None
    label: str | None = None
    created_at: str | None = None


class PurchaseOrderSupplierRead(BaseModel):
    id: int
    name: str | None = None
    email: str | None = None
    gstin: str | None = None
    address: str | None = None
    state: str | None = None
    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderRead(PurchaseOrderBase):
    id: int
    line_items: list[PurchaseOrderLineRead] = []
    attachments: list[EntityAttachmentRead] = []
    supplier: PurchaseOrderSupplierRead | None = None
    model_config = ConfigDict(from_attributes=True)


class MaterialRequestConvertToPORequest(BaseModel):
    """Convert an MRP-driven material request into a purchase order."""

    supplier_id: int = Field(..., ge=1)
    expected_date: date | None = None
    notes: str | None = None
    unit_price: float | None = Field(None, ge=0.0)
    line_item_prices: dict[int, float] | None = None
    po_number: str | None = None
    status: str = "draft"


class PurchaseOrderListRead(PurchaseOrderRead):
    supplier_name: str | None = None


class MaterialRequestLineBase(BaseModel):
    item_id: int = Field(..., ge=1)
    quantity: float = Field(..., ge=0.0)
    notes: str | None = None


class MaterialRequestLineCreate(MaterialRequestLineBase):
    pass


class MaterialRequestLineRead(MaterialRequestLineBase):
    id: int
    material_request_id: int
    item_name: str | None = None
    item_sku: str | None = None
    item_unit: str | None = None
    item_unit_cost: float | None = None
    model_config = ConfigDict(from_attributes=True)


class MaterialRequestBase(BaseModel):
    tenant_id: int
    mr_number: str
    request_date: date
    required_date: date | None = None
    requested_by: str | None = None
    status: str = "pending"
    notes: str | None = None


class MaterialRequestCreate(MaterialRequestBase):
    line_items: list[MaterialRequestLineCreate] = []


class MaterialRequestUpdate(BaseModel):
    mr_number: str | None = None
    request_date: date | None = None
    required_date: date | None = None
    requested_by: str | None = None
    status: str | None = None
    notes: str | None = None
    line_items: list[MaterialRequestLineCreate] | None = None


class MaterialRequestRead(MaterialRequestBase):
    id: int
    line_items: list[MaterialRequestLineRead] = []
    model_config = ConfigDict(from_attributes=True)


class GoodsReceiptLineBase(BaseModel):
    item_id: int = Field(..., ge=1)
    quantity_received: float = Field(..., ge=0.0)
    quantity_rejected: float = Field(0.0, ge=0.0)


class GoodsReceiptLineCreate(GoodsReceiptLineBase):
    pass


class GoodsReceiptLineRead(GoodsReceiptLineBase):
    id: int
    goods_receipt_id: int
    model_config = ConfigDict(from_attributes=True)


class GoodsReceiptBase(BaseModel):
    tenant_id: int
    purchase_order_id: int | None = None
    grn_number: str
    receipt_date: date
    warehouse_id: int
    received_by: str | None = None
    status: str = "received"
    qc_status: str = "pending"
    notes: str | None = None


class GoodsReceiptCreate(GoodsReceiptBase):
    line_items: list[GoodsReceiptLineCreate] = []


class GoodsReceiptUpdate(BaseModel):
    received_by: str | None = None
    notes: str | None = None


class GoodsReceiptRead(GoodsReceiptBase):
    id: int
    line_items: list[GoodsReceiptLineRead] = []
    model_config = ConfigDict(from_attributes=True)


class GoodsReceiptQCRequest(BaseModel):
    """Pass/fail incoming QC. Pass posts accepted qty into inventory."""

    result: str  # pass | fail
    notes: str | None = None

    @field_validator("result")
    @classmethod
    def validate_qc_result(cls, value: str) -> str:
        res = (value or "").strip().lower()
        if res not in VALID_QC_RESULTS:
            raise ValueError("QC result must be pass or fail")
        if res in ("passed", "pass"):
            return "pass"
        if res in ("failed", "fail", "reject", "rejected"):
            return "fail"
        return res


class SupplierPaymentBase(BaseModel):
    tenant_id: int = Field(..., ge=1)
    supplier_id: int = Field(..., ge=1)
    payment_date: date
    amount: float = Field(..., ge=0.0)
    payment_method: str = "bank"
    reference: str | None = None
    notes: str | None = None
    idempotency_key: str | None = Field(None, max_length=128)


class SupplierPaymentCreate(SupplierPaymentBase):
    pass


class SupplierPaymentUpdate(BaseModel):
    supplier_id: int | None = Field(None, ge=1)
    payment_date: date | None = None
    amount: float | None = Field(None, ge=0.0)
    payment_method: str | None = None
    reference: str | None = None
    notes: str | None = None


class SupplierPaymentRead(SupplierPaymentBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
