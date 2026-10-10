from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class PurchaseOrder(Base, TimestampMixin):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False)
    po_number: Mapped[str] = mapped_column(String(64), nullable=False)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    total_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    payment_terms: Mapped[str | None] = mapped_column(String(128))
    buyer: Mapped[str | None] = mapped_column(String(255))
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"))
    material_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_requests.id")
    )
    gst_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    discount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    supplier = relationship("Supplier", back_populates="purchase_orders")
    material_request = relationship("MaterialRequest", foreign_keys=[material_request_id])
    line_items = relationship(
        "PurchaseOrderLine",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
    )
    goods_receipts = relationship(
        "GoodsReceipt",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
    )


class PurchaseOrderLine(Base, TimestampMixin):
    __tablename__ = "purchase_order_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(
        ForeignKey("purchase_orders.id"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_items.id"), nullable=False
    )
    quantity: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Numeric(12, 2))
    line_total: Mapped[float | None] = mapped_column(Numeric(12, 2))

    purchase_order = relationship("PurchaseOrder", back_populates="line_items")
    item = relationship("InventoryItem")

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None

    @property
    def item_sku(self) -> str | None:
        return self.item.sku if self.item else None

    @property
    def item_unit(self) -> str | None:
        return self.item.unit if self.item else None

class MaterialRequest(Base, TimestampMixin):
    __tablename__ = "material_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    mr_number: Mapped[str] = mapped_column(String(64), nullable=False)
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    required_date: Mapped[date | None] = mapped_column(Date)
    requested_by: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(128))
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"))
    priority: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)
    approval_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    line_items = relationship(
        "MaterialRequestLine",
        back_populates="material_request",
        cascade="all, delete-orphan",
    )


class MaterialRequestLine(Base, TimestampMixin):
    __tablename__ = "material_request_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_request_id: Mapped[int] = mapped_column(
        ForeignKey("material_requests.id"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_items.id"), nullable=False
    )
    quantity: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255))

    material_request = relationship("MaterialRequest", back_populates="line_items")
    item = relationship("InventoryItem")

    @property
    def item_name(self) -> str | None:
        return self.item.name if self.item else None

    @property
    def item_sku(self) -> str | None:
        return self.item.sku if self.item else None

    @property
    def item_unit(self) -> str | None:
        return self.item.unit if self.item else None

    @property
    def item_unit_cost(self) -> float | None:
        return float(self.item.unit_cost) if self.item and self.item.unit_cost is not None else None


class GoodsReceipt(Base, TimestampMixin):
    __tablename__ = "goods_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    purchase_order_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_orders.id"))
    grn_number: Mapped[str] = mapped_column(String(64), nullable=False)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    warehouse_id: Mapped[int] = mapped_column(
        ForeignKey("warehouses.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), default="received", nullable=False)
    qc_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    received_by: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)

    purchase_order = relationship("PurchaseOrder", back_populates="goods_receipts")
    warehouse = relationship("Warehouse")
    line_items = relationship(
        "GoodsReceiptLine",
        back_populates="goods_receipt",
        cascade="all, delete-orphan",
    )


class GoodsReceiptLine(Base, TimestampMixin):
    __tablename__ = "goods_receipt_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    goods_receipt_id: Mapped[int] = mapped_column(
        ForeignKey("goods_receipts.id"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_items.id"), nullable=False
    )
    quantity_received: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    quantity_rejected: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    goods_receipt = relationship("GoodsReceipt", back_populates="line_items")
    item = relationship("InventoryItem")


class SupplierPayment(Base, TimestampMixin):
    __tablename__ = "supplier_payments"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", name="uq_supplier_payments_tenant_idempotency"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(64), default="bank", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)

    supplier = relationship("Supplier")


class RFQ(Base, TimestampMixin):
    __tablename__ = "rfqs"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    rfq_number: Mapped[str] = mapped_column(String(64), nullable=False)
    material_request_id: Mapped[int | None] = mapped_column(ForeignKey("material_requests.id"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    quotations = relationship("VendorQuotation", back_populates="rfq", cascade="all, delete-orphan")


class VendorQuotation(Base, TimestampMixin):
    __tablename__ = "vendor_quotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfqs.id"), nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False)
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    delivery_days: Mapped[int | None] = mapped_column(Integer)
    gst_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    warranty: Mapped[str | None] = mapped_column(String(128))
    rating: Mapped[float | None] = mapped_column(Numeric(3, 1))
    status: Mapped[str] = mapped_column(String(32), default="submitted", nullable=False)

    rfq = relationship("RFQ", back_populates="quotations")
    supplier = relationship("Supplier")


class VendorBill(Base, TimestampMixin):
    __tablename__ = "vendor_bills"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    bill_number: Mapped[str] = mapped_column(String(64), nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False)
    purchase_order_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_orders.id"))
    goods_receipt_id: Mapped[int | None] = mapped_column(ForeignKey("goods_receipts.id"))
    bill_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    gst_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)

    supplier = relationship("Supplier")

