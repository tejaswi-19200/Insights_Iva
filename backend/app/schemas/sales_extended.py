from datetime import date

from pydantic import BaseModel, Field, field_validator


class LeadSummaryRead(BaseModel):
    total_leads: int = 0
    new_leads: int = 0
    qualified_leads: int = 0
    won_customers: int = 0
    lost_leads: int = 0
    conversion_rate: float = 0


class LeadListRead(BaseModel):
    id: int
    lead_id: str
    customer_name: str
    company: str | None = None
    contact: str | None = None
    source: str | None = None
    sales_executive: str | None = None
    priority: str = "medium"
    next_followup: str | None = None
    status: str = "new"
    opportunity_value: float | None = Field(None, ge=0.0)
    industry: str | None = None
    region: str | None = None
    quotation_id: int | None = None
    quotation_number: str | None = None

    @field_validator("opportunity_value", mode="before")
    @classmethod
    def validate_opportunity_value(cls, value: float | None) -> float | None:
        if value is None:
            return value
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("opportunity_value must be a numeric value")
        if v < 0:
            raise ValueError("opportunity_value cannot be negative")
        return value


class QuotationSummaryRead(BaseModel):
    total_quotations: int = 0
    draft: int = 0
    sent: int = 0
    accepted: int = 0
    rejected: int = 0
    expired: int = 0
    open_quotations: int = 0
    pipeline_value: float = Field(0.0, ge=0.0)
    converted_to_sales_orders: int = 0


class QuotationListRead(BaseModel):
    id: int
    quote_number: str
    customer_name: str | None = None
    sales_person: str | None = None
    amount: float = Field(0.0, ge=0.0)
    quote_date: str | None = None
    valid_until: str | None = None
    status: str = "draft"
    converted_to_invoice: bool = False
    converted_to_so: bool = False
    converted_sales_order_number: str | None = None

    @field_validator("amount", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("amount cannot be negative")
        return value


class SOSummaryRead(BaseModel):
    total_orders: int = 0
    pending: int = 0
    confirmed: int = 0
    packed: int = 0
    shipped: int = 0
    delivered: int = 0
    cancelled: int = 0
    revenue: float = 0


class SOLineItemRead(BaseModel):
    item_description: str | None = None
    quantity: float = Field(0.0, ge=0.0)
    unit: str | None = None
    unit_price: float = Field(0.0, ge=0.0)
    line_total: float = Field(0.0, ge=0.0)

    @field_validator("quantity", "unit_price", "line_total", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("Value cannot be negative")
        return value


class SOListRead(BaseModel):
    id: int
    order_number: str
    customer_name: str | None = None
    order_date: str
    delivery_date: str | None = None
    amount: float = Field(0.0, ge=0.0)
    total_amount: float = Field(0.0, ge=0.0)
    payment_terms: str | None = None
    status: str = "draft"
    sales_person: str | None = None
    warehouse_name: str | None = None
    packed: bool = False
    shipped: bool = False
    invoiced: bool = False
    workflow_status: str | None = None
    deletable: bool = False
    delete_blockers: list[str] = Field(default_factory=list)
    line_items: list[SOLineItemRead] = Field(default_factory=list)

    @field_validator("amount", "total_amount", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("Value cannot be negative")
        return value


class DispatchSummaryRead(BaseModel):
    ready_to_dispatch: int = 0
    packed: int = 0
    in_transit: int = 0
    delivered: int = 0
    delayed: int = 0


class DispatchListRead(BaseModel):
    id: int
    sales_order_id: int | None = None
    dispatch_number: str
    challan_number: str | None = None
    so_number: str | None = None
    customer_name: str | None = None
    courier: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    dispatch_date: str | None = None
    eta: str | None = None
    status: str = "packed"
    lr_number: str | None = None
    tracking_url: str | None = None
    packed: bool = False
    shipped: bool = False
    invoiced: bool = False
    notes: str | None = None
    box_count: int | None = None
    total_weight: float | None = None


class DispatchShipmentCreate(BaseModel):
    sales_order_id: int
    dispatch_number: str | None = None
    dispatch_date: date | None = None
    courier: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    lr_number: str | None = None
    eta: date | None = None
    tracking_url: str | None = None
    status: str = "packed"
    notes: str | None = None
    box_count: int | None = Field(None, ge=0)
    total_weight: float | None = Field(None, ge=0.0)


class DeliveryChallanRead(BaseModel):
    challan_number: str
    dispatch_number: str
    sales_order_id: int
    so_number: str | None = None
    customer_name: str | None = None
    customer_address: str | None = None
    dispatch_date: str | None = None
    courier: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    lr_number: str | None = None
    status: str = "packed"
    lines: list[dict] = Field(default_factory=list)
    total_amount: float = Field(0.0, ge=0.0)

    @field_validator("total_amount", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("total_amount cannot be negative")
        return value


class InvoiceSummaryRead(BaseModel):
    total_invoices: int = 0
    draft: int = 0
    paid: int = 0
    pending: int = 0
    overdue: int = 0
    revenue: float = 0


class InvoiceListEnrichedRead(BaseModel):
    id: int
    invoice_number: str
    customer_name: str | None = None
    sales_order_number: str | None = None
    amount: float = Field(0.0, ge=0.0)
    gst_amount: float = Field(0.0, ge=0.0)
    due_date: str | None = None
    status: str = "draft"
    amount_paid: float = Field(0.0, ge=0.0)

    @field_validator("amount", "gst_amount", "amount_paid", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("Value cannot be negative")
        return value


class SalesMyWorkActivityRead(BaseModel):
    id: str
    category: str
    title: str
    subtitle: str = ""
    status: str = "completed"
    view_path: str
    occurred_at: str | None = None
    time_label: str | None = None


class SalesMyWorkRead(BaseModel):
    activity_date: str
    completed_count: int = 0
    pending_count: int = 0
    completed: list[SalesMyWorkActivityRead] = Field(default_factory=list)
    pending: list[SalesMyWorkActivityRead] = Field(default_factory=list)
    timeline: list[SalesMyWorkActivityRead] = Field(default_factory=list)


class SalesHubRead(BaseModel):
    monthly_revenue: float = Field(0.0, ge=0.0)
    total_orders: int = 0
    pending_orders: int = 0
    dispatch_pending: int = 0
    outstanding_payments: float = Field(0.0, ge=0.0)
    new_customers: int = 0
    open_leads: int = 0
    open_quotations: int = 0
    open_quotations_value: float = Field(0.0, ge=0.0)
    conversion_rate: float = Field(0.0, ge=0.0)
    period_label: str = ""
    period_from: str = ""
    period_to: str = ""
    pipeline_production: int = 0
    pipeline_completed: int = 0
    top_customers: list[dict] = Field(default_factory=list)
    sales_executive_performance: list[dict] = Field(default_factory=list)
    alerts: list[dict] = Field(default_factory=list)

    @field_validator("monthly_revenue", "outstanding_payments", "open_quotations_value", mode="before")
    @classmethod
    def validate_non_negative(cls, value: float) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            raise ValueError("Must be a numeric value")
        if v < 0:
            raise ValueError("Value cannot be negative")
        return value
