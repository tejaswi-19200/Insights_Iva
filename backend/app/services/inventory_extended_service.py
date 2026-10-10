import logging
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.models.inventory import (
    InventoryItem,
    StockAdjustment,
    StockLevel,
    StockMovement,
    StockTransfer,
    Supplier,
    Warehouse,
)
from app.schemas.inventory_extended import (
    FinishedGoodListRead,
    InventoryHubRead,
    InventorySummaryRead,
    LedgerEntryRead,
    LedgerSummaryRead,
    MaterialDetailRead,
    MaterialListRead,
    StockAdjustmentCreate,
    StockAdjustmentRead,
    StockTransferCreate,
    StockTransferRead,
)
from app.services.inventory_service import get_total_stock


def _item_status(qty: int, reorder: int) -> str:
    if qty <= 0:
        return "out_of_stock"
    if reorder and qty < reorder:
        return "low_stock"
    return "in_stock"


def _batch_total_stock(db: Session, item_ids: list[int]) -> dict[int, int]:
    if not item_ids:
        return {}
    rows = db.execute(
        select(StockLevel.item_id, func.coalesce(func.sum(StockLevel.quantity), 0)).where(
            StockLevel.item_id.in_(item_ids)
        ).group_by(StockLevel.item_id)
    ).all()
    return {int(row[0]): int(row[1] or 0) for row in rows}


def _batch_primary_warehouse(
    db: Session, tenant_id: int, item_ids: list[int]
) -> dict[int, tuple[Warehouse | None, int]]:
    if not item_ids:
        return {}
    rows = db.execute(
        select(StockLevel.item_id, Warehouse, StockLevel.quantity)
        .join(Warehouse, StockLevel.warehouse_id == Warehouse.id)
        .where(StockLevel.item_id.in_(item_ids), Warehouse.tenant_id == tenant_id)
        .order_by(StockLevel.item_id, StockLevel.quantity.desc())
    ).all()
    result: dict[int, tuple[Warehouse | None, int]] = {}
    for item_id, wh, qty in rows:
        iid = int(item_id)
        if iid not in result:
            result[iid] = (wh, int(qty or 0))
    if len(result) < len(item_ids):
        primary_wh = db.scalars(
            select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.is_primary.is_(True))
        ).first()
        for iid in item_ids:
            if iid not in result:
                result[iid] = (primary_wh, 0)
    return result


def _batch_suppliers(db: Session, supplier_ids: list[int]) -> dict[int, Supplier]:
    if not supplier_ids:
        return {}
    unique_ids = list({int(sid) for sid in supplier_ids if sid})
    rows = db.scalars(select(Supplier).where(Supplier.id.in_(unique_ids))).all()
    return {int(s.id): s for s in rows}


def _primary_warehouse(db: Session, tenant_id: int, item_id: int) -> tuple[Warehouse | None, int]:
    row = db.execute(
        select(Warehouse, StockLevel.quantity)
        .join(StockLevel, StockLevel.warehouse_id == Warehouse.id)
        .where(StockLevel.item_id == item_id, Warehouse.tenant_id == tenant_id)
        .order_by(StockLevel.quantity.desc())
    ).first()
    if row:
        return row[0], int(row[1] or 0)
    wh = db.scalars(
        select(Warehouse).where(Warehouse.tenant_id == tenant_id, Warehouse.is_primary.is_(True))
    ).first()
    return wh, 0


def get_materials_summary(db: Session, tenant_id: int) -> InventorySummaryRead:
    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.is_active.is_(True),
                InventoryItem.item_type == "raw_material",
            )
        ).all()
    )
    available = low = out = expiring = reorder_count = 0
    value = 0.0
    today = date.today()
    item_ids = [item.id for item in items]
    stock_map = _batch_total_stock(db, item_ids)
    for item in items:
        db_qty = stock_map.get(item.id, 0)
        qty = db_qty
        item_cost = float(item.unit_cost or 0)
        value += item_cost * qty

        reorder_lvl = item.reorder_level or 0
        if reorder_lvl > 0 and qty <= reorder_lvl:
            reorder_count += 1

        if qty <= 0 or item.status == "out_of_stock":
            out += 1
        elif (item.reorder_level and qty < item.reorder_level) or item.status == "low_stock":
            low += 1
        else:
            available += 1

        if getattr(item, "expiry_date", None):
            try:
                exp_date = datetime.strptime(item.expiry_date, "%Y-%m-%d").date()
                if 0 <= (exp_date - today).days <= 30:
                    expiring += 1
            except Exception:
                pass

    return InventorySummaryRead(
        total_items=len(items),
        available_stock=available,
        low_stock=low,
        out_of_stock=out,
        stock_value=round(value, 2),
        expiring_soon=expiring,
        reorder_items=reorder_count,
    )


def list_materials_enriched(db: Session, tenant_id: int) -> list[MaterialListRead]:
    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.is_active.is_(True),
                InventoryItem.item_type == "raw_material",
            )
        ).all()
    )
    result = []
    item_ids = [item.id for item in items]
    stock_map = _batch_total_stock(db, item_ids)
    warehouse_map = _batch_primary_warehouse(db, tenant_id, item_ids)
    supplier_ids = [item.supplier_id for item in items if item.supplier_id]
    supplier_map = _batch_suppliers(db, supplier_ids)
    for i, item in enumerate(items):
        db_qty = stock_map.get(item.id, 0)
        qty = db_qty
        wh, wh_qty = warehouse_map.get(item.id, (None, 0))
        wh_name = item.warehouse_name or (wh.name if wh else "—")
        batch_no = item.batch_number or f"BATCH-{item.id:04d}"
        reserved = min(max(0, item.reserved), qty) if item.reserved is not None else 0
        available = max(qty - reserved, 0)
        item_status = _item_status(qty, item.reorder_level)
        supplier = supplier_map.get(item.supplier_id) if item.supplier_id else None
        result.append(
            MaterialListRead(
                id=item.id,
                sku=item.sku,
                name=item.name,
                category=item.category or "General",
                warehouse_name=wh_name,
                batch_number=batch_no,
                quantity=qty,
                reserved=reserved,
                available=available,
                unit=item.unit,
                reorder_level=item.reorder_level,
                unit_cost=float(item.unit_cost) if item.unit_cost else None,
                stock_value=round((float(item.unit_cost or 0)) * qty, 2) if qty else 0,
                status=item_status,
                barcode=item.barcode,
                vendor_name=supplier.name if supplier else None,
                item_type=item.item_type,
                created_at=item.created_at.isoformat() if getattr(item, "created_at", None) else None,
            )
        )
    return result


def get_material_detail(db: Session, tenant_id: int, item_id: int) -> MaterialDetailRead | None:
    item = db.scalars(
        select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant_id)
    ).first()
    if not item:
        return None
    supplier = db.get(Supplier, item.supplier_id) if item.supplier_id else None
    movements = list(
        db.scalars(
            select(StockMovement)
            .where(StockMovement.item_id == item.id, StockMovement.tenant_id == tenant_id)
            .order_by(StockMovement.id.desc())
            .limit(20)
        ).all()
    )
    wh_map = {w.id: w.name for w in db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all()}
    stock_history = [
        {
            "date": m.created_at.isoformat() if m.created_at else None,
            "warehouse": wh_map.get(m.warehouse_id, "—"),
            "type": m.movement_type,
            "quantity": m.quantity,
            "reference": m.reference,
        }
        for m in movements
    ]

    # Query actual purchase history from PurchaseOrderLine and Stock IN movements
    from app.models.procurement import PurchaseOrder, PurchaseOrderLine

    po_lines = list(
        db.scalars(
            select(PurchaseOrderLine)
            .join(PurchaseOrder, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
            .where(PurchaseOrderLine.item_id == item.id, PurchaseOrder.tenant_id == tenant_id)
            .order_by(PurchaseOrder.id.desc())
            .limit(10)
        ).all()
    )
    purchase_history = [
        {
            "po": pol.purchase_order.po_number if pol.purchase_order else f"PO-{pol.purchase_order_id}",
            "qty": float(pol.quantity),
            "date": pol.purchase_order.order_date.isoformat() if pol.purchase_order and pol.purchase_order.order_date else (pol.created_at.isoformat() if pol.created_at else None),
        }
        for pol in po_lines
    ]
    if not purchase_history:
        in_movements = [m for m in movements if m.movement_type in ("in", "grn", "purchase", "receipt")]
        purchase_history = [
            {
                "po": m.reference or f"PO-MOV-{m.id}",
                "qty": float(m.quantity),
                "date": m.created_at.isoformat() if m.created_at else None,
            }
            for m in in_movements
        ]

    # Query actual consumption history from Stock OUT / consumption movements
    out_movements = [m for m in movements if m.movement_type in ("out", "consumption", "issue", "wo_issue")]
    consumption_history = [
        {
            "wo": m.reference or f"WO-MOV-{m.id}",
            "qty": float(abs(m.quantity)),
            "date": m.created_at.isoformat() if m.created_at else None,
        }
        for m in out_movements
    ]

    batches = [{"batch": item.batch_number or f"BATCH-{item.id:04d}", "qty": get_total_stock(db, item.id)}]

    from app.services.inventory_item_photo import get_primary_photo_file_id

    return MaterialDetailRead(
        id=item.id,
        photo_file_id=get_primary_photo_file_id(db, tenant_id, item.id),
        sku=item.sku,
        name=item.name,
        barcode=item.barcode,
        category=item.category,
        unit=item.unit,
        unit_cost=float(item.unit_cost) if item.unit_cost else None,
        reorder_level=item.reorder_level,
        description=item.description,
        vendor_name=supplier.name if supplier else None,
        vendor_contact=supplier.contact if supplier else None,
        vendor_email=supplier.email if supplier else None,
        stock_history=stock_history,
        purchase_history=purchase_history,
        consumption_history=consumption_history,
        batches=batches,
    )


def get_finished_goods_summary(db: Session, tenant_id: int) -> dict:
    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.item_type == "finished_good",
                InventoryItem.is_active.is_(True),
            )
        ).all()
    )
    total = len(items)
    avail_count = reserved_count = dispatch = damaged = 0
    value = 0.0
    for item in items:
        db_qty = get_total_stock(db, item.id)
        qty = db_qty
        value += float(item.unit_cost or 0) * qty
        item_res = min(max(0, item.reserved), qty) if item.reserved is not None else 0
        avail = max(qty - item_res, 0)

        if qty <= 0 or item.status == "damaged":
            damaged += 1
        else:
            if avail > 0:
                avail_count += 1
            if item_res > 0:
                reserved_count += 1
            if item.status == "ready" or avail > 0:
                dispatch += 1

    return {
        "total_products": total,
        "available": avail_count,
        "reserved": reserved_count,
        "ready_to_dispatch": dispatch,
        "damaged": damaged,
        "stock_value": round(value, 2),
    }


def list_finished_goods_enriched(db: Session, tenant_id: int) -> list[FinishedGoodListRead]:
    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.item_type == "finished_good",
                InventoryItem.is_active.is_(True),
            )
        ).all()
    )
    result = []
    item_ids = [item.id for item in items]
    stock_map = _batch_total_stock(db, item_ids)
    warehouse_map = _batch_primary_warehouse(db, tenant_id, item_ids)
    for i, item in enumerate(items):
        db_qty = stock_map.get(item.id, 0)
        qty = db_qty
        wh, _ = warehouse_map.get(item.id, (None, 0))
        wh_name = item.warehouse_name or (wh.name if wh else "—")
        reserved = min(max(0, item.reserved), qty) if item.reserved is not None else 0
        available = max(qty - reserved, 0)
        item_status = _item_status(qty, item.reorder_level)
        result.append(
            FinishedGoodListRead(
                id=item.id,
                sku=item.sku,
                name=item.name,
                batch_number=item.batch_number,
                quantity=qty,
                reserved=reserved,
                available=available,
                warehouse_name=wh_name,
                customer_name=item.customer_name,
                status=item_status,
                production_date=item.production_date,
                expiry_date=item.expiry_date,
                warranty=item.warranty,
                serial_number=item.serial_number,
                qr_code=f"QR-{item.sku}" if item.sku else None,
                unit_cost=float(item.unit_cost) if item.unit_cost else None,
                stock_value=round((float(item.unit_cost or 0)) * qty, 2) if qty else 0,
                created_at=item.created_at.isoformat() if getattr(item, "created_at", None) else None,
            )
        )
    return result


def list_transfers(db: Session, tenant_id: int) -> list[StockTransferRead]:
    transfers = list(
        db.scalars(
            select(StockTransfer).where(StockTransfer.tenant_id == tenant_id).order_by(StockTransfer.id.desc())
        ).all()
    )
    result = []
    for t in transfers:
        from_wh = db.get(Warehouse, t.from_warehouse_id)
        to_wh = db.get(Warehouse, t.to_warehouse_id)
        item = db.get(InventoryItem, t.item_id)
        result.append(
            StockTransferRead(
                id=t.id,
                transfer_number=t.transfer_number,
                transfer_date=t.transfer_date.isoformat() if t.transfer_date else None,
                from_warehouse=from_wh.name if from_wh else "—",
                to_warehouse=to_wh.name if to_wh else "—",
                item_name=item.name if item else "—",
                batch_number=t.batch_number,
                quantity=t.quantity,
                status=t.status,
                approved_by=t.approved_by,
                vehicle=t.vehicle,
                driver=t.driver,
            )
        )
    return result


def create_transfer(db: Session, tenant_id: int, payload: StockTransferCreate) -> StockTransfer:
    count = int(
        db.scalar(select(func.count(StockTransfer.id)).where(StockTransfer.tenant_id == tenant_id)) or 0
    )
    t_date = date.today()
    if payload.transfer_date and payload.transfer_date.strip():
        try:
            t_date = date.fromisoformat(payload.transfer_date.strip())
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid transfer_date format '{payload.transfer_date}'. Expected format: YYYY-MM-DD.",
            ) from exc

    t_num = payload.transfer_number.strip() if payload.transfer_number and payload.transfer_number.strip() else f"TRF-{date.today().year}-{count + 1:04d}"

    transfer = StockTransfer(
        tenant_id=tenant_id,
        transfer_number=t_num,
        from_warehouse_id=payload.from_warehouse_id,
        to_warehouse_id=payload.to_warehouse_id,
        item_id=payload.item_id,
        batch_number=payload.batch_number,
        quantity=payload.quantity,
        vehicle=payload.vehicle,
        driver=payload.driver,
        notes=payload.notes,
        status="pending_approval",
        transfer_date=t_date,
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer


def update_transfer_status(
    db: Session, tenant_id: int, transfer_id: int, new_status: str, approved_by: str | None = None
) -> StockTransfer | None:
    transfer = db.scalars(
        select(StockTransfer).where(StockTransfer.id == transfer_id, StockTransfer.tenant_id == tenant_id)
    ).first()
    if not transfer:
        return None

    previous_status = transfer.status
    transfer.status = new_status
    if approved_by:
        transfer.approved_by = approved_by
    elif new_status in ["approved", "in_transit", "completed", "received"] and not transfer.approved_by:
        transfer.approved_by = "Store Manager"

    if new_status in ["completed", "received"] and previous_status not in ["completed", "received"]:
        from_sl = db.scalars(
            select(StockLevel).where(
                StockLevel.warehouse_id == transfer.from_warehouse_id,
                StockLevel.item_id == transfer.item_id,
            )
        ).first()
        available_qty = from_sl.quantity if from_sl else 0
        if available_qty < transfer.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient source stock for transfer. Required: {transfer.quantity}, Available: {available_qty}.",
            )

        from_sl.quantity -= transfer.quantity

        to_sl = db.scalars(
            select(StockLevel).where(
                StockLevel.warehouse_id == transfer.to_warehouse_id,
                StockLevel.item_id == transfer.item_id,
            )
        ).first()
        if to_sl:
            to_sl.quantity += transfer.quantity
        else:
            db.add(
                StockLevel(
                    warehouse_id=transfer.to_warehouse_id,
                    item_id=transfer.item_id,
                    quantity=transfer.quantity,
                )
            )

        db.add(
            StockMovement(
                tenant_id=tenant_id,
                warehouse_id=transfer.from_warehouse_id,
                item_id=transfer.item_id,
                quantity=-transfer.quantity,
                movement_type="out",
                reference=transfer.transfer_number,
            )
        )

        db.add(
            StockMovement(
                tenant_id=tenant_id,
                warehouse_id=transfer.to_warehouse_id,
                item_id=transfer.item_id,
                quantity=transfer.quantity,
                movement_type="in",
                reference=transfer.transfer_number,
            )
        )

        from app.services.inventory_service import _sync_cached_item_quantity

        inventory_item = db.get(InventoryItem, transfer.item_id)
        if inventory_item and inventory_item.tenant_id == tenant_id:
            _sync_cached_item_quantity(db, inventory_item)

    try:
        db.commit()
        db.refresh(transfer)
        return transfer
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Database error updating transfer status transfer_id=%s tenant_id=%s: %s", transfer_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while updating transfer status.",
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error updating transfer status transfer_id=%s tenant_id=%s: %s", transfer_id, tenant_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update transfer status.",
        ) from exc



def list_adjustments(db: Session, tenant_id: int) -> list[StockAdjustmentRead]:
    rows = list(
        db.scalars(
            select(StockAdjustment).where(StockAdjustment.tenant_id == tenant_id).order_by(StockAdjustment.id.desc())
        ).all()
    )
    result = []
    for a in rows:
        wh = db.get(Warehouse, a.warehouse_id)
        item = db.get(InventoryItem, a.item_id)
        result.append(
            StockAdjustmentRead(
                id=a.id,
                adjustment_date=a.adjustment_date.isoformat() if a.adjustment_date else None,
                warehouse_name=wh.name if wh else "—",
                item_name=item.name if item else "—",
                old_qty=a.old_qty,
                new_qty=a.new_qty,
                difference=a.difference,
                reason=a.reason,
                status=a.status,
                approved_by=a.approved_by,
            )
        )
    return result


def create_adjustment(db: Session, tenant_id: int, payload: StockAdjustmentCreate) -> StockAdjustment:
    sl = db.scalars(
        select(StockLevel).where(
            StockLevel.warehouse_id == payload.warehouse_id,
            StockLevel.item_id == payload.item_id,
        )
    ).first()
    old_qty = sl.quantity if sl else 0
    diff = payload.new_qty - old_qty
    a_date = date.today()
    if payload.adjustment_date and payload.adjustment_date.strip():
        try:
            a_date = date.fromisoformat(payload.adjustment_date.strip())
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid adjustment_date format '{payload.adjustment_date}'. Expected format: YYYY-MM-DD.",
            ) from exc

    adj = StockAdjustment(
        tenant_id=tenant_id,
        warehouse_id=payload.warehouse_id,
        item_id=payload.item_id,
        old_qty=old_qty,
        new_qty=payload.new_qty,
        difference=diff,
        reason=payload.reason,
        status="pending",
        adjustment_date=a_date,
    )
    db.add(adj)
    db.commit()
    db.refresh(adj)
    return adj


def update_adjustment_status(
    db: Session, tenant_id: int, adjustment_id: int, new_status: str, approved_by: str | None = None
) -> StockAdjustment | None:
    adj = db.scalars(
        select(StockAdjustment).where(StockAdjustment.id == adjustment_id, StockAdjustment.tenant_id == tenant_id)
    ).first()
    if not adj:
        return None

    previous_status = adj.status
    adj.status = new_status
    if approved_by:
        adj.approved_by = approved_by
    elif new_status == "approved" and not adj.approved_by:
        adj.approved_by = "Store Manager"

    if new_status == "approved" and previous_status != "approved":
        sl = db.scalars(
            select(StockLevel).where(
                StockLevel.warehouse_id == adj.warehouse_id,
                StockLevel.item_id == adj.item_id,
            )
        ).first()
        if sl:
            sl.quantity = max(0, adj.new_qty)
        elif adj.new_qty > 0:
            db.add(
                StockLevel(
                    warehouse_id=adj.warehouse_id,
                    item_id=adj.item_id,
                    quantity=adj.new_qty,
                )
            )

        db.add(
            StockMovement(
                tenant_id=tenant_id,
                warehouse_id=adj.warehouse_id,
                item_id=adj.item_id,
                quantity=adj.difference,
                movement_type="adjustment",
                reference=f"ADJ-{adj.adjustment_date.isoformat() if adj.adjustment_date else date.today().isoformat()}",
            )
        )

        from app.services.inventory_service import _sync_cached_item_quantity

        inventory_item = db.get(InventoryItem, adj.item_id)
        if inventory_item and inventory_item.tenant_id == tenant_id:
            _sync_cached_item_quantity(db, inventory_item)

    db.commit()
    db.refresh(adj)
    return adj



def get_ledger_summary(db: Session, tenant_id: int) -> LedgerSummaryRead:
    movements = list(
        db.scalars(select(StockMovement).where(StockMovement.tenant_id == tenant_id)).all()
    )
    transfers = int(
        db.scalar(select(func.count(StockTransfer.id)).where(StockTransfer.tenant_id == tenant_id)) or 0
    )
    adjustments = int(
        db.scalar(select(func.count(StockAdjustment.id)).where(StockAdjustment.tenant_id == tenant_id)) or 0
    )
    stock_in = sum(m.quantity for m in movements if m.movement_type == "in")
    stock_out = sum(abs(m.quantity) for m in movements if m.movement_type == "out")
    dash = get_materials_summary(db, tenant_id)
    return LedgerSummaryRead(
        total_transactions=len(movements) + transfers + adjustments,
        stock_in=stock_in,
        stock_out=stock_out,
        transfers=transfers,
        adjustments=adjustments,
        current_stock_value=dash.stock_value,
    )


def list_ledger_entries(
    db: Session, tenant_id: int, item_id: int | None = None, limit: int | None = None
) -> list[LedgerEntryRead]:
    stmt = (
        select(StockMovement)
        .where(StockMovement.tenant_id == tenant_id)
        .order_by(StockMovement.id.asc())
    )
    if item_id:
        stmt = stmt.where(StockMovement.item_id == item_id)
    all_movements = list(db.scalars(stmt).all())

    wh_map = {w.id: w.name for w in db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all()}
    items = list(db.scalars(select(InventoryItem).where(InventoryItem.tenant_id == tenant_id)).all())
    item_map = {item.id: item.name for item in items}
    unit_map = {item.id: (item.unit or "pcs") for item in items}
    balance_tracker: dict[int, float] = {}
    entries = []
    for m in all_movements:
        curr_bal = balance_tracker.get(m.item_id, 0.0)
        qty_in = float(m.quantity) if m.movement_type == "in" else 0.0
        qty_out = float(abs(m.quantity)) if m.movement_type in ("out", "adjustment") and m.quantity < 0 else (
            float(m.quantity) if m.movement_type == "out" else 0.0
        )
        if m.movement_type == "adjustment" and m.quantity > 0:
            qty_in = float(m.quantity)
            qty_out = 0.0

        new_bal = curr_bal + qty_in - qty_out
        balance_tracker[m.item_id] = new_bal
        entries.append(
            LedgerEntryRead(
                id=m.id,
                date=m.created_at.isoformat() if m.created_at else None,
                transaction=m.movement_type,
                warehouse_name=wh_map.get(m.warehouse_id, "—"),
                item_name=item_map.get(m.item_id, "—"),
                unit=unit_map.get(m.item_id, "pcs"),
                batch_number=m.batch_number,
                qty_in=qty_in,
                qty_out=qty_out,
                # Legacy movements can begin with an outbound transaction
                # before an opening balance exists. Keep the API response
                # valid while the ledger reports the signed movement itself.
                balance=max(0.0, new_bal),
                user_name=m.created_by or "System",
                reference=m.reference,
            )
        )
    entries.reverse()
    if limit and limit > 0:
        return entries[:limit]
    return entries


def get_inventory_hub(db: Session, tenant_id: int) -> InventoryHubRead:
    mat_sum = get_materials_summary(db, tenant_id)
    fg_sum = get_finished_goods_summary(db, tenant_id)
    warehouses = list(db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all())
    wh_stock = []
    for wh in warehouses[:5]:
        levels = list(db.scalars(
            select(StockLevel)
            .join(InventoryItem, StockLevel.item_id == InventoryItem.id)
            .where(StockLevel.warehouse_id == wh.id, InventoryItem.tenant_id == tenant_id)
        ).all())
        qty = sum(l.quantity for l in levels)
        wh_stock.append({"name": wh.name, "quantity": qty})
    materials = list_materials_enriched(db, tenant_id)
    top = sorted(materials, key=lambda m: m.quantity, reverse=True)[:10]
    from datetime import date
    from app.models.inventory import StockMovement

    todays_tx = 0
    try:
        todays_tx = int(
            db.scalar(
                select(func.count(StockMovement.id)).where(
                    StockMovement.tenant_id == tenant_id,
                    func.date(StockMovement.created_at) == date.today(),
                )
            )
            or 0
        )
    except Exception:
        todays_tx = 0

    return InventoryHubRead(
        total_inventory_value=mat_sum.stock_value + fg_sum["stock_value"],
        low_stock_items=mat_sum.low_stock,
        dead_stock=sum(1 for m in materials if m.quantity == 0),
        fast_moving=sum(1 for m in materials if m.quantity > 0 and getattr(m, "status", "") != "slow"),
        slow_moving=sum(1 for m in materials if getattr(m, "status", "") in ("slow", "slow_moving")),
        todays_transactions=todays_tx,
        warehouse_stock=wh_stock,
        top_materials=[{"name": m.name, "qty": m.quantity} for m in top[:10]],
    )
