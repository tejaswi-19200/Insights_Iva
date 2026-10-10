import logging
from datetime import date
from decimal import Decimal
from sqlalchemy import select, func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

from app.models.inventory import (
    InventoryItem,
    StockLevel,
    StockMovement,
    Supplier,
    Warehouse,
)
from app.models.product import Product
from app.schemas.inventory import (
    InventoryItemCreate,
    StockLevelCreate,
    StockMovementCreate,
    SupplierCreate,
    WarehouseCreate,
)


def create_warehouse(db: Session, payload: WarehouseCreate) -> Warehouse:
    wh = Warehouse(**payload.model_dump())
    db.add(wh)
    db.commit()
    db.refresh(wh)
    return wh


def list_warehouses(db: Session, tenant_id: int) -> list[Warehouse]:
    stmt = select(Warehouse).where(Warehouse.tenant_id == tenant_id)
    return list(db.scalars(stmt).all())


def create_supplier(db: Session, payload: SupplierCreate) -> Supplier:
    s = Supplier(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def get_or_create_inventory_item_for_product(
    db: Session,
    tenant_id: int,
    product: Product,
    *,
    item_type: str = "raw_material",
) -> InventoryItem:
    """Resolve the one inventory record linked to a product, creating it at zero stock."""
    if product.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Product not found")

    linked = db.scalars(
        select(InventoryItem).where(
            InventoryItem.tenant_id == tenant_id,
            InventoryItem.product_id == product.id,
        )
    ).first()
    if linked:
        product_sku = (product.sku or "").strip()
        if product_sku and linked.sku != product_sku:
            collision = db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku == product_sku,
                    InventoryItem.id != linked.id,
                )
            ).first()
            if collision:
                raise HTTPException(
                    status_code=409,
                    detail=f"Product SKU '{product_sku}' is already used by another inventory item.",
                )
            linked.sku = product_sku
        if product.barcode is not None:
            linked.barcode = product.barcode
        return linked

    sku = (product.sku or "").strip()
    if not sku:
        from app.services.sku_service import assign_product_sku

        sku = assign_product_sku(db, product)
        db.flush()

    legacy_matches = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.sku == sku,
            )
        ).all()
    )
    if len(legacy_matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Multiple inventory records use SKU '{sku}'. Reconcile the duplicate "
                "inventory records before linking this product."
            ),
        )
    if legacy_matches:
        item = legacy_matches[0]
        if item.product_id not in (None, product.id):
            raise HTTPException(
                status_code=409,
                detail=f"Inventory SKU '{sku}' is already linked to another product.",
            )
        item.product_id = product.id
        if product.barcode is not None:
            item.barcode = product.barcode
        db.flush()
        return item

    item = InventoryItem(
        tenant_id=tenant_id,
        product_id=product.id,
        sku=sku,
        barcode=product.barcode,
        name=product.name,
        description=product.description,
        unit=getattr(product, "unit", None) or "pcs",
        unit_cost=float(product.unit_cost) if product.unit_cost else None,
        item_type=item_type,
        quantity=0,
        reserved=0,
        is_active=True,
    )
    db.add(item)
    db.flush()
    return item


def list_suppliers(db: Session, tenant_id: int) -> list[Supplier]:
    stmt = select(Supplier).where(
        Supplier.tenant_id == tenant_id,
        or_(Supplier.is_deleted.is_(False), Supplier.is_deleted.is_(None)),
    )
    return list(db.scalars(stmt).all())


def update_supplier_approval(
    db: Session, tenant_id: int, supplier_id: int, approval_status: str
) -> Supplier | None:
    supplier = db.scalars(
        select(Supplier).where(
            Supplier.id == supplier_id, Supplier.tenant_id == tenant_id
        )
    ).first()
    if not supplier:
        return None
    supplier.approval_status = approval_status
    db.commit()
    db.refresh(supplier)
    return supplier


COLUMN_TYPES = {
    "warehouse_name": "VARCHAR(128)",
    "batch_number": "VARCHAR(128)",
    "quantity": "INTEGER DEFAULT 0",
    "reserved": "INTEGER DEFAULT 0",
    "status": "VARCHAR(64) DEFAULT 'in_stock'",
    "customer_name": "VARCHAR(255)",
    "serial_number": "VARCHAR(128)",
    "expiry_date": "VARCHAR(64)",
    "production_date": "VARCHAR(64)",
    "warranty": "VARCHAR(128)",
}


def create_inventory_item(
    db: Session, payload: InventoryItemCreate
) -> InventoryItem:
    data = payload.model_dump()
    valid_keys = {c.name for c in InventoryItem.__table__.columns}
    item_data = {k: v for k, v in data.items() if k in valid_keys and v is not None}
    sku_collision = db.scalars(
        select(InventoryItem).where(
            InventoryItem.tenant_id == payload.tenant_id,
            InventoryItem.sku == payload.sku,
        )
    ).first()
    if sku_collision:
        raise HTTPException(
            status_code=409,
            detail=f"Inventory SKU '{payload.sku}' already exists (item {sku_collision.id}). Update that record instead.",
        )
    product_matches = list(
        db.scalars(
            select(Product).where(
                Product.tenant_id == payload.tenant_id,
                Product.sku == payload.sku,
            )
        ).all()
    )
    if len(product_matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"Multiple products use SKU '{payload.sku}'. Reconcile the product catalog first.",
        )
    if product_matches:
        item_data["product_id"] = product_matches[0].id
        existing_link = db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == payload.tenant_id,
                InventoryItem.product_id == product_matches[0].id,
            )
        ).first()
        if existing_link:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Product SKU '{payload.sku}' already has an inventory record "
                    f"(item {existing_link.id}). Update that item instead of creating a duplicate."
                ),
            )
    
    # Handle user-selected entry date
    entry_date = data.get("date") or data.get("created_at")
    if entry_date:
        try:
            from datetime import datetime
            if isinstance(entry_date, str):
                dt_str = entry_date.strip()
                if len(dt_str) == 10:
                    item_data["created_at"] = datetime.strptime(dt_str, "%Y-%m-%d")
                else:
                    item_data["created_at"] = datetime.fromisoformat(dt_str)
            elif isinstance(entry_date, datetime):
                item_data["created_at"] = entry_date
        except Exception:
            pass

    item = InventoryItem(**item_data)
    db.add(item)
    db.flush()

    # Synchronize initial stock level in the selected warehouse
    if item.quantity is not None and item.quantity >= 0:
        wh = None
        if item.warehouse_name:
            wh = db.scalars(
                select(Warehouse).where(
                    Warehouse.tenant_id == item.tenant_id,
                    Warehouse.name == item.warehouse_name,
                )
            ).first()
        if not wh:
            wh = db.scalars(
                select(Warehouse).where(
                    Warehouse.tenant_id == item.tenant_id,
                    Warehouse.is_primary.is_(True),
                )
            ).first()
        if wh:
            sl = db.scalars(
                select(StockLevel).where(
                    StockLevel.warehouse_id == wh.id,
                    StockLevel.item_id == item.id,
                )
            ).first()
            if not sl:
                db.add(
                    StockLevel(
                        warehouse_id=wh.id,
                        item_id=item.id,
                        quantity=item.quantity,
                    )
                )
            else:
                sl.quantity = item.quantity

    db.commit()
    db.refresh(item)
    if item.product_id:
        from app.services.product_inventory_sync import sync_product_stock_from_inventory_item

        sync_product_stock_from_inventory_item(db, item)
        db.commit()
    return item


def list_inventory_items(
    db: Session,
    tenant_id: int,
    low_stock_only: bool = False,
    item_type: str | None = None,
) -> list[InventoryItem]:
    stmt = select(InventoryItem).where(
        InventoryItem.tenant_id == tenant_id, InventoryItem.is_active
    )
    if item_type:
        stmt = stmt.where(InventoryItem.item_type == item_type)
    items = list(db.scalars(stmt).all())
    if low_stock_only:
        result = []
        for item in items:
            total = (
                db.scalars(
                    select(func.coalesce(func.sum(StockLevel.quantity), 0)).where(
                        StockLevel.item_id == item.id
                    )
                ).first()
                or 0
            )
            if total < item.reorder_level:
                result.append(item)
        return result
    return items


def get_inventory_item(
    db: Session, tenant_id: int, item_id: int
) -> InventoryItem | None:
    return db.scalars(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.tenant_id == tenant_id,
        )
    ).first()


def update_inventory_item(
    db: Session, tenant_id: int, item_id: int, data: dict
) -> InventoryItem | None:
    item = get_inventory_item(db, tenant_id, item_id)
    if not item:
        return None
    valid_keys = {c.name for c in InventoryItem.__table__.columns} - {"id", "tenant_id", "quantity", "reserved"}
    product = None
    new_sku = data.get("sku")
    if new_sku and new_sku != item.sku:
        inventory_collision = db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.sku == new_sku,
                InventoryItem.id != item.id,
            )
        ).first()
        if inventory_collision:
            raise HTTPException(
                status_code=409,
                detail=f"Inventory SKU '{new_sku}' is already assigned to another item.",
            )
    if item.product_id:
        product = db.scalars(
            select(Product).where(
                Product.id == item.product_id,
                Product.tenant_id == tenant_id,
            )
        ).first()
        if product and new_sku and new_sku != product.sku:
            product_collision = db.scalars(
                select(Product).where(
                    Product.tenant_id == tenant_id,
                    Product.sku == new_sku,
                    Product.id != product.id,
                )
            ).first()
            if product_collision:
                raise HTTPException(
                    status_code=409,
                    detail=f"Product SKU '{new_sku}' is already assigned to another product.",
                )
    for key, value in data.items():
        if key in valid_keys and value is not None:
            setattr(item, key, value)
            if product and key in {"sku", "name", "description", "unit", "unit_cost", "category"}:
                setattr(product, key, value)
    db.commit()
    db.refresh(item)
    return item


def delete_inventory_item(db: Session, tenant_id: int, item_id: int) -> bool:
    item = get_inventory_item(db, tenant_id, item_id)
    if not item:
        return False
    item.is_active = False
    db.commit()
    return True


def get_item_by_barcode(db: Session, tenant_id: int, barcode: str) -> InventoryItem | None:
    stmt = select(InventoryItem).where(
        InventoryItem.tenant_id == tenant_id,
        InventoryItem.barcode == barcode,
        InventoryItem.is_active,
    )
    return db.scalars(stmt).first()


def get_stock_by_item(db: Session, item_id: int, tenant_id: int | None = None) -> list[StockLevel]:
    stmt = (
        select(StockLevel)
        .join(InventoryItem, StockLevel.item_id == InventoryItem.id)
        .where(StockLevel.item_id == item_id)
    )
    if tenant_id is not None:
        stmt = stmt.where(InventoryItem.tenant_id == tenant_id)
    return list(db.scalars(stmt).all())


def get_total_stock(db: Session, item_id: int, tenant_id: int | None = None) -> int:
    stmt = (
        select(func.coalesce(func.sum(StockLevel.quantity), 0))
        .join(InventoryItem, StockLevel.item_id == InventoryItem.id)
        .where(StockLevel.item_id == item_id)
    )
    if tenant_id is not None:
        stmt = stmt.where(InventoryItem.tenant_id == tenant_id)
    r = db.scalars(stmt).first()
    return float(r) if r is not None else 0.0


def _sync_cached_item_quantity(db: Session, item: InventoryItem) -> None:
    """Keep the item cache and linked catalog quantity aligned with warehouse stock."""
    from app.services.product_inventory_sync import sync_product_stock_from_inventory_item

    sync_product_stock_from_inventory_item(db, item)


def create_stock_level(db: Session, payload: StockLevelCreate) -> StockLevel:
    sl = StockLevel(**payload.model_dump())
    db.add(sl)
    db.flush()
    item = db.get(InventoryItem, sl.item_id)
    if item:
        _sync_cached_item_quantity(db, item)
    db.commit()
    db.refresh(sl)
    return sl


def update_stock_level(
    db: Session, warehouse_id: int, item_id: int, quantity: float
) -> StockLevel | None:
    stmt = select(StockLevel).where(
        StockLevel.warehouse_id == warehouse_id, StockLevel.item_id == item_id
    )
    sl = db.scalars(stmt).first()
    if sl:
        sl.quantity = quantity
        item = db.get(InventoryItem, item_id)
        if item:
            _sync_cached_item_quantity(db, item)
        db.commit()
        db.refresh(sl)
        return sl
    return None


def record_stock_movement(
    db: Session, payload: StockMovementCreate, *, commit: bool = True
) -> StockMovement:
    """Post a stock movement and update stock_levels. Set commit=False for multi-step workflows."""
    if payload.tenant_id:
        from app.utils.tenant_validation import assert_stock_movement_refs

        assert_stock_movement_refs(
            db, payload.tenant_id, payload.warehouse_id, payload.item_id
        )
    data = payload.model_dump()
    # Normalize types that increase / decrease stock
    raw_type = (data.get("movement_type") or "in").lower()
    if raw_type in ("return", "purchase", "stock_in"):
        effective = "in"
    elif raw_type in ("scrap", "waste", "issue", "material_issue", "stock_out"):
        effective = "out"
    elif raw_type == "adjustment":
        effective = "adjustment"
    else:
        effective = raw_type

    mov = StockMovement(**data)
    db.add(mov)
    stmt = (
        select(StockLevel)
        .where(
            StockLevel.warehouse_id == payload.warehouse_id,
            StockLevel.item_id == payload.item_id,
        )
        .with_for_update()
    )
    sl = db.scalars(stmt).first()
    qty = abs(Decimal(str(payload.quantity)))
    inv_item = db.get(InventoryItem, payload.item_id)
    if sl:
        if effective == "in":
            sl.quantity = Decimal(str(sl.quantity or 0)) + qty
        elif effective == "out":
            from app.core.concurrency import raise_insufficient_stock

            current_qty = Decimal(str(sl.quantity or 0))
            if current_qty < qty:
                try:
                    db.rollback()
                except Exception:
                    pass
                raise_insufficient_stock(
                    float(current_qty),
                    qty,
                    unit=inv_item.unit if inv_item else None,
                )
            sl.quantity = current_qty - qty
        elif effective == "adjustment":
            adjustment = Decimal(str(payload.quantity))
            sl.quantity = max(Decimal("0"), Decimal(str(sl.quantity or 0)) + adjustment)
    elif effective == "in":
        sl = StockLevel(
            warehouse_id=payload.warehouse_id,
            item_id=payload.item_id,
            quantity=qty,
        )
        db.add(sl)
    elif effective == "out":
        from app.core.concurrency import raise_insufficient_stock

        try:
            db.rollback()
        except Exception:
            pass
        raise_insufficient_stock(
            0,
            qty,
            unit=inv_item.unit if inv_item else None,
        )
    elif effective == "adjustment":
        sl = StockLevel(
            warehouse_id=payload.warehouse_id,
            item_id=payload.item_id,
            quantity=max(Decimal("0"), Decimal(str(payload.quantity))),
        )
        db.add(sl)

    if inv_item and effective == "out":
        if inv_item.reserved:
            inv_item.reserved = max(0, int(inv_item.reserved or 0) - qty)

    if inv_item:
        db.flush()
        _sync_cached_item_quantity(db, inv_item)

    try:
        if commit:
            db.commit()
            db.refresh(mov)
            if payload.tenant_id:
                try:
                    from app.services.alert_service import sync_low_stock_alerts

                    sync_low_stock_alerts(db, int(payload.tenant_id), trigger_automation=True)
                except Exception:
                    pass
        else:
            db.flush()
        return mov
    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error recording stock movement for item_id=%s warehouse_id=%s: %s", payload.item_id, payload.warehouse_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while recording stock movement.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error recording stock movement for item_id=%s warehouse_id=%s: %s", payload.item_id, payload.warehouse_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record stock movement.",
        ) from exc


def get_inventory_dashboard(
    db: Session, tenant_id: int, item_type: str | None = None
) -> list[dict]:
    """Items with total stock, reorder status, stock value (single aggregated query)."""
    total_qty = func.coalesce(func.sum(StockLevel.quantity), 0).label("total_quantity")
    stmt = (
        select(InventoryItem, total_qty)
        .outerjoin(StockLevel, StockLevel.item_id == InventoryItem.id)
        .where(InventoryItem.tenant_id == tenant_id, InventoryItem.is_active)
        .group_by(InventoryItem.id)
    )
    if item_type:
        stmt = stmt.where(InventoryItem.item_type == item_type)

    rows = db.execute(stmt).all()
    if not rows:
        return []

    result = []
    for item, total in rows:
        total = int(total or 0)
        stock_value = (item.unit_cost or 0) * total if item.unit_cost else None
        needs_reorder = total < item.reorder_level if item.reorder_level else False
        result.append(
            {
                "id": item.id,
                "sku": item.sku,
                "barcode": item.barcode,
                "name": item.name,
                "unit": item.unit,
                "unit_cost": float(item.unit_cost) if item.unit_cost else None,
                "reorder_level": item.reorder_level,
                "total_quantity": total,
                "stock_value": round(stock_value, 2) if stock_value is not None else None,
                "needs_reorder": needs_reorder,
                "item_type": item.item_type,
            }
        )
    return result


def list_stock_levels_by_warehouse(
    db: Session, warehouse_id: int, tenant_id: int | None = None
) -> list[StockLevel]:
    stmt = (
        select(StockLevel)
        .join(Warehouse, StockLevel.warehouse_id == Warehouse.id)
        .where(StockLevel.warehouse_id == warehouse_id)
    )
    if tenant_id is not None:
        stmt = stmt.where(Warehouse.tenant_id == tenant_id)
    return list(db.scalars(stmt).all())


def list_stock_movements(
    db: Session,
    tenant_id: int,
    item_id: int | None = None,
    *,
    limit: int = 200,
    offset: int = 0,
) -> list[StockMovement]:
    stmt = select(StockMovement).where(StockMovement.tenant_id == tenant_id)
    if item_id is not None:
        stmt = stmt.where(StockMovement.item_id == item_id)
    stmt = (
        stmt.order_by(StockMovement.id.desc())
        .offset(max(0, offset))
        .limit(max(1, min(limit, 500)))
    )
    return list(db.scalars(stmt).all())


def get_default_warehouse(db: Session, tenant_id: int) -> Warehouse:
    wh = db.scalars(
        select(Warehouse).where(
            Warehouse.tenant_id == tenant_id, Warehouse.is_primary.is_(True)
        )
    ).first()
    if wh:
        return wh
    wh = db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).first()
    if wh:
        return wh
    wh = Warehouse(
        tenant_id=tenant_id,
        name="Main Warehouse",
        code="WH-MAIN",
        is_primary=True,
    )
    db.add(wh)
    db.flush()
    return wh


def find_or_create_finished_good_for_product(
    db: Session, tenant_id: int, product: Product
) -> InventoryItem:
    return get_or_create_inventory_item_for_product(
        db, tenant_id, product, item_type="finished_good"
    )
