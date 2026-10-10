"""Vendor (supplier) master — enriched list, summary, detail, CRUD, soft delete."""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.inventory import Supplier, VendorProduct
from app.models.product import Product
from app.models.procurement import PurchaseOrder, SupplierPayment
from app.schemas.vendor import (
    VendorCreate,
    VendorDetailRead,
    VendorDocumentRead,
    VendorLedgerEntry,
    VendorListRead,
    VendorPaymentRead,
    VendorProductRead,
    VendorPurchaseOrderRead,
    VendorSummaryRead,
    VendorUpdate,
)

SUPPLIER_WRITE_FIELDS = {
    "name",
    "vendor_code",
    "contact",
    "email",
    "phone",
    "alternate_contact",
    "alternate_phone",
    "alternate_email",
    "website",
    "approval_status",
    "status",
    "vendor_type",
    "category",
    "material_type",
    "gstin",
    "pan",
    "msme",
    "business_type",
    "gst_registration_type",
    "billing_address",
    "factory_address",
    "address_line1",
    "address_line2",
    "landmark",
    "city",
    "state",
    "country",
    "pincode",
    "bank_name",
    "account_holder_name",
    "account_number",
    "ifsc",
    "bank_branch",
    "upi_id",
    "payment_terms",
    "currency",
    "credit_limit",
    "credit_days",
    "lead_time_days",
    "minimum_order_quantity",
    "minimum_order_value",
    "preferred_vendor",
    "rating",
    "quality_score",
    "delivery_score",
    "price_score",
    "service_score",
    "on_time_delivery_percentage",
    "rejection_percentage",
    "onboarding_date",
}


def _active_filter():
    return or_(Supplier.is_deleted.is_(False), Supplier.is_deleted.is_(None))


def _outstanding_for_supplier(db: Session, tenant_id: int, supplier_id: int) -> float:
    po_total = db.scalar(
        select(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).where(
            PurchaseOrder.tenant_id == tenant_id,
            PurchaseOrder.supplier_id == supplier_id,
            PurchaseOrder.status.notin_(("cancelled", "draft")),
        )
    ) or 0
    paid = db.scalar(
        select(func.coalesce(func.sum(SupplierPayment.amount), 0)).where(
            SupplierPayment.tenant_id == tenant_id,
            SupplierPayment.supplier_id == supplier_id,
        )
    ) or 0
    return max(float(po_total) - float(paid), 0.0)


def _vendor_code(supplier: Supplier) -> str:
    if supplier.vendor_code:
        return supplier.vendor_code
    return f"VEN-{supplier.id:04d}"


def _next_vendor_code(db: Session, tenant_id: int) -> str:
    codes = list(
        db.scalars(
            select(Supplier.vendor_code).where(
                Supplier.tenant_id == tenant_id,
                Supplier.vendor_code.is_not(None),
            )
        ).all()
    )
    max_n = 0
    for code in codes:
        digits = "".join(ch for ch in (code or "") if ch.isdigit())
        if digits:
            max_n = max(max_n, int(digits))
    count = db.scalar(
        select(func.count(Supplier.id)).where(Supplier.tenant_id == tenant_id, _active_filter())
    ) or 0
    return f"VEN-{max(max_n, count) + 1:04d}"


def _product_ids(db: Session, tenant_id: int, vendor_id: int) -> list[int]:
    return list(
        db.scalars(
            select(VendorProduct.product_id).where(
                VendorProduct.tenant_id == tenant_id,
                VendorProduct.vendor_id == vendor_id,
            )
        ).all()
    )


def _sync_billing_address(data: dict) -> dict:
    """Keep legacy billing_address in sync with structured address lines."""
    line1 = (data.get("address_line1") or "").strip()
    line2 = (data.get("address_line2") or "").strip()
    landmark = (data.get("landmark") or "").strip()
    parts = [p for p in (line1, line2, landmark) if p]
    if parts and not data.get("billing_address"):
        data["billing_address"] = ", ".join(parts)
    return data


def _assert_no_duplicates(
    db: Session,
    tenant_id: int,
    *,
    gstin: str | None,
    phone: str | None,
    exclude_id: int | None = None,
) -> None:
    if gstin and gstin.strip():
        clean_gst = gstin.strip().upper()
        q = select(Supplier).where(
            Supplier.tenant_id == tenant_id,
            func.upper(Supplier.gstin) == clean_gst,
            _active_filter(),
        )
        if exclude_id:
            q = q.where(Supplier.id != exclude_id)
        if db.scalars(q).first():
            raise HTTPException(
                status_code=400,
                detail=f"A vendor with GSTIN '{clean_gst}' already exists.",
            )
    if phone and phone.strip():
        clean_phone = phone.strip()
        q = select(Supplier).where(
            Supplier.tenant_id == tenant_id,
            Supplier.phone == clean_phone,
            _active_filter(),
        )
        if exclude_id:
            q = q.where(Supplier.id != exclude_id)
        if db.scalars(q).first():
            raise HTTPException(
                status_code=400,
                detail="A vendor with this mobile number already exists.",
            )


def _set_vendor_products(
    db: Session, tenant_id: int, vendor_id: int, product_ids: list[int] | None
) -> None:
    if product_ids is None:
        return
    unique_ids = sorted({int(pid) for pid in product_ids if pid})
    if unique_ids:
        found = set(
            db.scalars(
                select(Product.id).where(
                    Product.tenant_id == tenant_id,
                    Product.id.in_(unique_ids),
                )
            ).all()
        )
        missing = [pid for pid in unique_ids if pid not in found]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid product id(s): {', '.join(map(str, missing))}",
            )
    existing = list(
        db.scalars(
            select(VendorProduct).where(
                VendorProduct.tenant_id == tenant_id,
                VendorProduct.vendor_id == vendor_id,
            )
        ).all()
    )
    for row in existing:
        db.delete(row)
    for pid in unique_ids:
        db.add(
            VendorProduct(
                tenant_id=tenant_id,
                vendor_id=vendor_id,
                product_id=pid,
            )
        )


def _batch_outstanding_for_suppliers(
    db: Session, tenant_id: int, supplier_ids: list[int]
) -> dict[int, float]:
    if not supplier_ids:
        return {}
    unique_ids = list({int(sid) for sid in supplier_ids if sid})
    po_rows = db.execute(
        select(PurchaseOrder.supplier_id, func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).where(
            PurchaseOrder.tenant_id == tenant_id,
            PurchaseOrder.supplier_id.in_(unique_ids),
            PurchaseOrder.status.notin_(("cancelled", "draft")),
        ).group_by(PurchaseOrder.supplier_id)
    ).all()
    paid_rows = db.execute(
        select(SupplierPayment.supplier_id, func.coalesce(func.sum(SupplierPayment.amount), 0)).where(
            SupplierPayment.tenant_id == tenant_id,
            SupplierPayment.supplier_id.in_(unique_ids),
        ).group_by(SupplierPayment.supplier_id)
    ).all()
    po_map = {int(row[0]): float(row[1] or 0) for row in po_rows}
    paid_map = {int(row[0]): float(row[1] or 0) for row in paid_rows}
    return {
        sid: max(po_map.get(sid, 0.0) - paid_map.get(sid, 0.0), 0.0) for sid in unique_ids
    }


def _batch_product_ids(
    db: Session, tenant_id: int, vendor_ids: list[int]
) -> dict[int, list[int]]:
    if not vendor_ids:
        return {}
    unique_ids = list({int(vid) for vid in vendor_ids if vid})
    rows = db.execute(
        select(VendorProduct.vendor_id, VendorProduct.product_id).where(
            VendorProduct.tenant_id == tenant_id,
            VendorProduct.vendor_id.in_(unique_ids),
        )
    ).all()
    result: dict[int, list[int]] = {vid: [] for vid in unique_ids}
    for vendor_id, product_id in rows:
        result.setdefault(int(vendor_id), []).append(int(product_id))
    return result


def _to_list_read(
    db: Session,
    tenant_id: int,
    supplier: Supplier,
    *,
    outstanding_map: dict[int, float] | None = None,
    product_ids_map: dict[int, list[int]] | None = None,
) -> VendorListRead:
    data = VendorListRead.model_validate(supplier)
    data.vendor_code = _vendor_code(supplier)
    if outstanding_map is not None:
        data.outstanding = outstanding_map.get(supplier.id, 0.0)
    else:
        data.outstanding = _outstanding_for_supplier(db, tenant_id, supplier.id)
    data.preferred_vendor = bool(getattr(supplier, "preferred_vendor", False))
    if product_ids_map is not None:
        data.product_ids = product_ids_map.get(supplier.id, [])
    else:
        data.product_ids = _product_ids(db, tenant_id, supplier.id)
    return data


def _get_supplier(db: Session, tenant_id: int, vendor_id: int) -> Supplier | None:
    return db.scalars(
        select(Supplier).where(
            Supplier.id == vendor_id,
            Supplier.tenant_id == tenant_id,
            _active_filter(),
        )
    ).first()


def list_vendors_enriched(
    db: Session,
    tenant_id: int,
    *,
    search: str | None = None,
    vendor_type: str | None = None,
    status: str | None = None,
    state: str | None = None,
    city: str | None = None,
    preferred: bool | None = None,
    min_rating: float | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[VendorListRead]:
    q = select(Supplier).where(Supplier.tenant_id == tenant_id, _active_filter())
    if search:
        term = f"%{search.strip()}%"
        q = q.where(
            or_(
                Supplier.name.ilike(term),
                Supplier.vendor_code.ilike(term),
                Supplier.contact.ilike(term),
                Supplier.phone.ilike(term),
                Supplier.email.ilike(term),
                Supplier.gstin.ilike(term),
                Supplier.city.ilike(term),
            )
        )
    if vendor_type:
        q = q.where(Supplier.vendor_type == vendor_type)
    if status:
        q = q.where(Supplier.status == status.lower())
    if state:
        q = q.where(Supplier.state.ilike(f"%{state.strip()}%"))
    if city:
        q = q.where(Supplier.city.ilike(f"%{city.strip()}%"))
    if preferred is not None:
        q = q.where(Supplier.preferred_vendor.is_(preferred))
    if min_rating is not None:
        q = q.where(Supplier.rating >= min_rating)
    if date_from:
        q = q.where(func.date(Supplier.created_at) >= date_from)
    if date_to:
        q = q.where(func.date(Supplier.created_at) <= date_to)
    suppliers = list(db.scalars(q.order_by(Supplier.name)).all())
    supplier_ids = [s.id for s in suppliers]
    outstanding_map = _batch_outstanding_for_suppliers(db, tenant_id, supplier_ids)
    product_ids_map = _batch_product_ids(db, tenant_id, supplier_ids)
    return [
        _to_list_read(db, tenant_id, s, outstanding_map=outstanding_map, product_ids_map=product_ids_map)
        for s in suppliers
    ]


def get_vendor_summary(db: Session, tenant_id: int) -> VendorSummaryRead:
    suppliers = list(
        db.scalars(
            select(Supplier).where(Supplier.tenant_id == tenant_id, _active_filter())
        ).all()
    )
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    active = sum(1 for s in suppliers if (s.status or "").lower() == "active")
    inactive = sum(1 for s in suppliers if (s.status or "").lower() == "inactive")
    blacklisted = sum(1 for s in suppliers if (s.status or "").lower() == "blacklisted")
    preferred = sum(1 for s in suppliers if getattr(s, "preferred_vendor", False))
    pending = sum(1 for s in suppliers if s.approval_status == "pending")
    new_month = 0
    for s in suppliers:
        if not s.created_at:
            continue
        created = s.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created >= month_start:
            new_month += 1
    ratings = [float(s.rating) for s in suppliers if s.rating is not None]
    avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else None
    outstanding = sum(_outstanding_for_supplier(db, tenant_id, s.id) for s in suppliers)

    # Top vendors by purchase value
    top: list[dict] = []
    for s in suppliers:
        pos = list(
            db.scalars(
                select(PurchaseOrder).where(
                    PurchaseOrder.tenant_id == tenant_id,
                    PurchaseOrder.supplier_id == s.id,
                    PurchaseOrder.status.notin_(("cancelled", "draft")),
                )
            ).all()
        )
        value = sum(float(p.total_amount or 0) for p in pos)
        top.append(
            {
                "id": s.id,
                "vendor_code": _vendor_code(s),
                "name": s.name,
                "rating": float(s.rating) if s.rating is not None else None,
                "total_purchase_value": round(value, 2),
                "total_purchase_orders": len(pos),
            }
        )
    top.sort(key=lambda x: x["total_purchase_value"], reverse=True)

    delivery_vals = [
        float(s.delivery_score)
        for s in suppliers
        if getattr(s, "delivery_score", None) is not None
    ]
    avg_delivery = (
        round(sum(delivery_vals) / len(delivery_vals), 1) if delivery_vals else None
    )

    return VendorSummaryRead(
        total_vendors=len(suppliers),
        active_vendors=active,
        inactive_vendors=inactive,
        preferred_vendors=preferred,
        blacklisted_vendors=blacklisted,
        pending_approval=pending,
        outstanding_payables=round(outstanding, 2),
        new_this_month=new_month,
        average_rating=avg_rating,
        average_delivery_days=avg_delivery,
        top_vendors=top[:5],
    )


def get_vendor_detail(db: Session, tenant_id: int, vendor_id: int) -> VendorDetailRead | None:
    supplier = _get_supplier(db, tenant_id, vendor_id)
    if not supplier:
        return None

    pos = list(
        db.scalars(
            select(PurchaseOrder)
            .where(
                PurchaseOrder.tenant_id == tenant_id,
                PurchaseOrder.supplier_id == vendor_id,
            )
            .order_by(PurchaseOrder.order_date.desc())
        ).all()
    )
    payments = list(
        db.scalars(
            select(SupplierPayment)
            .where(
                SupplierPayment.tenant_id == tenant_id,
                SupplierPayment.supplier_id == vendor_id,
            )
            .order_by(SupplierPayment.payment_date.desc())
        ).all()
    )

    completed = sum(1 for p in pos if p.status in ("received", "completed", "closed"))
    pending = sum(1 for p in pos if p.status in ("draft", "approved", "pending"))
    total_value = sum(float(p.total_amount or 0) for p in pos)
    last_date = pos[0].order_date if pos else None

    detail = VendorDetailRead.model_validate(supplier)
    detail.vendor_code = _vendor_code(supplier)
    detail.outstanding = _outstanding_for_supplier(db, tenant_id, vendor_id)
    detail.preferred_vendor = bool(getattr(supplier, "preferred_vendor", False))
    detail.product_ids = _product_ids(db, tenant_id, vendor_id)
    detail.total_purchase_orders = len(pos)
    detail.completed_orders = completed
    detail.pending_orders = pending
    detail.total_purchase_value = round(total_value, 2)
    detail.last_purchase_date = last_date
    detail.average_delivery_days = (
        float(supplier.delivery_score)
        if getattr(supplier, "delivery_score", None) is not None
        else getattr(supplier, "lead_time_days", None)
    )
    detail.purchase_orders = [
        VendorPurchaseOrderRead.model_validate(p) for p in pos[:50]
    ]
    detail.payments = [VendorPaymentRead.model_validate(p) for p in payments[:50]]
    detail.ledger = _build_ledger(pos, payments)
    detail.products = list_vendor_products(db, tenant_id, vendor_id)
    detail.documents = list_vendor_documents(db, tenant_id, vendor_id)
    return detail


def list_vendor_products(
    db: Session, tenant_id: int, vendor_id: int
) -> list[VendorProductRead]:
    rows = list(
        db.execute(
            select(VendorProduct, Product)
            .join(Product, Product.id == VendorProduct.product_id)
            .where(
                VendorProduct.tenant_id == tenant_id,
                VendorProduct.vendor_id == vendor_id,
            )
            .order_by(Product.name)
        ).all()
    )
    return [
        VendorProductRead(
            id=vp.id,
            product_id=product.id,
            sku=product.sku,
            name=product.name,
            unit=product.unit,
        )
        for vp, product in rows
    ]


def list_vendor_documents(
    db: Session, tenant_id: int, vendor_id: int
) -> list[VendorDocumentRead]:
    docs = list(
        db.scalars(
            select(Document)
            .where(
                Document.tenant_id == tenant_id,
                Document.reference_type == "vendor",
                Document.reference_id == vendor_id,
            )
            .order_by(Document.created_at.desc())
        ).all()
    )
    return [VendorDocumentRead.model_validate(d) for d in docs]


def get_vendor_purchase_history(
    db: Session, tenant_id: int, vendor_id: int
) -> list[VendorPurchaseOrderRead]:
    if not _get_supplier(db, tenant_id, vendor_id):
        return []
    pos = list(
        db.scalars(
            select(PurchaseOrder)
            .where(
                PurchaseOrder.tenant_id == tenant_id,
                PurchaseOrder.supplier_id == vendor_id,
            )
            .order_by(PurchaseOrder.order_date.desc())
        ).all()
    )
    return [VendorPurchaseOrderRead.model_validate(p) for p in pos]


def _build_ledger(
    pos: list[PurchaseOrder], payments: list[SupplierPayment]
) -> list[VendorLedgerEntry]:
    entries: list[VendorLedgerEntry] = []
    for po in pos:
        entries.append(
            VendorLedgerEntry(
                date=po.order_date,
                reference=po.po_number,
                description=f"Purchase Order — {po.status}",
                debit=float(po.total_amount or 0),
                credit=0,
                balance=0,
            )
        )
    for pay in payments:
        entries.append(
            VendorLedgerEntry(
                date=pay.payment_date,
                reference=pay.reference or f"PAY-{pay.id}",
                description=f"Payment ({pay.payment_method})",
                debit=0,
                credit=float(pay.amount or 0),
                balance=0,
            )
        )
    entries.sort(key=lambda e: e.date)
    running = 0.0
    for e in entries:
        running += e.debit - e.credit
        e.balance = round(running, 2)
    return entries[-30:]


def create_vendor(
    db: Session,
    payload: VendorCreate,
    *,
    actor: str | None = None,
) -> Supplier:
    _assert_no_duplicates(
        db, payload.tenant_id, gstin=payload.gstin, phone=payload.phone
    )
    data = payload.model_dump(
        exclude={
            "product_ids",
            "party_basic_details",
            "party_other_details",
            "party_custom_fields",
        }
    )
    if not data.get("vendor_code"):
        data["vendor_code"] = _next_vendor_code(db, payload.tenant_id)
    data = _sync_billing_address(data)
    if not data.get("onboarding_date"):
        data["onboarding_date"] = date.today()
    if actor:
        data["created_by"] = actor
        data["updated_by"] = actor
    data["is_deleted"] = False
    product_ids = payload.product_ids or []
    supplier = Supplier(**{k: v for k, v in data.items() if k in SUPPLIER_WRITE_FIELDS or k in (
        "tenant_id", "created_by", "updated_by", "is_deleted", "onboarding_date"
    )})
    db.add(supplier)
    db.flush()
    _set_vendor_products(db, payload.tenant_id, supplier.id, product_ids)
    db.commit()
    db.refresh(supplier)
    return supplier


def update_vendor(
    db: Session,
    tenant_id: int,
    vendor_id: int,
    payload: VendorUpdate,
    *,
    actor: str | None = None,
) -> Supplier | None:
    supplier = _get_supplier(db, tenant_id, vendor_id)
    if not supplier:
        return None
    data = payload.model_dump(exclude_unset=True)
    product_ids = data.pop("product_ids", None)
    gstin = data.get("gstin", supplier.gstin)
    phone = data.get("phone", supplier.phone)
    _assert_no_duplicates(
        db, tenant_id, gstin=gstin, phone=phone, exclude_id=vendor_id
    )
    data = _sync_billing_address(data)
    for key, value in data.items():
        if key in SUPPLIER_WRITE_FIELDS:
            setattr(supplier, key, value)
    if actor:
        supplier.updated_by = actor
    _set_vendor_products(db, tenant_id, vendor_id, product_ids)
    db.commit()
    db.refresh(supplier)
    return supplier


def soft_delete_vendor(
    db: Session, tenant_id: int, vendor_id: int, *, actor: str | None = None
) -> Supplier | None:
    supplier = _get_supplier(db, tenant_id, vendor_id)
    if not supplier:
        return None
    supplier.is_deleted = True
    supplier.deleted_at = date.today()
    supplier.status = "inactive"
    if actor:
        supplier.updated_by = actor
    db.commit()
    db.refresh(supplier)
    return supplier


def deactivate_vendor(db: Session, tenant_id: int, vendor_id: int) -> Supplier | None:
    return update_vendor(
        db, tenant_id, vendor_id, VendorUpdate(status="inactive")
    )


def bulk_update_vendor_status(
    db: Session,
    tenant_id: int,
    vendor_ids: list[int],
    status: str,
    *,
    actor: str | None = None,
) -> int:
    updated = 0
    for vid in vendor_ids:
        supplier = _get_supplier(db, tenant_id, vid)
        if not supplier:
            continue
        supplier.status = status
        if actor:
            supplier.updated_by = actor
        updated += 1
    db.commit()
    return updated
