"""Manufacturing store workflow: stock in, material request/issue, return, consume."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.inventory import (
    InventoryItem,
    StockLevel,
    StockMovement,
    StockTransfer,
    StoreIssueRequest,
    Warehouse,
)
from app.models.product import Product, ProductStockEvent
from app.models.procurement import MaterialRequest, MaterialRequestLine
from app.schemas.inventory import StockMovementCreate
from app.schemas.store_workflow import (
    PendingInventoryCheckOrder,
    PurchaseRequisitionCreated,
    PurchaseRequisitionFromLowStock,
    StoreConsumeCreate,
    StoreDashboardActivityRow,
    StoreDashboardLowStockItem,
    StoreDashboardMaterialCheckRow,
    StoreDashboardMaterialRequestRow,
    StoreDashboardRead,
    StoreDashboardTodayMovement,
    StoreDashboardTransferRow,
    StoreIssueRequestCreate,
    StoreIssueRequestRead,
    StoreReturnCreate,
    StoreReturnRead,
    StoreStockInCreate,
    StoreStockInRead,
)
from app.services.inventory_service import get_total_stock, record_stock_movement
from app.services.procurement_service import next_material_request_number

_PENDING_TRANSFER_STATUSES = ("draft", "pending", "pending_approval", "in_transit")
_STOCK_IN_TYPES = ("in", "return", "purchase")
_STOCK_OUT_TYPES = ("out", "issue", "material_issue")
_MR_CLOSED_STATUSES = ("cancelled", "converted", "fulfilled", "rejected")


def _load_recent_stock_activity(
    db: Session, tenant_id: int, limit: int = 8
) -> list[StoreDashboardActivityRow]:
    """Recent activity across catalog stock events and inventory stock movements."""
    events = list(
        db.scalars(
            select(ProductStockEvent)
            .where(ProductStockEvent.tenant_id == tenant_id)
            .order_by(ProductStockEvent.id.desc())
            .limit(limit)
        ).all()
    )
    product_ids = {e.product_id for e in events}
    name_map: dict[int, str] = {}
    if product_ids:
        for product in db.scalars(
            select(Product).where(Product.tenant_id == tenant_id, Product.id.in_(product_ids))
        ).all():
            name_map[product.id] = product.name

    activity: list[StoreDashboardActivityRow] = [
        StoreDashboardActivityRow(
            id=-event.id,
            occurred_at=event.created_at,
            activity_label=(event.activity or "Stock Activity").strip(),
            item_name=name_map.get(event.product_id, "—"),
            quantity=abs(float(event.change_qty or 0)),
            movement_type="",
        )
        for event in events
    ]

    movements = list(
        db.scalars(
            select(StockMovement)
            .where(StockMovement.tenant_id == tenant_id)
            .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
            .limit(limit)
        ).all()
    )
    item_ids = {movement.item_id for movement in movements}
    inventory_item_names: dict[int, str] = {}
    if item_ids:
        for item in db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.id.in_(item_ids),
            )
        ).all():
            inventory_item_names[item.id] = item.name

    activity.extend(
        StoreDashboardActivityRow(
            id=movement.id,
            occurred_at=movement.created_at,
            activity_label=_movement_activity_label(movement.movement_type),
            item_name=inventory_item_names.get(movement.item_id, "—"),
            quantity=abs(float(movement.quantity or 0)),
            movement_type=movement.movement_type or "",
        )
        for movement in movements
    )
    activity.sort(
        key=lambda row: row.occurred_at.isoformat() if row.occurred_at else "",
        reverse=True,
    )
    return activity[:limit]


def _movement_activity_label(movement_type: str | None) -> str:
    mt = (movement_type or "").lower()
    labels = {
        "in": "Stock In",
        "purchase": "Stock In",
        "return": "Material Return",
        "out": "Stock Out",
        "issue": "Material Issue",
        "material_issue": "Material Issue",
        "transfer": "Transfer",
        "adjustment": "Adjustment",
        "production": "Stock In",
        "sales": "Stock Out",
        "scrap": "Stock Out",
    }
    return labels.get(mt, mt.replace("_", " ").title() if mt else "Activity")


def _material_check_summary(row: dict) -> str:
    name = row.get("product_name") or "Items"
    qty = row.get("quantity")
    unit = (row.get("unit") or "").strip()
    if qty is not None:
        qty_text = f"{float(qty):g}"
        return f"{name} ({qty_text}{f' {unit}' if unit else ''})"
    return str(name)


def _next_number(db: Session, tenant_id: int, prefix: str, model, field=None) -> str:
    """Year-scoped sequential number based on max existing sequence number for tenant."""
    year = date.today().year
    pattern = f"{prefix}-{year}-%"

    col = field if field is not None and field != model.id else getattr(model, "request_number", getattr(model, "reference", None))
    max_n = 0
    if col is not None:
        values = list(
            db.scalars(
                select(col).where(model.tenant_id == tenant_id, col.like(pattern))
            ).all()
        )
        for val in values:
            if not val:
                continue
            s_val = str(val)
            if f"{prefix}-{year}-" in s_val:
                try:
                    num_part = s_val.split(f"{prefix}-{year}-")[-1].split(" ")[0].split("|")[0]
                    max_n = max(max_n, int(num_part))
                except ValueError:
                    pass

    if max_n == 0:
        max_id = int(
            db.scalar(select(func.coalesce(func.max(model.id), 0)).where(model.tenant_id == tenant_id)) or 0
        )
        max_n = max_id

    return f"{prefix}-{year}-{max_n + 1:04d}"


def _item_stock(db: Session, warehouse_id: int, item_id: int) -> int:
    sl = db.scalars(
        select(StockLevel).where(
            StockLevel.warehouse_id == warehouse_id,
            StockLevel.item_id == item_id,
        )
    ).first()
    return int(sl.quantity) if sl else 0


def _to_request_read(db: Session, row: StoreIssueRequest) -> StoreIssueRequestRead:
    wh = db.get(Warehouse, row.warehouse_id)
    item = db.get(InventoryItem, row.item_id)
    return StoreIssueRequestRead(
        id=row.id,
        request_number=row.request_number,
        warehouse_id=row.warehouse_id,
        warehouse_name=wh.name if wh else "—",
        item_id=row.item_id,
        item_name=item.name if item else "—",
        quantity=row.quantity,
        operator_name=row.operator_name,
        employee_id=row.employee_id,
        machine=row.machine,
        shift=row.shift,
        reason=row.reason,
        status=row.status,
        approved_by=row.approved_by,
        issued_by=row.issued_by,
        issued_qty=row.issued_qty,
        used_qty=row.used_qty,
        waste_qty=row.waste_qty,
        returned_qty=row.returned_qty,
        notes=row.notes,
        current_stock=_item_stock(db, row.warehouse_id, row.item_id),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def create_stock_in(
    db: Session, tenant_id: int, payload: StoreStockInCreate, received_by: str | None
) -> StoreStockInRead:
    item = db.get(InventoryItem, payload.item_id)
    wh = db.get(Warehouse, payload.warehouse_id)
    if not item or item.tenant_id != tenant_id:
        raise HTTPException(404, "Product not found")
    if not wh or wh.tenant_id != tenant_id:
        raise HTTPException(404, "Warehouse not found")

    previous = _item_stock(db, payload.warehouse_id, payload.item_id)
    for attempt in range(5):
        txn = _next_number(db, tenant_id, "SIN", StockMovement, StockMovement.reference)
        ref_parts = [txn]
        if payload.supplier_name:
            ref_parts.append(f"SUP:{payload.supplier_name}")
        if payload.notes:
            ref_parts.append(payload.notes[:60])
        ref_str = " | ".join(ref_parts)

        exists = db.scalar(
            select(StockMovement).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.reference.like(f"{txn}%"),
            )
        )
        if exists and attempt < 4:
            continue

        try:
            mov = record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=payload.warehouse_id,
                    item_id=payload.item_id,
                    quantity=payload.quantity,
                    movement_type="in",
                    reference=ref_str,
                    batch_number=payload.batch_number,
                    created_by=received_by or "Store",
                ),
            )
            current = _item_stock(db, payload.warehouse_id, payload.item_id)
            return StoreStockInRead(
                transaction_number=txn,
                movement_id=mov.id,
                warehouse_id=wh.id,
                warehouse_name=wh.name,
                item_id=item.id,
                item_name=item.name,
                quantity=payload.quantity,
                previous_stock=previous,
                current_stock=current,
                received_by=received_by,
                created_at=mov.created_at,
            )
        except SQLAlchemyError:
            db.rollback()
            if attempt == 4:
                raise


def create_issue_request(
    db: Session, tenant_id: int, payload: StoreIssueRequestCreate
) -> StoreIssueRequestRead:
    item = db.get(InventoryItem, payload.item_id)
    wh = db.get(Warehouse, payload.warehouse_id)
    if not item or item.tenant_id != tenant_id:
        raise HTTPException(404, "Product not found")
    if not wh or wh.tenant_id != tenant_id:
        raise HTTPException(404, "Warehouse not found")

    for attempt in range(5):
        req_no = _next_number(db, tenant_id, "SMR", StoreIssueRequest, StoreIssueRequest.request_number)
        exists = db.scalar(
            select(StoreIssueRequest).where(
                StoreIssueRequest.tenant_id == tenant_id,
                StoreIssueRequest.request_number == req_no,
            )
        )
        if exists and attempt < 4:
            continue

        row = StoreIssueRequest(
            tenant_id=tenant_id,
            request_number=req_no,
            warehouse_id=payload.warehouse_id,
            item_id=payload.item_id,
            quantity=payload.quantity,
            operator_name=payload.operator_name.strip(),
            employee_id=payload.employee_id,
            machine=payload.machine,
            shift=payload.shift,
            reason=payload.reason,
            status="pending",
        )
        try:
            db.add(row)
            db.commit()
            db.refresh(row)
            return _to_request_read(db, row)
        except SQLAlchemyError:
            db.rollback()
            if attempt == 4:
                raise


def list_issue_requests(
    db: Session, tenant_id: int, status: str | None = None
) -> list[StoreIssueRequestRead]:
    stmt = select(StoreIssueRequest).where(StoreIssueRequest.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(StoreIssueRequest.status == status)
    stmt = stmt.order_by(StoreIssueRequest.id.desc())
    return [_to_request_read(db, r) for r in db.scalars(stmt).all()]


def approve_issue_request(
    db: Session, tenant_id: int, request_id: int, approved_by: str, notes: str | None = None
) -> StoreIssueRequestRead:
    row = db.scalars(
        select(StoreIssueRequest).where(
            StoreIssueRequest.id == request_id,
            StoreIssueRequest.tenant_id == tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(404, "Material request not found")
    if row.status != "pending":
        raise HTTPException(400, f"Cannot approve request in status '{row.status}'")
    row.status = "approved"
    row.approved_by = approved_by
    if notes:
        row.notes = notes
    db.commit()
    db.refresh(row)
    return _to_request_read(db, row)


def reject_issue_request(
    db: Session, tenant_id: int, request_id: int, rejected_by: str, notes: str | None = None
) -> StoreIssueRequestRead:
    row = db.scalars(
        select(StoreIssueRequest).where(
            StoreIssueRequest.id == request_id,
            StoreIssueRequest.tenant_id == tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(404, "Material request not found")
    if row.status not in ("pending", "approved"):
        raise HTTPException(400, f"Cannot reject request in status '{row.status}'")
    row.status = "rejected"
    row.approved_by = rejected_by
    if notes:
        row.notes = notes
    db.commit()
    db.refresh(row)
    return _to_request_read(db, row)


def issue_material(
    db: Session,
    tenant_id: int,
    request_id: int,
    issued_by: str,
    issued_qty: int | None = None,
    notes: str | None = None,
    *,
    commit: bool = True,
) -> StoreIssueRequestRead:
    row = db.scalars(
        select(StoreIssueRequest)
        .where(
            StoreIssueRequest.id == request_id,
            StoreIssueRequest.tenant_id == tenant_id,
        )
        .with_for_update()
    ).first()
    if not row:
        raise HTTPException(404, "Material request not found")
    if row.status == "issued":
        from app.core.concurrency import raise_conflict

        raise_conflict("This material request has already been issued.")
    if row.status not in ("approved", "pending"):
        raise HTTPException(400, f"Cannot issue material for status '{row.status}'")

    qty = int(issued_qty or row.quantity)
    if qty <= 0:
        raise HTTPException(400, "Issue quantity must be greater than zero")
    if qty > row.quantity:
        raise HTTPException(400, "Issue quantity cannot exceed requested quantity")

    if row.status == "pending":
        row.status = "approved"
        row.approved_by = issued_by

    try:
        record_stock_movement(
            db,
            StockMovementCreate(
                tenant_id=tenant_id,
                warehouse_id=row.warehouse_id,
                item_id=row.item_id,
                quantity=qty,
                movement_type="out",
                reference=f"{row.request_number} | OP:{row.operator_name}"
                + (f" | MACHINE:{row.machine}" if row.machine else ""),
                created_by=issued_by,
            ),
            commit=False,
        )
        row.status = "issued"
        row.issued_by = issued_by
        row.issued_qty = qty
        if notes:
            row.notes = notes
        if commit:
            db.commit()
            db.refresh(row)
        else:
            db.flush()
        return _to_request_read(db, row)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(500, "Failed to issue material") from exc


def confirm_received(
    db: Session, tenant_id: int, request_id: int, operator_name: str | None = None
) -> StoreIssueRequestRead:
    row = db.scalars(
        select(StoreIssueRequest).where(
            StoreIssueRequest.id == request_id,
            StoreIssueRequest.tenant_id == tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(404, "Material request not found")
    if row.status != "issued":
        raise HTTPException(400, "Only issued requests can be confirmed as received")
    row.status = "received"
    if operator_name:
        row.notes = ((row.notes or "") + f" | Received by {operator_name}").strip(" |")
    db.commit()
    db.refresh(row)
    return _to_request_read(db, row)


def record_consumption(
    db: Session,
    tenant_id: int,
    request_id: int,
    payload: StoreConsumeCreate,
    user_name: str,
    *,
    commit: bool = True,
) -> StoreIssueRequestRead:
    row = db.scalars(
        select(StoreIssueRequest).where(
            StoreIssueRequest.id == request_id,
            StoreIssueRequest.tenant_id == tenant_id,
        )
    ).first()
    if not row:
        raise HTTPException(404, "Material request not found")
    if row.status not in ("issued", "received", "closed"):
        raise HTTPException(400, "Consumption allowed only after material is issued")

    issued = int(row.issued_qty or row.quantity)
    existing_used = int(row.used_qty or 0)
    existing_waste = int(row.waste_qty or 0)
    existing_returned = int(row.returned_qty or 0)

    new_used = existing_used + payload.used_qty
    new_waste = existing_waste + payload.waste_qty
    new_returned = existing_returned + payload.returned_qty

    total = new_used + new_waste + new_returned
    if total > issued:
        raise HTTPException(
            400,
            f"Total cumulative consumption (used: {new_used}, waste: {new_waste}, returned: {new_returned} = {total}) cannot exceed issued quantity ({issued})",
        )

    try:
        if payload.returned_qty > 0:
            record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=row.warehouse_id,
                    item_id=row.item_id,
                    quantity=payload.returned_qty,
                    movement_type="return",
                    reference=f"{row.request_number} | RETURN",
                    created_by=user_name,
                ),
                commit=False,
            )
        if payload.waste_qty > 0:
            mov = StockMovement(
                tenant_id=tenant_id,
                warehouse_id=row.warehouse_id,
                item_id=row.item_id,
                quantity=payload.waste_qty,
                movement_type="scrap",
                reference=f"{row.request_number} | WASTE (already issued)",
                created_by=user_name,
            )
            db.add(mov)

        row.used_qty = new_used
        row.waste_qty = new_waste
        row.returned_qty = new_returned
        row.status = "closed"
        if payload.notes:
            row.notes = payload.notes
        if commit:
            db.commit()
            db.refresh(row)
        else:
            db.flush()
        return _to_request_read(db, row)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(500, "Failed to record consumption") from exc


def create_stock_return(
    db: Session, tenant_id: int, payload: StoreReturnCreate, created_by: str | None
) -> StoreReturnRead:
    item = db.get(InventoryItem, payload.item_id)
    wh = db.get(Warehouse, payload.warehouse_id)
    if not item or item.tenant_id != tenant_id:
        raise HTTPException(404, "Product not found")
    if not wh or wh.tenant_id != tenant_id:
        raise HTTPException(404, "Warehouse not found")

    if payload.quantity <= 0:
        raise HTTPException(400, "Return quantity must be greater than zero")

    if payload.request_id:
        req = db.scalars(
            select(StoreIssueRequest).where(
                StoreIssueRequest.id == payload.request_id,
                StoreIssueRequest.tenant_id == tenant_id,
            )
        ).first()
        if not req:
            raise HTTPException(404, "Material request not found")
        issued_qty = int(req.issued_qty or req.quantity or 0)
        already_returned = int(
            db.scalar(
                select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                    StockMovement.tenant_id == tenant_id,
                    StockMovement.movement_type == "return",
                    StockMovement.reference.like(f"%REQ:{req.id}%"),
                )
            )
            or 0
        )
        eligible_return = max(0, issued_qty - already_returned)
        if payload.quantity > eligible_return:
            raise HTTPException(
                400,
                f"Return quantity ({payload.quantity}) exceeds issued/eligible return quantity ({eligible_return}).",
            )
    else:
        total_issued = int(
            db.scalar(
                select(func.coalesce(func.sum(StoreIssueRequest.issued_qty), 0)).where(
                    StoreIssueRequest.tenant_id == tenant_id,
                    StoreIssueRequest.warehouse_id == payload.warehouse_id,
                    StoreIssueRequest.item_id == payload.item_id,
                    StoreIssueRequest.status.in_(("issued", "received", "closed")),
                )
            )
            or 0
        )
        if total_issued > 0:
            total_returned = int(
                db.scalar(
                    select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                        StockMovement.tenant_id == tenant_id,
                        StockMovement.warehouse_id == payload.warehouse_id,
                        StockMovement.item_id == payload.item_id,
                        StockMovement.movement_type == "return",
                    )
                )
                or 0
            )
            eligible_return = max(0, total_issued - total_returned)
            if payload.quantity > eligible_return:
                raise HTTPException(
                    400,
                    f"Return quantity ({payload.quantity}) exceeds issued/eligible return quantity ({eligible_return}).",
                )

    previous = _item_stock(db, payload.warehouse_id, payload.item_id)
    for attempt in range(5):
        txn = _next_number(db, tenant_id, "SRT", StockMovement, StockMovement.reference)
        ref = txn
        if payload.operator_name:
            ref += f" | OP:{payload.operator_name}"
        if payload.machine:
            ref += f" | MACHINE:{payload.machine}"
        if payload.request_id:
            ref += f" | REQ:{payload.request_id}"

        exists = db.scalar(
            select(StockMovement).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.reference.like(f"{txn}%"),
            )
        )
        if exists and attempt < 4:
            continue

        try:
            mov = record_stock_movement(
                db,
                StockMovementCreate(
                    tenant_id=tenant_id,
                    warehouse_id=payload.warehouse_id,
                    item_id=payload.item_id,
                    quantity=payload.quantity,
                    movement_type="return",
                    reference=ref,
                    created_by=created_by or "Store",
                ),
            )
            current = _item_stock(db, payload.warehouse_id, payload.item_id)
            return StoreReturnRead(
                transaction_number=txn,
                movement_id=mov.id,
                warehouse_name=wh.name,
                item_name=item.name,
                quantity=payload.quantity,
                previous_stock=previous,
                current_stock=current,
                created_by=created_by,
            )
        except SQLAlchemyError:
            db.rollback()
            if attempt == 4:
                raise


def get_store_dashboard(db: Session, tenant_id: int) -> StoreDashboardRead:
    items = list(
        db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.is_active.is_(True),
            )
        ).all()
    )
    total_products = len(items)
    current_qty = 0
    low = 0
    out = 0
    low_stock_candidates: list[tuple[float, StoreDashboardLowStockItem]] = []
    for item in items:
        qty = get_total_stock(db, item.id)
        reserved = int(getattr(item, "reserved", 0) or 0)
        available = max(0, qty - reserved)
        current_qty += qty
        if qty <= 0:
            out += 1
        elif item.reorder_level and available <= item.reorder_level:
            low += 1
            low_stock_candidates.append(
                (
                    qty,
                    StoreDashboardLowStockItem(
                        item_id=item.id,
                        item_name=item.name,
                        current_stock=qty,
                        reorder_level=item.reorder_level,
                        unit=item.unit,
                    ),
                )
            )

    low_stock_preview = [row for _, row in sorted(low_stock_candidates, key=lambda x: x[0])[:8]]

    today = date.today()
    todays_in = int(
        db.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.movement_type.in_(_STOCK_IN_TYPES),
                func.date(StockMovement.created_at) == today,
            )
        )
        or 0
    )
    todays_out = int(
        db.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.movement_type.in_(_STOCK_OUT_TYPES),
                func.date(StockMovement.created_at) == today,
            )
        )
        or 0
    )
    todays_in_qty = float(
        db.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.movement_type.in_(_STOCK_IN_TYPES),
                func.date(StockMovement.created_at) == today,
            )
        )
        or 0
    )
    todays_out_qty = float(
        db.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                StockMovement.tenant_id == tenant_id,
                StockMovement.movement_type.in_(_STOCK_OUT_TYPES),
                func.date(StockMovement.created_at) == today,
            )
        )
        or 0
    )
    pending_mr_filter = (
        MaterialRequest.tenant_id == tenant_id,
        MaterialRequest.approval_status == "pending",
        MaterialRequest.status.notin_(_MR_CLOSED_STATUSES),
    )
    pending_mr_count = int(
        db.scalar(select(func.count(MaterialRequest.id)).where(*pending_mr_filter)) or 0
    )
    pending_mrs = list(
        db.scalars(
            select(MaterialRequest)
            .where(*pending_mr_filter)
            .order_by(MaterialRequest.id.desc())
            .limit(8)
        ).all()
    )
    mr_line_counts: dict[int, int] = {}
    if pending_mrs:
        mr_ids = [mr.id for mr in pending_mrs]
        for mr_id, cnt in db.execute(
            select(MaterialRequestLine.material_request_id, func.count(MaterialRequestLine.id))
            .where(MaterialRequestLine.material_request_id.in_(mr_ids))
            .group_by(MaterialRequestLine.material_request_id)
        ).all():
            mr_line_counts[int(mr_id)] = int(cnt or 0)

    pending_transfer_filter = (
        StockTransfer.tenant_id == tenant_id,
        StockTransfer.status.in_(_PENDING_TRANSFER_STATUSES),
    )
    pending_transfers_count = int(
        db.scalar(select(func.count(StockTransfer.id)).where(*pending_transfer_filter)) or 0
    )
    transfer_rows_db = list(
        db.scalars(
            select(StockTransfer)
            .where(*pending_transfer_filter)
            .order_by(StockTransfer.id.desc())
            .limit(8)
        ).all()
    )
    wh_ids = {t.from_warehouse_id for t in transfer_rows_db} | {t.to_warehouse_id for t in transfer_rows_db}
    wh_map: dict[int, str] = {}
    if wh_ids:
        for wh in db.scalars(select(Warehouse).where(Warehouse.id.in_(wh_ids))).all():
            wh_map[wh.id] = wh.name
    pending_transfer_rows = [
        StoreDashboardTransferRow(
            id=t.id,
            reference_no=t.transfer_number,
            from_warehouse=wh_map.get(t.from_warehouse_id, "—"),
            to_warehouse=wh_map.get(t.to_warehouse_id, "—"),
            status=t.status or "pending",
        )
        for t in transfer_rows_db
    ]

    recent_stock_activity = _load_recent_stock_activity(db, tenant_id)

    warehouses = list(db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all())
    util = 0.0
    if warehouses:
        caps = [w.capacity or 0 for w in warehouses]
        used = [w.used_capacity or 0 for w in warehouses]
        total_cap = sum(caps)
        if total_cap > 0:
            util = round(100.0 * sum(used) / total_cap, 1)

    from app.models.product import Product
    from app.services.manual_job_card_service import count_manual_sales_job_cards_pending
    from app.services.workflow_routing_service import _store_kpi_counts
    from app.services.workflow_team_service import list_pending_inventory_checks

    catalog_total = 0
    catalog_low = 0
    catalog_out = 0
    catalog_low_stock_rows: list[tuple[float, StoreDashboardLowStockItem]] = []
    catalog_products = list(
        db.scalars(select(Product).where(Product.tenant_id == tenant_id)).all()
    )
    for p in catalog_products:
        catalog_total += 1
        stock = float(p.current_stock or 0)
        min_stk = float(p.min_stock or 0) if p.min_stock is not None else 0.0
        if stock <= 0:
            catalog_out += 1
        elif min_stk > 0 and stock <= min_stk:
            catalog_low += 1
            catalog_low_stock_rows.append(
                (
                    stock,
                    StoreDashboardLowStockItem(
                        item_id=p.id,
                        item_name=p.name,
                        current_stock=stock,
                        reorder_level=p.min_stock,
                        unit=p.unit,
                    ),
                )
            )

    low_stock_preview = [
        row for _, row in sorted(catalog_low_stock_rows, key=lambda x: x[0])[:8]
    ]

    pending_count, pending_orders = list_pending_inventory_checks(db, tenant_id, limit=8)
    sales_jc_pending = count_manual_sales_job_cards_pending(db, tenant_id)
    store_kpi = _store_kpi_counts(db, tenant_id)

    material_check_queue = [
        StoreDashboardMaterialCheckRow(
            sales_order_id=int(row["sales_order_id"]),
            job_card_no=row.get("job_card_no"),
            required_items_summary=_material_check_summary(row),
            status_label=row.get("status_label") or row.get("status") or "Pending check",
        )
        for row in pending_orders
    ]
    pending_material_request_rows = [
        StoreDashboardMaterialRequestRow(
            id=mr.id,
            mr_number=mr.mr_number,
            department=mr.department,
            items_count=mr_line_counts.get(mr.id, 0),
            status=mr.approval_status or mr.status or "pending",
        )
        for mr in pending_mrs
    ]

    return StoreDashboardRead(
        total_products=total_products,
        catalog_product_count=catalog_total,
        catalog_low_stock_count=catalog_low,
        catalog_out_of_stock_count=catalog_out,
        current_inventory_qty=current_qty,
        low_stock_items=low,
        out_of_stock_items=out,
        todays_stock_in=todays_in,
        todays_material_issues=todays_out,
        pending_material_requests=pending_mr_count,
        pending_purchase_requisitions=pending_mr_count,
        warehouse_utilization_pct=util,
        pending_inventory_checks=pending_count,
        sales_job_cards_pending=sales_jc_pending,
        store_pending=int(store_kpi.get("store_pending") or 0),
        store_actionable_total=int(store_kpi.get("total_job_cards") or 0),
        pending_inventory_orders=[
            PendingInventoryCheckOrder(**row) for row in pending_orders
        ],
        pending_transfers=pending_transfers_count,
        today_movement=StoreDashboardTodayMovement(
            stock_in_count=todays_in,
            stock_out_count=todays_out,
            stock_in_quantity=todays_in_qty,
            stock_out_quantity=todays_out_qty,
        ),
        low_stock_preview=low_stock_preview,
        material_check_queue=material_check_queue,
        pending_material_request_rows=pending_material_request_rows,
        pending_transfer_rows=pending_transfer_rows,
        recent_stock_activity=recent_stock_activity,
    )


def create_pr_from_low_stock(
    db: Session, tenant_id: int, payload: PurchaseRequisitionFromLowStock, requested_by: str
) -> PurchaseRequisitionCreated:
    item = db.get(InventoryItem, payload.item_id)
    if not item or item.tenant_id != tenant_id:
        raise HTTPException(404, "Product not found")

    current = get_total_stock(db, item.id)
    min_stock = int(item.reorder_level or 0)
    recommended = payload.recommended_qty
    if recommended is None:
        recommended = max(min_stock * 2 - current, min_stock or 1, 1)

    mr_number = next_material_request_number(db, tenant_id)
    mr = MaterialRequest(
        tenant_id=tenant_id,
        mr_number=mr_number,
        request_date=date.today(),
        required_date=None,
        requested_by=requested_by,
        status="pending",
        notes=payload.notes
        or f"Auto PR from low stock. Current={current}, Min={min_stock}",
    )
    db.add(mr)
    db.flush()
    db.add(
        MaterialRequestLine(
            material_request_id=mr.id,
            item_id=item.id,
            quantity=float(recommended),
            notes=f"Current stock: {current}; Min: {min_stock}",
        )
    )
    db.commit()
    db.refresh(mr)
    return PurchaseRequisitionCreated(
        id=mr.id,
        mr_number=mr.mr_number,
        item_id=item.id,
        item_name=item.name,
        quantity=int(recommended),
        current_stock=current,
        min_stock=min_stock,
    )


def list_enriched_movements(
    db: Session,
    tenant_id: int,
    *,
    item_id: int | None = None,
    warehouse_id: int | None = None,
    movement_type: str | None = None,
    user_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> list[dict]:
    stmt = select(StockMovement).where(StockMovement.tenant_id == tenant_id)
    if item_id:
        stmt = stmt.where(StockMovement.item_id == item_id)
    if warehouse_id:
        stmt = stmt.where(StockMovement.warehouse_id == warehouse_id)
    if movement_type:
        stmt = stmt.where(StockMovement.movement_type == movement_type)
    if user_name:
        stmt = stmt.where(StockMovement.created_by.ilike(f"%{user_name}%"))
    if date_from:
        stmt = stmt.where(func.date(StockMovement.created_at) >= date_from)
    if date_to:
        stmt = stmt.where(func.date(StockMovement.created_at) <= date_to)
    stmt = stmt.order_by(StockMovement.id.desc()).limit(limit)
    rows = list(db.scalars(stmt).all())
    wh_map = {
        w.id: w.name
        for w in db.scalars(select(Warehouse).where(Warehouse.tenant_id == tenant_id)).all()
    }
    item_map = {
        i.id: i.name
        for i in db.scalars(
            select(InventoryItem).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.is_active.is_(True),
            )
        ).all()
    }
    out = []
    for m in rows:
        ref = m.reference or ""
        machine = None
        if "MACHINE:" in ref:
            try:
                machine = ref.split("MACHINE:")[1].split("|")[0].strip()
            except Exception:
                machine = None
        out.append(
            {
                "id": m.id,
                "date": m.created_at.isoformat() if m.created_at else None,
                "transaction": m.movement_type,
                "product": item_map.get(m.item_id, "—"),
                "item_id": m.item_id,
                "quantity": m.quantity,
                "user": m.created_by or "System",
                "machine": machine,
                "warehouse": wh_map.get(m.warehouse_id, "—"),
                "warehouse_id": m.warehouse_id,
                "reference": m.reference,
                "batch_number": m.batch_number,
            }
        )
    return out
