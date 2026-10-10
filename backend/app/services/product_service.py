from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.bom import BillOfMaterial
from app.models.inventory import VendorProduct
from app.models.product import Product, ProductStockEvent
from app.models.production import Batch, DailyProductionReport, ProductionOrder, WorkOrder
from app.models.sales import SalesOrder, SalesOrderLine
from app.schemas.product import BomItemCreate, ProductCreate, ProductUpdate


def _apply_product_list_filters(
    stmt,
    db: Session,
    tenant_id: int,
    *,
    category: str | None = None,
    category_id: int | None = None,
    q: str | None = None,
):
    from app.models.product import InventoryCategory

    resolved_category = (category or "").strip()
    if category_id is not None and category_id > 0:
        cat_row = db.scalars(
            select(InventoryCategory).where(
                InventoryCategory.id == category_id,
                InventoryCategory.tenant_id == tenant_id,
            )
        ).first()
        if cat_row:
            resolved_category = cat_row.name
    elif category_id == 0:
        resolved_category = "No Category"

    if resolved_category:
        if resolved_category.lower() == "no category":
            stmt = stmt.where(
                or_(
                    Product.category == "No Category",
                    Product.category == "",
                    Product.category.is_(None),
                )
            )
        else:
            stmt = stmt.where(func.lower(Product.category) == resolved_category.lower())

    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(needle),
                Product.sku.ilike(needle),
                Product.description.ilike(needle),
                Product.hsn_code.ilike(needle),
                Product.category.ilike(needle),
            )
        )
    return stmt


def list_products(
    db: Session,
    tenant_id: int,
    *,
    category: str | None = None,
    category_id: int | None = None,
    q: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> list[Product]:
    stmt = select(Product).where(Product.tenant_id == tenant_id)
    stmt = _apply_product_list_filters(
        stmt, db, tenant_id, category=category, category_id=category_id, q=q
    )
    stmt = (
        stmt.order_by(Product.id.desc())
        .offset(max(0, offset))
        .limit(max(1, min(limit, 2000)))
    )
    return list(db.scalars(stmt).all())


def get_product(db: Session, tenant_id: int, product_id: int) -> Product | None:
    return db.scalars(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    ).first()


def _assert_no_product_duplicates(
    db: Session,
    tenant_id: int,
    *,
    name: str | None = None,
    sku: str | None = None,
    exclude_id: int | None = None,
) -> None:
    if name and name.strip():
        clean_name = name.strip()
        import re
        if not re.search(r"[a-zA-Z0-9]", clean_name):
            raise HTTPException(
                status_code=400,
                detail="Product Name must contain at least one letter or number and cannot consist only of special characters.",
            )
        q = select(Product).where(
            Product.tenant_id == tenant_id,
            func.lower(Product.name) == clean_name.lower(),
        )
        if exclude_id:
            q = q.where(Product.id != exclude_id)
        if db.scalars(q).first():
            raise HTTPException(
                status_code=400,
                detail=f"Product Name '{clean_name}' already exists. Duplicate product names are not allowed.",
            )
    if sku and sku.strip():
        clean_sku = sku.strip()
        q = select(Product).where(
            Product.tenant_id == tenant_id,
            func.lower(Product.sku) == clean_sku.lower(),
        )
        if exclude_id:
            q = q.where(Product.id != exclude_id)
        if db.scalars(q).first():
            raise HTTPException(status_code=409, detail=f"Product SKU '{clean_sku}' is already in use.")


def create_product(db: Session, payload: ProductCreate) -> Product:
    if payload.unit_cost is not None and payload.unit_cost < 0:
        raise HTTPException(status_code=400, detail="Purchase Price cannot be negative.")
    if payload.unit_price is not None and payload.unit_price < 0:
        raise HTTPException(status_code=400, detail="Selling price cannot be negative.")
    if payload.current_stock is not None and payload.current_stock < 0:
        raise HTTPException(status_code=400, detail="Current Stock cannot be negative.")
    if (
        payload.unit_cost is not None
        and payload.unit_price is not None
        and payload.unit_price < payload.unit_cost
    ):
        raise HTTPException(
            status_code=400,
            detail="Selling Price cannot be lower than Purchase Price.",
        )
    _assert_no_product_duplicates(
        db, payload.tenant_id, name=payload.name, sku=payload.sku
    )
    product = Product(**payload.model_dump())
    opening_stock = product.current_stock or 0
    has_existing_inventory = False
    db.add(product)
    db.flush()
    from app.services.sku_service import assign_product_sku

    assign_product_sku(db, product)
    db.flush()
    if product.sku:
        from app.models.inventory import InventoryItem

        matches = list(
            db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == payload.tenant_id,
                    InventoryItem.sku == product.sku,
                )
            ).all()
        )
        if len(matches) > 1:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Multiple inventory records use SKU '{product.sku}'. "
                    "Reconcile them before adding this product to the catalog."
                ),
            )
        if matches:
            item = matches[0]
            if item.product_id not in (None, product.id):
                db.rollback()
                raise HTTPException(
                    status_code=409,
                    detail=f"Inventory SKU '{product.sku}' is already linked to another product.",
                )
            item.product_id = product.id
            if product.barcode is not None:
                item.barcode = product.barcode
            has_existing_inventory = True
    from app.services.product_inventory_sync import (
        ensure_product_inventory_item,
        set_product_stock_in_primary_warehouse,
        sync_product_stock_from_inventory_item,
    )

    inv_item = ensure_product_inventory_item(db, payload.tenant_id, product)
    if opening_stock and not has_existing_inventory and not inv_item.stock_levels:
        set_product_stock_in_primary_warehouse(
            db, payload.tenant_id, product, opening_stock
        )
    else:
        sync_product_stock_from_inventory_item(db, inv_item)
    db.commit()
    db.refresh(product)
    return product


def update_product(
    db: Session, tenant_id: int, product_id: int, payload: ProductUpdate
) -> Product | None:
    if payload.unit_cost is not None and payload.unit_cost < 0:
        raise HTTPException(status_code=400, detail="Purchase Price cannot be negative.")
    if payload.unit_price is not None and payload.unit_price < 0:
        raise HTTPException(status_code=400, detail="Selling price cannot be negative.")
    if payload.current_stock is not None and payload.current_stock < 0:
        raise HTTPException(status_code=400, detail="Current Stock cannot be negative.")
    if (
        payload.unit_cost is not None
        and payload.unit_price is not None
        and payload.unit_price < payload.unit_cost
    ):
        raise HTTPException(
            status_code=400,
            detail="Selling Price cannot be lower than Purchase Price.",
        )
    product = get_product(db, tenant_id, product_id)
    if not product:
        return None
    data = payload.model_dump(exclude_unset=True)
    name = data.get("name", product.name)
    sku = data.get("sku", product.sku)
    _assert_no_product_duplicates(
        db, tenant_id, name=name, sku=sku, exclude_id=product_id
    )
    for field, value in data.items():
        if field == "current_stock":
            continue
        setattr(product, field, value)
    from app.models.inventory import InventoryItem

    linked_item = db.scalars(
        select(InventoryItem).where(
            InventoryItem.tenant_id == tenant_id,
            InventoryItem.product_id == product.id,
        )
    ).first()
    if "current_stock" in data:
        from app.services.product_inventory_sync import set_product_stock_target

        target_stock = Decimal(str(data["current_stock"] or 0))
        set_product_stock_target(
            db,
            tenant_id,
            product,
            target_stock,
            reference="CATALOG-STOCK-EDIT",
        )
        linked_item = db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.product_id == product.id,
            )
        ).first()
    elif linked_item:
        from app.services.product_inventory_sync import sync_product_stock_from_inventory_item

        sync_product_stock_from_inventory_item(db, linked_item)
    if linked_item:
        if "sku" in data:
            collision = db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku == data["sku"],
                    InventoryItem.id != linked_item.id,
                )
            ).first()
            if collision:
                db.rollback()
                raise HTTPException(
                    status_code=409,
                    detail=f"Inventory SKU '{data['sku']}' is already in use by another item.",
                )
            linked_item.sku = data["sku"]
        for product_field, inventory_field in (
            ("name", "name"),
            ("description", "description"),
            ("unit", "unit"),
            ("unit_cost", "unit_cost"),
            ("category", "category"),
            ("barcode", "barcode"),
        ):
            if product_field in data:
                setattr(linked_item, inventory_field, data[product_field])
    db.commit()
    db.refresh(product)
    return product


def _delete_related_for_product(db: Session, tenant_id: int, product_id: int) -> None:
    """Remove FK dependents so a product row can be deleted when ON DELETE CASCADE is absent."""
    from app.models.product_vendor_pricing import ProductVendorPricing

    for event in db.scalars(
        select(ProductStockEvent).where(
            ProductStockEvent.product_id == product_id,
            ProductStockEvent.tenant_id == tenant_id,
        )
    ).all():
        db.delete(event)

    for pvp in db.scalars(
        select(ProductVendorPricing).where(
            ProductVendorPricing.product_id == product_id,
            ProductVendorPricing.tenant_id == tenant_id,
        )
    ).all():
        db.delete(pvp)

    for bom in db.scalars(
        select(BillOfMaterial).where(
            BillOfMaterial.tenant_id == tenant_id,
            or_(
                BillOfMaterial.product_id == product_id,
                BillOfMaterial.component_product_id == product_id,
            ),
        )
    ).all():
        db.delete(bom)

    for vp in db.scalars(
        select(VendorProduct).where(
            VendorProduct.product_id == product_id,
            VendorProduct.tenant_id == tenant_id,
        )
    ).all():
        db.delete(vp)

    for line in db.scalars(
        select(SalesOrderLine)
        .join(SalesOrderLine.sales_order)
        .where(
            SalesOrderLine.product_id == product_id,
            SalesOrder.tenant_id == tenant_id,
        )
    ).all():
        line.product_id = None

    for report in db.scalars(
        select(DailyProductionReport).where(
            DailyProductionReport.product_id == product_id,
            DailyProductionReport.tenant_id == tenant_id,
        )
    ).all():
        db.delete(report)

    production_orders = list(
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.product_id == product_id,
                ProductionOrder.tenant_id == tenant_id,
            )
        ).all()
    )
    for po in production_orders:
        work_orders = list(
            db.scalars(
                select(WorkOrder).where(
                    WorkOrder.production_order_id == po.id,
                    WorkOrder.tenant_id == tenant_id,
                )
            ).all()
        )
        for wo in work_orders:
            for batch in db.scalars(
                select(Batch).where(
                    Batch.work_order_id == wo.id,
                    Batch.tenant_id == tenant_id,
                )
            ).all():
                db.delete(batch)
            for report in db.scalars(
                select(DailyProductionReport).where(
                    DailyProductionReport.work_order_id == wo.id,
                    DailyProductionReport.tenant_id == tenant_id,
                )
            ).all():
                db.delete(report)
            db.delete(wo)
        db.delete(po)

    db.flush()


def delete_product(db: Session, tenant_id: int, product_id: int) -> bool:
    product = get_product(db, tenant_id, product_id)
    if not product:
        return False
    sku = (product.sku or "").strip()
    try:
        _delete_related_for_product(db, tenant_id, product_id)
        db.delete(product)
        if sku:
            from app.models.inventory import InventoryItem

            for inv in db.scalars(
                select(InventoryItem).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku == sku,
                    InventoryItem.is_active.is_(True),
                )
            ).all():
                inv.is_active = False
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError(
            "Product is linked to other records and cannot be deleted."
        ) from exc
    return True


def list_bom(db: Session, tenant_id: int, product_id: int) -> list[BillOfMaterial]:
    stmt = select(BillOfMaterial).where(
        BillOfMaterial.tenant_id == tenant_id,
        BillOfMaterial.product_id == product_id,
    )
    return list(db.scalars(stmt).all())


def add_bom_item(db: Session, payload: BomItemCreate) -> BillOfMaterial:
    item = BillOfMaterial(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_bom_item(db: Session, tenant_id: int, bom_id: int) -> bool:
    item = db.scalars(
        select(BillOfMaterial).where(
            BillOfMaterial.id == bom_id, BillOfMaterial.tenant_id == tenant_id
        )
    ).first()
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True
