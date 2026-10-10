import logging
from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.models.product import InventoryCategory, Product, ProductStockEvent
from app.schemas.inventory_v2 import (
    InventoryItemV2Create,
    InventoryItemV2Update,
    StockAdjustRequest,
)


def _f(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _today_label() -> str:
    d = date.today()
    return f"{d.day:02d}-{d.month:02d}-{d.year}"


def serialize_item(p: Product, db: Session | None = None) -> dict:
    stock = _f(p.current_stock)
    sale = _f(p.unit_price)
    purchase = _f(p.unit_cost)
    data = {
        "id": p.id,
        "sku": p.sku,
        "product_code": p.sku,
        "barcode": p.barcode,
        "name": p.name,
        "description": p.description or "",
        "unit": p.unit or "Pcs",
        "hsn_code": p.hsn_code or "",
        "category": p.category or "No Category",
        "purchase_price": purchase,
        "selling_price": sale,
        "unit_cost": purchase,
        "unit_price": sale,
        "wholesale_price": _f(p.wholesale_price),
        "gst_percent": _f(p.gst_percent),
        "cess_percent": _f(p.cess_percent),
        "min_stock": _f(p.min_stock),
        "max_stock": _f(p.max_stock) if p.max_stock is not None else None,
        "current_stock": stock,
        "stock_value": round(stock * purchase, 3),
    }
    if db is not None:
        from app.services.inventory_item_photo import get_primary_photo_file_id
        from app.services.product_inventory_sync import linked_inventory_item

        inventory_item = linked_inventory_item(db, p.tenant_id, p.id)
        data["inventory_item_id"] = inventory_item.id if inventory_item else None
        data["photo_file_id"] = (
            get_primary_photo_file_id(db, p.tenant_id, inventory_item.id)
            if inventory_item
            else None
        )
    return data


def list_items(
    db: Session,
    tenant_id: int,
    q: str | None = None,
    *,
    category: str | None = None,
    category_id: int | None = None,
    limit: int = 500,
    offset: int = 0,
) -> list[dict]:
    from sqlalchemy import or_

    from app.services.product_service import _apply_product_list_filters

    stmt = select(Product).where(Product.tenant_id == tenant_id)
    stmt = _apply_product_list_filters(
        stmt, db, tenant_id, category=category, category_id=category_id, q=q
    )
    stmt = (
        stmt.order_by(Product.name)
        .offset(max(0, offset))
        .limit(max(1, min(limit, 2000)))
    )
    rows = list(db.scalars(stmt).all())
    return [serialize_item(p, db) for p in rows]


def get_item(db: Session, tenant_id: int, product_id: int) -> dict | None:
    p = db.scalars(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    ).first()
    if not p:
        return None
    data = serialize_item(p, db)
    data["timeline"] = list_timeline(db, tenant_id, product_id)
    return data


def create_item(db: Session, tenant_id: int, payload: InventoryItemV2Create) -> dict:
    sku = (payload.sku or "").strip() or None
    if sku and db.scalars(
        select(Product).where(Product.tenant_id == tenant_id, Product.sku == sku)
    ).first():
        raise HTTPException(status_code=409, detail="SKU already exists")

    min_stk = int(payload.min_stock or 0)
    max_stk = int(payload.max_stock) if payload.max_stock is not None else None
    if max_stk is not None and min_stk > max_stk:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_stock cannot be less than min_stock.")

    stock = Decimal(str(payload.current_stock or 0))

    product = Product(
        tenant_id=tenant_id,
        sku=sku,
        name=payload.name.strip(),
        barcode=payload.barcode,
        description=payload.description,
        unit=payload.unit or "Pcs",
        unit_cost=payload.purchase_price,
        unit_price=payload.selling_price,
        wholesale_price=payload.wholesale_price,
        hsn_code=payload.hsn_code,
        category=payload.category or "No Category",
        gst_percent=payload.gst_percent or 0,
        cess_percent=payload.cess_percent or 0,
        min_stock=min_stk,
        max_stock=max_stk if max_stk is not None else 100,
        current_stock=stock,
    )
    try:
        db.add(product)
        db.flush()
        from app.services.sku_service import assign_product_sku

        sku = assign_product_sku(db, product)
        db.flush()
        from app.services.product_inventory_sync import (
            ensure_product_inventory_item,
            set_product_stock_in_primary_warehouse,
        )

        if stock:
            set_product_stock_in_primary_warehouse(db, tenant_id, product, stock)
        else:
            ensure_product_inventory_item(db, tenant_id, product)
        opening_quantity = Decimal(str(product.current_stock or 0))
        db.add(
            ProductStockEvent(
                tenant_id=tenant_id,
                product_id=product.id,
                activity="First Stock",
                subtitle="Opening Stock",
                change_qty=opening_quantity,
                final_qty=opening_quantity,
                unit=product.unit,
                event_date=_today_label(),
            )
        )
        db.commit()
        db.refresh(product)
        return serialize_item(product, db)
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error creating product item for sku=%s tenant_id=%s: %s", sku, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while creating product item.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error creating product item for sku=%s tenant_id=%s: %s", sku, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create product item.",
        ) from exc


def update_item(
    db: Session, tenant_id: int, product_id: int, payload: InventoryItemV2Update
) -> dict | None:
    product = db.scalars(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    ).first()
    if not product:
        return None
    data = payload.model_dump(exclude_unset=True)
    mapping = {
        "purchase_price": "unit_cost",
        "selling_price": "unit_price",
    }
    for key, value in data.items():
        if key == "current_stock":
            continue
        attr = mapping.get(key, key)
        if key == "min_stock" and value is not None:
            value = int(value)
        if key == "max_stock" and value is not None:
            value = int(value)
        setattr(product, attr, value)

    cur_min = product.min_stock if product.min_stock is not None else 0
    cur_max = product.max_stock
    if cur_max is not None and cur_min > cur_max:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_stock cannot be less than min_stock.")
    try:
        from app.models.inventory import InventoryItem
        from app.services.product_inventory_sync import ensure_product_inventory_item

        inventory_item = ensure_product_inventory_item(db, tenant_id, product)
        if "sku" in data:
            collision = db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku == data["sku"],
                    InventoryItem.id != inventory_item.id,
                )
            ).first()
            if collision:
                db.rollback()
                raise HTTPException(
                    status_code=409,
                    detail=f"Inventory SKU '{data['sku']}' is already in use by another item.",
                )
            inventory_item.sku = data["sku"]
        for product_field, inventory_field in (
            ("name", "name"),
            ("description", "description"),
            ("unit", "unit"),
            ("purchase_price", "unit_cost"),
            ("category", "category"),
            ("barcode", "barcode"),
        ):
            if product_field in data:
                setattr(inventory_item, inventory_field, data[product_field])
        if "current_stock" in data:
            from app.services.product_inventory_sync import set_product_stock_target

            set_product_stock_target(
                db,
                tenant_id,
                product,
                Decimal(str(data["current_stock"] or 0)),
                reference="CATALOG-STOCK-EDIT",
            )
        db.commit()
        db.refresh(product)
        return serialize_item(product, db)
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error updating product_id=%s tenant_id=%s: %s", product_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while updating product item.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error updating product_id=%s tenant_id=%s: %s", product_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update product item.",
        ) from exc


def delete_item(db: Session, tenant_id: int, product_id: int) -> bool:
    from app.services.product_service import delete_product

    return delete_product(db, tenant_id, product_id)


def list_timeline(db: Session, tenant_id: int, product_id: int) -> list[dict]:
    rows = list(
        db.scalars(
            select(ProductStockEvent)
            .where(
                ProductStockEvent.tenant_id == tenant_id,
                ProductStockEvent.product_id == product_id,
            )
            .order_by(ProductStockEvent.id.desc())
        ).all()
    )
    if not rows:
        return []
    return [
        {
            "id": r.id,
            "activity": r.activity,
            "subtitle": r.subtitle or r.remark,
            "date": r.event_date or (r.created_at.strftime("%d-%m-%Y") if r.created_at else None),
            "change": _f(r.change_qty),
            "final": _f(r.final_qty),
            "unit": r.unit,
        }
        for r in rows
    ]


def _adjust_stock(
    db: Session,
    tenant_id: int,
    product_id: int,
    payload: StockAdjustRequest,
    *,
    adding: bool,
) -> dict:
    product = db.scalars(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    ).first()
    if not product:
        raise HTTPException(404, detail="Item not found")

    from app.services.product_inventory_sync import (
        change_product_stock,
        ensure_product_inventory_item,
    )

    ensure_product_inventory_item(db, tenant_id, product)
    previous = _f(product.current_stock)
    qty = float(payload.quantity)
    if not adding and qty > previous:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove more than available stock.")

    next_stock = previous + qty if adding else previous - qty
    if next_stock < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resulting stock quantity cannot be negative.")
    change_product_stock(
        db,
        tenant_id,
        product,
        qty if adding else -qty,
        reference="CATALOG-STOCK-ADJUSTMENT",
    )
    next_stock = _f(product.current_stock)
    entry = ProductStockEvent(
        tenant_id=tenant_id,
        product_id=product.id,
        activity="Stock Added" if adding else "Stock Removed",
        subtitle=payload.remark or ("Manual Add" if adding else "Manual Reduce"),
        change_qty=qty if adding else -qty,
        final_qty=next_stock,
        unit=payload.unit or product.unit or "PCS",
        remark=payload.remark,
        event_date=_today_label(),
    )
    db.add(entry)
    try:
        db.commit()
        db.refresh(product)
        db.refresh(entry)
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error during stock adjustment for product_id=%s tenant_id=%s: %s", product_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while adjusting product stock.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error during stock adjustment for product_id=%s tenant_id=%s: %s", product_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to adjust product stock.",
        ) from exc
    timeline_entry = {
        "id": entry.id,
        "activity": entry.activity,
        "subtitle": entry.subtitle,
        "date": entry.event_date,
        "change": _f(entry.change_qty),
        "final": _f(entry.final_qty),
        "unit": entry.unit,
    }
    return {
        "product_id": product.id,
        "previous_stock": previous,
        "current_stock": next_stock,
        "change": qty if adding else -qty,
        "item": serialize_item(product, db),
        "timeline_entry": timeline_entry,
    }


def add_stock(
    db: Session, tenant_id: int, product_id: int, payload: StockAdjustRequest
) -> dict:
    return _adjust_stock(db, tenant_id, product_id, payload, adding=True)


def remove_stock(
    db: Session, tenant_id: int, product_id: int, payload: StockAdjustRequest
) -> dict:
    return _adjust_stock(db, tenant_id, product_id, payload, adding=False)


def list_categories(db: Session, tenant_id: int) -> list[dict]:
    cats = list(
        db.scalars(
            select(InventoryCategory)
            .where(InventoryCategory.tenant_id == tenant_id)
            .order_by(InventoryCategory.name)
        ).all()
    )
    counts = dict(
        db.execute(
            select(Product.category, func.count(Product.id))
            .where(Product.tenant_id == tenant_id)
            .group_by(Product.category)
        ).all()
    )
    result = [
        {
            "id": c.id,
            "name": c.name,
            "stock": int(counts.get(c.name) or 0),
        }
        for c in cats
    ]
    names = {c.name for c in cats}
    if "No Category" not in names:
        no_cat_count = int(counts.get("No Category") or 0)
        result.insert(0, {"id": 0, "name": "No Category", "stock": no_cat_count})
    return result


def category_wise(db: Session, tenant_id: int) -> list[dict]:
    cats = list_categories(db, tenant_id)
    return [{"category": c["name"], "stock": c["stock"]} for c in cats]


def create_category(db: Session, tenant_id: int, name: str) -> dict:
    clean = name.strip()
    if not clean:
        raise HTTPException(400, detail="Category name is required")
    exists = db.scalars(
        select(InventoryCategory).where(
            InventoryCategory.tenant_id == tenant_id,
            func.lower(InventoryCategory.name) == clean.lower(),
        )
    ).first()
    if exists:
        raise HTTPException(400, detail="Category already exists")
    row = InventoryCategory(tenant_id=tenant_id, name=clean)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "stock": 0}


def delete_category(db: Session, tenant_id: int, category_id: int) -> bool:
    from sqlalchemy import or_
    from app.models.inventory import InventoryItem

    row = db.scalars(
        select(InventoryCategory).where(
            InventoryCategory.id == category_id,
            InventoryCategory.tenant_id == tenant_id,
        )
    ).first()
    if not row:
        return False
    if row.name.lower() == "no category":
        raise HTTPException(400, detail="Cannot delete default category")

    # Unlink or update products and inventory items tied to this category
    products = list(
        db.scalars(
            select(Product).where(
                Product.tenant_id == tenant_id,
                func.lower(Product.category) == row.name.lower(),
            )
        ).all()
    )
    for p in products:
        p.category = None

    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                func.lower(InventoryItem.category) == row.name.lower(),
            )
        ).all()
    )
    for i in items:
        i.category = None

    db.delete(row)
    db.commit()
    return True
