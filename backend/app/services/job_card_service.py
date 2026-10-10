"""Job Card = Work Order shop-floor document.

Aggregates Production Order, BOM materials, QC, dispatch, and invoice
from existing tables — no separate job_cards table.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.production import ProductionOrder, WorkOrder
from app.models.quality import QualityInspection
from app.models.sales import DispatchShipment, Invoice, Quotation, SalesOrder
from app.models.user import User
from app.services.manufacturing_workflow_service import get_bom_requirements
from app.services.work_order_service import (
    COMPLETED_STATUSES,
    RUNNING_STATUSES,
    _to_list_read,
    _wo_context,
    get_work_order_detail,
    list_work_orders_enriched,
)


def _fmt_dt(value: datetime | None) -> str | None:
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone().strftime("%d-%b-%Y %I:%M %p")


def _fmt_date(value) -> str | None:
    if not value:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%d-%b-%Y")
    return str(value)


def _stage(id_: str, number: int, title: str, description: str, status: str) -> dict[str, Any]:
    # status: completed | current | pending | blocked
    return {
        "id": id_,
        "number": number,
        "title": title,
        "description": description,
        "status": status,
    }


JOB_CARD_UI_WORKFLOW_STEPS = [
    {"key": "sales_orders", "label": "Sales Order", "statuses": {"SALES_CONFIRMED", "DRAFT", "PENDING"}},
    {
        "key": "inventory_check",
        "label": "Inventory",
        "statuses": {
            "MATERIAL_CHECK_PENDING",
            "MATERIAL_SHORTAGE",
            "MATERIAL_PARTIAL",
        },
    },
    {
        "key": "store_manager",
        "label": "Store Manager",
        "statuses": {
            "MATERIAL_AVAILABLE",
            "STORE_ISSUE_PENDING",
            "STORE_ISSUE_PARTIAL",
        },
    },
    {
        "key": "production_manager",
        "label": "Production Manager",
        "statuses": {
            "READY_FOR_PRODUCTION",
            "PRODUCTION_REWORK",
            "QUALITY_REJECTED",
        },
    },
    {
        "key": "operator",
        "label": "Operator",
        "statuses": {
            "PRODUCTION_ASSIGNED",
            "PRODUCTION_IN_PROGRESS",
            "PRODUCTION_COMPLETED",
        },
    },
    {
        "key": "quality_check",
        "label": "Quality",
        "statuses": {"QUALITY_CHECK_PENDING", "QUALITY_ON_HOLD", "QUALITY_APPROVED"},
    },
    {
        "key": "packing_dispatch",
        "label": "Packing",
        "statuses": {
            "PACKING_PENDING",
            "PACKING_IN_PROGRESS",
            "PACKED",
            "PACKING_ISSUE",
        },
    },
    {
        "key": "billing",
        "label": "Billing",
        "statuses": {"BILLING_PENDING", "BILLING_HOLD", "INVOICED"},
    },
    {"key": "completed", "label": "Completed", "statuses": {"COMPLETED", "WORKFLOW_ON_HOLD"}},
]

WORKFLOW_STAGE_HINTS: dict[str, str] = {
    "sales_orders": "Waiting for inventory check",
    "inventory_check": "Material availability verification in progress.",
    "store_manager": "Store material issue and verification.",
    "production_manager": "Production planning and operator assignment.",
    "operator": "Production execution on shop floor.",
    "quality_check": "Quality inspection pending.",
    "packing_dispatch": "Packing and dispatch preparation.",
    "billing": "Invoice and billing processing.",
    "completed": "Manufacturing workflow completed.",
}


def _build_job_card_workflow_steps(workflow_status: str | None) -> list[dict[str, Any]]:
    current = (workflow_status or "SALES_CONFIRMED").upper()
    active_idx = 0
    for idx, step in enumerate(JOB_CARD_UI_WORKFLOW_STEPS):
        if current in step["statuses"]:
            active_idx = idx
            break

    steps_out = []
    for idx, step in enumerate(JOB_CARD_UI_WORKFLOW_STEPS):
        if idx < active_idx:
            state = "completed"
        elif idx == active_idx:
            state = "current"
        else:
            state = "pending"
        steps_out.append({"key": step["key"], "label": step["label"], "status": state})
    return steps_out


def _build_workflow_current_stage(workflow_status: str | None) -> dict[str, str]:
    steps = _build_job_card_workflow_steps(workflow_status)
    current = next((s for s in steps if s["status"] == "current"), steps[0] if steps else None)
    key = current["key"] if current else "sales_orders"
    return {
        "stage_label": current["label"] if current else "Sales Orders",
        "stage_hint": WORKFLOW_STAGE_HINTS.get(key, "Waiting for next stage."),
    }


def _derive_workflow(
    *,
    has_sales_order: bool,
    has_production_order: bool,
    materials_issued: bool,
    has_shortage: bool,
    wo_status: str,
    qc_result: str | None,
    packing_done: bool,
    dispatched: bool,
    invoiced: bool,
) -> list[dict[str, Any]]:
    """8-stage ribbon matching Job Card Workflow reference."""
    st = (wo_status or "").lower()
    completed = st in COMPLETED_STATUSES or st in {"done", "closed"}
    qc_pass = (qc_result or "").lower() in {"pass", "passed", "approved"}
    qc_fail = (qc_result or "").lower() in {"fail", "failed", "rejected"}
    qc_rework = (qc_result or "").lower() in {"rework", "conditional"}

    sales_done = True  # confirmed or N/A once a job card exists
    pr_done = bool(has_production_order)
    jc_done = True
    mat_done = materials_issued
    prod_done = completed
    qc_done = qc_pass
    pack_ship_done = bool(dispatched)  # dispatch implies packing path complete enough
    if packing_done and dispatched:
        pack_ship_done = True
    elif packing_done and not dispatched:
        pack_ship_done = False
    bill_done = invoiced

    # silence unused — has_sales_order reserved for future strict SO gating
    _ = has_sales_order

    order = [
        "sales_order",
        "production_request",
        "job_card",
        "material_issue",
        "production",
        "quality",
        "packing_dispatch",
        "billing",
    ]
    done_map = {
        "sales_order": sales_done,
        "production_request": pr_done,
        "job_card": jc_done,
        "material_issue": mat_done,
        "production": prod_done,
        "quality": qc_done,
        "packing_dispatch": pack_ship_done,
        "billing": bill_done,
    }
    blocked_map = {
        "material_issue": (not mat_done) and has_shortage,
        "quality": qc_fail or qc_rework,
    }

    current = None
    for key in order:
        if blocked_map.get(key) and not done_map[key]:
            current = key
            break
        if not done_map[key]:
            current = key
            break
    if current is None:
        current = "closed" if bill_done else "billing"

    def status_for(key: str) -> str:
        if blocked_map.get(key) and not done_map[key]:
            return "blocked"
        if done_map[key]:
            return "completed"
        if key == current:
            return "current"
        return "pending"

    return [
        _stage(
            "sales_order",
            1,
            "Sales Order Created",
            "Sales Team creates customer order.",
            status_for("sales_order"),
        ),
        _stage(
            "production_request",
            2,
            "Production Request",
            "Production request created from Sales Order.",
            status_for("production_request"),
        ),
        _stage(
            "job_card",
            3,
            "Job Card Created",
            "Production Manager reviews and creates Job Card.",
            status_for("job_card"),
        ),
        _stage(
            "material_issue",
            4,
            "Material Issued",
            "Store issues required materials for production.",
            status_for("material_issue"),
        ),
        _stage(
            "production",
            5,
            "Production Execution",
            "Operator starts production and updates progress.",
            status_for("production"),
        ),
        _stage(
            "quality",
            6,
            "Quality Check",
            "Quality team inspects and approves.",
            status_for("quality"),
        ),
        _stage(
            "packing_dispatch",
            7,
            "Packing & Dispatch",
            "Packing completed and goods dispatched.",
            status_for("packing_dispatch"),
        ),
        _stage(
            "billing",
            8,
            "Invoice & Billing",
            "Invoice generated and accounting completed.",
            status_for("billing"),
        ),
    ]



def _resolve_sales_order(
    db: Session, tenant_id: int, po: ProductionOrder | None
) -> SalesOrder | None:
    if not po:
        return None
    if po.sales_order_id:
        so = db.scalars(
            select(SalesOrder).where(
                SalesOrder.id == po.sales_order_id,
                SalesOrder.tenant_id == tenant_id,
            )
        ).first()
        if so:
            return so
    order_no = (po.sales_order_number or "").strip()
    if order_no:
        return db.scalars(
            select(SalesOrder).where(
                SalesOrder.tenant_id == tenant_id,
                SalesOrder.order_number == order_no,
            )
        ).first()
    return None


def _resolve_sales_person(
    db: Session, tenant_id: int, so: SalesOrder | None
) -> str | None:
    if not so:
        return None
    direct = (getattr(so, "sales_person", None) or "").strip()
    if direct:
        return direct
    ref = (so.reference_number or "").strip()
    if ref:
        quote = db.scalars(
            select(Quotation).where(
                Quotation.tenant_id == tenant_id,
                Quotation.quote_number == ref,
            )
        ).first()
        if quote:
            from_quote = (getattr(quote, "sales_person", None) or "").strip()
            if from_quote:
                return from_quote
    inv = db.scalars(
        select(Invoice)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.sales_order_id == so.id,
        )
        .order_by(Invoice.issue_date.desc())
    ).first()
    if inv:
        from_inv = (getattr(inv, "sales_person", None) or "").strip()
        if from_inv:
            return from_inv
    return None


def build_job_card(
    db: Session, tenant_id: int, work_order_id: int, user: User | None = None
) -> dict[str, Any] | None:
    detail = get_work_order_detail(db, tenant_id, work_order_id, user=user)
    if not detail:
        return None

    wo = db.scalars(
        select(WorkOrder).where(WorkOrder.id == work_order_id, WorkOrder.tenant_id == tenant_id)
    ).first()
    if not wo:
        return None

    ctx = _wo_context(db, tenant_id, wo)
    po: ProductionOrder | None = ctx.get("po")
    product = ctx.get("product")
    machine = ctx.get("machine")

    so: SalesOrder | None = None
    customer_name = detail.customer_name or (po.customer_name if po else None)
    so = _resolve_sales_order(db, tenant_id, po)
    if so:
        if so.customer_id and not customer_name:
            from app.models.sales import Customer

            cust = db.get(Customer, so.customer_id)
            if cust:
                customer_name = cust.name
    sales_person = _resolve_sales_person(db, tenant_id, so)

    # Materials with available / shortage from live stock
    materials: list[dict[str, Any]] = []
    has_shortage = False
    if po and po.product_id:
        for req in get_bom_requirements(
            db, tenant_id, po.product_id, float(wo.planned_quantity or 0)
        ):
            required = float(req["required_qty"])
            available = float(req["available_qty"])
            shortage = float(req["shortage_qty"])
            issued = required if wo.materials_issued else 0.0
            to_issue = max(required - issued, 0.0)
            if shortage > 0:
                has_shortage = True
            status = "available" if shortage <= 0 else "shortage"
            materials.append(
                {
                    "item_id": req["item_id"],
                    "material": req["component_name"],
                    "sku": req.get("sku"),
                    "required": required,
                    "available": available,
                    "to_issue": to_issue,
                    "issued": issued,
                    "shortage": shortage,
                    "unit": req.get("unit") or "pcs",
                    "status": status,
                    "status_label": (
                        "Available"
                        if shortage <= 0
                        else f"Shortage {shortage:g} {req.get('unit') or ''}".strip()
                    ),
                }
            )

    # Quality by work_order_number
    qc_rows = list(
        db.scalars(
            select(QualityInspection)
            .where(
                QualityInspection.tenant_id == tenant_id,
                QualityInspection.work_order_number == wo.work_order_number,
            )
            .order_by(QualityInspection.id.desc())
        ).all()
    )
    if not qc_rows and so and so.order_number:
        qc_rows = list(
            db.scalars(
                select(QualityInspection)
                .where(
                    QualityInspection.tenant_id == tenant_id,
                    QualityInspection.sales_order_number == so.order_number,
                    QualityInspection.inspection_type == "final",
                )
                .order_by(QualityInspection.id.desc())
            ).all()
        )

    final_qc = next(
        (q for q in qc_rows if (q.inspection_type or "") == "final"),
        qc_rows[0] if qc_rows else None,
    )
    packing_done = False
    if final_qc and (getattr(final_qc, "packing_status", None) or "").lower() in {
        "packed",
        "ready_for_pack",
        "completed",
    }:
        packing_done = True
    if so and getattr(so, "packed", False):
        packing_done = True

    dispatch = None
    if so:
        dispatch = db.scalars(
            select(DispatchShipment)
            .where(
                DispatchShipment.tenant_id == tenant_id,
                DispatchShipment.sales_order_id == so.id,
            )
            .order_by(DispatchShipment.id.desc())
        ).first()
    dispatched = bool(
        (so and getattr(so, "shipped", False))
        or (dispatch and (dispatch.status or "").lower() in {"shipped", "delivered", "completed"})
    )

    invoice = None
    if so:
        invoice = db.scalars(
            select(Invoice)
            .where(Invoice.tenant_id == tenant_id, Invoice.sales_order_id == so.id)
            .order_by(Invoice.id.desc())
        ).first()
    invoiced = bool((so and getattr(so, "invoiced", False)) or invoice)

    target = float(wo.planned_quantity or 0)
    produced = float(detail.produced_quantity or wo.actual_quantity or 0)
    rejected = float(detail.scrap_quantity or 0)
    rework = float(detail.rework_quantity or 0)
    good = max(produced - rejected - rework, 0.0)
    balance = max(target - good, 0.0)

    display_status = (wo.status or "planned").replace("_", " ").upper()
    if display_status in {"RUNNING", "IN PROGRESS"}:
        display_status = "IN PROGRESS"
    elif display_status in {"COMPLETED", "DONE", "CLOSED"}:
        display_status = "COMPLETED"

    workflow = _derive_workflow(
        has_sales_order=bool(so or (po and (po.sales_order_id or po.sales_order_number))),
        has_production_order=bool(po),
        materials_issued=bool(wo.materials_issued),
        has_shortage=has_shortage,
        wo_status=wo.status or "",
        qc_result=final_qc.result if final_qc else None,
        packing_done=packing_done,
        dispatched=dispatched,
        invoiced=invoiced,
    )

    closed = invoiced and dispatched and packing_done and (
        (wo.status or "").lower() in COMPLETED_STATUSES
    )

    status_timeline = [
        {"label": "Sales Order Confirmed", "done": bool(so or (po and (po.sales_order_id or po.sales_order_number))) or bool(wo.id)},
        {"label": "Production Planned", "done": bool(po)},
        {"label": "Material Issued", "done": bool(wo.materials_issued)},
        {"label": "Production Completed", "done": (wo.status or "").lower() in COMPLETED_STATUSES},
        {
            "label": "Quality Approved",
            "done": bool(final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}),
        },
        {"label": "Packing Completed", "done": packing_done},
        {"label": "Dispatch Completed", "done": dispatched},
        {"label": "Invoice Generated", "done": invoiced},
    ]

    approvals: list[dict[str, Any]] = [
        {
            "step": "Created By",
            "name": wo.supervisor or detail.supervisor or "Production",
            "at": _fmt_dt(wo.created_at),
            "role": "Production Manager",
        }
    ]
    if wo.materials_issued:
        approvals.append(
            {
                "step": "Material Issued",
                "name": "Store",
                "at": _fmt_dt(wo.updated_at),
                "role": "Store",
            }
        )
    if final_qc:
        approvals.append(
            {
                "step": "QC Approved" if (final_qc.result or "").lower() in {"pass", "passed"} else "QC Recorded",
                "name": final_qc.inspector or "QC",
                "at": _fmt_date(final_qc.inspection_date),
                "role": "Quality",
            }
        )
    if dispatch:
        approvals.append(
            {
                "step": "Dispatch Verified",
                "name": dispatch.driver_name or "Logistics",
                "at": _fmt_date(dispatch.dispatch_date),
                "role": "Dispatch",
            }
        )
    if invoice:
        approvals.append(
            {
                "step": "Invoice Verified",
                "name": "Accounts",
                "at": _fmt_date(invoice.issue_date),
                "role": "Accounts",
            }
        )

    return {
        "id": wo.id,
        "job_card_no": wo.work_order_number,
        "work_order_id": wo.id,
        "work_order_number": wo.work_order_number,
        "status": wo.status,
        "display_status": display_status,
        "priority": wo.priority or (po.priority if po else None) or "medium",
        "header": {
            "sales_order_id": so.id if so else (po.sales_order_id if po else None),
            "sales_order_no": (so.order_number if so else None)
            or (po.sales_order_number if po else None),
            "customer": customer_name,
            "sales_person": sales_person,
            "product": detail.product_name or (product.name if product else None),
            "product_id": po.product_id if po else None,
            "order_qty": float(po.planned_quantity if po else wo.planned_quantity or 0),
            "uom": "Nos",
            "required_delivery": _fmt_date(so.delivery_date if so else None)
            or _fmt_date(po.due_date if po else None),
            "job_card_date": _fmt_dt(wo.created_at),
            "planned_start": _fmt_dt(wo.planned_start),
            "planned_end": _fmt_dt(wo.planned_end),
            "packing_time": None,
            "dispatch_date": _fmt_date(dispatch.dispatch_date) if dispatch else None,
            "delivery_date": _fmt_date(so.delivery_date if so else None)
            or _fmt_date(po.due_date if po else None),
            "production_manager": wo.supervisor or detail.supervisor,
            "department": wo.department or detail.department or (po.department if po else None),
            "production_type": "Manufacturing",
            "plant": wo.plant_code,
            "remarks": None,
            "production_order_id": wo.production_order_id,
            "production_order_no": detail.production_order_number,
        },
        "summary": {
            "target_qty": target,
            "produced_qty": produced,
            "rejected_qty": rejected,
            "rework_qty": rework,
            "good_qty": good,
            "balance_qty": balance,
            "progress_pct": float(detail.progress_pct or 0),
        },
        "materials": materials,
        "materials_issued": bool(wo.materials_issued),
        "has_shortage": has_shortage,
        "machine": {
            "machine_id": wo.machine_id,
            "machine_name": detail.machine_name or (machine.name if machine else None),
            "machine_code": detail.machine_code,
            "operation": None,
            "setup_time": None,
            "start_time": _fmt_dt(wo.planned_start),
            "end_time": _fmt_dt(wo.planned_end),
            "planned_hours": None,
        },
        "operator": {
            "assigned_user_id": wo.assigned_user_id,
            "operator_name": detail.operator_name or wo.operator_name,
            "assistant_name": None,
            "shift": wo.shift or detail.shift,
            "shift_start": None,
            "shift_end": None,
            "break_time": None,
        },
        "production": {
            "target_qty": target,
            "uom": "Nos",
            "produced_qty": produced,
            "rejected_qty": rejected,
            "rework_qty": rework,
            "good_qty": good,
            "balance_qty": balance,
            "production_start": _fmt_dt(detail.started_at or wo.planned_start),
            "production_end": _fmt_dt(detail.completed_at),
            "operator_remarks": None,
        },
        "quality": {
            "inspection_id": final_qc.id if final_qc else None,
            "checked_by": final_qc.inspector if final_qc else None,
            "checked_date": _fmt_date(final_qc.inspection_date) if final_qc else None,
            "checked_qty": float(final_qc.quantity) if final_qc and final_qc.quantity is not None else produced,
            "passed_qty": good if final_qc else None,
            "rejected_qty": rejected if final_qc else None,
            "rework_qty": rework if final_qc else None,
            "remarks": final_qc.notes if final_qc else None,
            "result": final_qc.result if final_qc else None,
            "status": (
                "Approved"
                if final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}
                else ("Rejected" if final_qc and (final_qc.result or "").lower() in {"fail", "failed", "rejected"} else "Pending")
            ),
            "packing_status": getattr(final_qc, "packing_status", None) if final_qc else None,
        },
        "packing": {
            "packing_type": None,
            "packed_qty": good if packing_done else None,
            "cartons": None,
            "packing_start": None,
            "packing_end": None,
            "packed_by": None,
            "done": packing_done,
        },
        "dispatch": {
            "id": dispatch.id if dispatch else None,
            "dispatch_date": _fmt_date(getattr(dispatch, "dispatch_date", None) or getattr(dispatch, "shipment_date", None))
            if dispatch
            else None,
            "vehicle_no": dispatch.vehicle_number if dispatch else None,
            "transporter": dispatch.courier if dispatch else None,
            "dc_no": dispatch.lr_number if dispatch else None,
            "dispatched_qty": good if dispatched else None,
            "status": dispatch.status if dispatch else None,
            "done": dispatched,
        },
        "billing": {
            "invoice_id": invoice.id if invoice else None,
            "invoice_no": invoice.invoice_number if invoice else None,
            "invoice_date": _fmt_date(invoice.issue_date) if invoice else None,
            "invoice_amount": float(invoice.grand_total) if invoice else None,
            "payment_terms": so.payment_terms if so else None,
            "billed_by": None,
            "status": (
                (invoice.invoice_status if invoice else None)
                or ("Completed" if invoiced else "Pending")
            ),
            "done": invoiced,
        },
        "approvals": approvals,
        "notes": [
            "Use only issued material for this job card. Do not mix batches.",
            "Record rejected and rework quantities immediately on the shop floor.",
            "Any rejection above limit must be escalated to Production Manager.",
            "Packing and dispatch only after QC approval.",
        ],
        "workflow": workflow,
        "status_timeline": status_timeline,
        "closed": closed,
        "workflow_status": so.workflow_status if so and so.workflow_status else ("COMPLETED" if closed else "INVOICED" if invoiced else "PACKED" if (packing_done and dispatched) else "QUALITY_APPROVED" if (final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}) else "QUALITY_CHECK_PENDING" if (wo.status or "").lower() in COMPLETED_STATUSES else "PRODUCTION_IN_PROGRESS" if (wo.status or "").lower() in RUNNING_STATUSES else "READY_FOR_PRODUCTION" if wo.materials_issued else "MATERIAL_CHECK_PENDING"),
        "workflow_steps": _build_job_card_workflow_steps(so.workflow_status if so and so.workflow_status else ("COMPLETED" if closed else "INVOICED" if invoiced else "PACKED" if (packing_done and dispatched) else "QUALITY_APPROVED" if (final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}) else "QUALITY_CHECK_PENDING" if (wo.status or "").lower() in COMPLETED_STATUSES else "PRODUCTION_IN_PROGRESS" if (wo.status or "").lower() in RUNNING_STATUSES else "READY_FOR_PRODUCTION" if wo.materials_issued else "MATERIAL_CHECK_PENDING")),
        "workflow_tracker": _build_job_card_workflow_steps(so.workflow_status if so and so.workflow_status else ("COMPLETED" if closed else "INVOICED" if invoiced else "PACKED" if (packing_done and dispatched) else "QUALITY_APPROVED" if (final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}) else "QUALITY_CHECK_PENDING" if (wo.status or "").lower() in COMPLETED_STATUSES else "PRODUCTION_IN_PROGRESS" if (wo.status or "").lower() in RUNNING_STATUSES else "READY_FOR_PRODUCTION" if wo.materials_issued else "MATERIAL_CHECK_PENDING")),
        "workflow_current_stage": _build_workflow_current_stage(so.workflow_status if so and so.workflow_status else ("COMPLETED" if closed else "INVOICED" if invoiced else "PACKED" if (packing_done and dispatched) else "QUALITY_APPROVED" if (final_qc and (final_qc.result or "").lower() in {"pass", "passed", "approved"}) else "QUALITY_CHECK_PENDING" if (wo.status or "").lower() in COMPLETED_STATUSES else "PRODUCTION_IN_PROGRESS" if (wo.status or "").lower() in RUNNING_STATUSES else "READY_FOR_PRODUCTION" if wo.materials_issued else "MATERIAL_CHECK_PENDING")),
        "can_issue_materials": not bool(wo.materials_issued),
        "can_start_production": bool(wo.materials_issued)
        and (wo.status or "").lower()
        in {"planned", "released", "material_ready", "draft", "ready", "paused"},
        "can_complete_production": (wo.status or "").lower() in RUNNING_STATUSES
        or (wo.status or "").lower() in {"in_progress", "running", "started"},
        "list": _to_list_read(db, tenant_id, wo).model_dump(),
    }


def list_job_cards(
    db: Session, tenant_id: int, user: User | None = None
) -> list[dict[str, Any]]:
    rows = list_work_orders_enriched(db, tenant_id, user=user)
    out = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "job_card_no": r.work_order_number,
                "work_order_number": r.work_order_number,
                "status": r.status,
                "display_status": (r.status or "").replace("_", " ").title(),
                "priority": r.priority,
                "product_name": r.product_name,
                "customer_name": r.customer_name,
                "production_order_number": r.production_order_number,
                "planned_quantity": r.planned_quantity,
                "produced_quantity": r.produced_quantity,
                "progress_pct": r.progress_pct,
                "machine_name": r.machine_name,
                "operator_name": r.operator_name,
                "materials_issued": r.materials_issued,
                "planned_start": r.planned_start.isoformat() if r.planned_start else None,
                "planned_end": r.planned_end.isoformat() if r.planned_end else None,
            }
        )
    return out


def _workflow_stage_label(status: str | None) -> str:
    if not status:
        return "Sales Order"
    mapping = {
        "SALES_CONFIRMED": "Sales Confirmed",
        "MATERIAL_CHECK_PENDING": "Inventory Check",
        "MATERIAL_AVAILABLE": "Inventory Check",
        "MATERIAL_SHORTAGE": "Material Shortage",
        "MATERIAL_PARTIAL": "Material Partial",
        "READY_FOR_PRODUCTION": "Production",
        "PRODUCTION_ASSIGNED": "Production",
        "PRODUCTION_IN_PROGRESS": "Production",
        "PRODUCTION_COMPLETED": "Production",
        "PRODUCTION_REWORK": "Production Rework",
        "QUALITY_CHECK_PENDING": "Quality",
        "QUALITY_APPROVED": "Quality",
        "QUALITY_REJECTED": "Quality Rejected",
        "PACKING_PENDING": "Packing",
        "PACKING_IN_PROGRESS": "Packing",
        "PACKED": "Packing",
        "BILLING_PENDING": "Billing",
        "INVOICED": "Billing",
        "COMPLETED": "Completed",
    }
    return mapping.get(status.upper(), status.replace("_", " ").title())


def _build_job_card_timeline(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    *,
    job_card_created_at: datetime | None = None,
) -> list[dict[str, Any]]:
    from app.models.manufacturing_workflow import ManufacturingWorkflowTransition, SalesJobCard

    events: list[dict[str, Any]] = []
    transitions = list(
        db.scalars(
            select(ManufacturingWorkflowTransition)
            .where(
                ManufacturingWorkflowTransition.tenant_id == tenant_id,
                ManufacturingWorkflowTransition.sales_order_id == sales_order_id,
            )
            .order_by(ManufacturingWorkflowTransition.id.asc())
        ).all()
    )
    for tr in transitions:
        if tr.new_status == "SALES_CONFIRMED" or tr.action == "SALES_ORDER_CONFIRMED":
            events.append(
                {
                    "key": "sales_order_confirmed",
                    "title": "Sales Order Confirmed",
                    "timestamp": tr.created_at,
                    "display_time": _fmt_dt(tr.created_at),
                    "status": "completed",
                    "actor": tr.team.replace("_", " ").title() if tr.team else (tr.user_name or "Sales Team"),
                }
            )
        if tr.action == "JOB_CARD_CREATED":
            events.append(
                {
                    "key": "job_card_created",
                    "title": "Job Card Created",
                    "timestamp": tr.created_at,
                    "display_time": _fmt_dt(tr.created_at),
                    "status": "completed",
                    "actor": tr.user_name or "System",
                }
            )

    jc = db.scalars(
        select(SalesJobCard).where(
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id == sales_order_id,
        )
    ).first()
    jc_at = job_card_created_at or (jc.created_at if jc and jc.status == "created" else None)
    if jc_at and not any(e["key"] == "job_card_created" for e in events):
        events.append(
            {
                "key": "job_card_created",
                "title": "Job Card Created",
                "timestamp": jc_at,
                "display_time": _fmt_dt(jc_at),
                "status": "completed",
                "actor": "System",
            }
        )

    ordered: list[dict[str, Any]] = []
    so_evt = next((e for e in events if e["key"] == "sales_order_confirmed"), None)
    jc_evt = next((e for e in events if e["key"] == "job_card_created"), None)
    ordered.append(
        so_evt
        or {
            "key": "sales_order_confirmed",
            "title": "Sales Order Confirmed",
            "timestamp": None,
            "display_time": None,
            "status": "pending",
            "actor": None,
        }
    )
    if jc and jc.status == "created":
        ordered.append(
            jc_evt
            or {
                "key": "job_card_created",
                "title": "Job Card Created",
                "timestamp": jc_at,
                "display_time": _fmt_dt(jc_at) if jc_at else None,
                "status": "completed",
                "actor": "System",
            }
        )
    else:
        ordered.append(
            jc_evt
            or {
                "key": "job_card_created",
                "title": "Job Card Created",
                "timestamp": None,
                "display_time": None,
                "status": "pending",
                "actor": None,
            }
        )
    return ordered


def _generate_job_card_no(db: Session, tenant_id: int) -> str:
    from app.models.manufacturing_workflow import SalesJobCard

    year = datetime.now(timezone.utc).year
    prefix = f"JC-{year}-"
    existing = list(
        db.scalars(
            select(SalesJobCard.job_card_no).where(
                SalesJobCard.tenant_id == tenant_id,
                SalesJobCard.job_card_no.like(f"{prefix}%"),
            )
        ).all()
    )
    max_seq = 0
    for no in existing:
        try:
            max_seq = max(max_seq, int(str(no).split("-")[-1]))
        except ValueError:
            continue
    return f"{prefix}{max_seq + 1:05d}"


def _get_persisted_job_card(db: Session, tenant_id: int, sales_order_id: int):
    from app.models.manufacturing_workflow import SalesJobCard

    return db.scalars(
        select(SalesJobCard).where(
            SalesJobCard.tenant_id == tenant_id,
            SalesJobCard.sales_order_id == sales_order_id,
        )
    ).first()


def ensure_sales_job_card_from_order(
    db: Session, tenant_id: int, sales_order_id: int, user: User | None = None
) -> None:
    """Auto-create sales job card when a sales order enters the workflow."""
    from app.core.workflow_constants import normalize_priority
    from app.models.manufacturing_workflow import SalesJobCard
    from app.models.sales import SalesOrderLine
    from app.services.workflow_state_service import get_sales_order_or_404

    jc = _get_persisted_job_card(db, tenant_id, sales_order_id)
    if jc and jc.status == "created":
        return

    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    lines = list(
        db.scalars(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)
        ).all()
    )
    line = lines[0] if lines else None
    if not line:
        return

    priority = normalize_priority(so.priority)
    if not jc:
        jc = SalesJobCard(
            tenant_id=tenant_id,
            job_card_no=_generate_job_card_no(db, tenant_id),
            sales_order_id=so.id,
            customer_id=so.customer_id,
            product_id=line.product_id,
            quantity=float(line.quantity or 0),
            unit=(line.unit or "Nos").strip() or "Nos",
            required_delivery_date=so.delivery_date,
            priority=priority,
            sales_person_name=so.sales_person,
            notes=None,
            status="created",
            workflow_stage=so.workflow_status or "MATERIAL_CHECK_PENDING",
            created_by_user_id=user.id if user else None,
        )
        db.add(jc)
    else:
        jc.status = "created"
        jc.workflow_stage = so.workflow_status or jc.workflow_stage or "MATERIAL_CHECK_PENDING"
        jc.quantity = float(line.quantity or jc.quantity or 0)
        jc.product_id = line.product_id or jc.product_id
        jc.priority = priority
    db.flush()


def _resolve_job_card_details(
    db: Session,
    jc: Any | None,
    *,
    tenant_id: int,
    card: dict[str, Any] | None = None,
    material_check: Any | None = None,
) -> dict[str, Any]:
    from app.services.job_card_details import (
        build_raw_materials_from_bom,
        build_raw_materials_from_material_check,
        empty_details,
        merge_details,
        parse_details_json,
    )

    details = parse_details_json(jc.details_json if jc else None)
    raw_materials = details.get("raw_materials") or []
    has_material_data = any(
        any(
            row.get(key) not in (None, "")
            for key in (
                "material_name",
                "material_code",
                "paper_type",
                "gsm",
                "mill_grade",
                "quantity",
                "product_id",
                "inventory_item_id",
            )
        )
        for row in raw_materials
        if isinstance(row, dict)
    )
    if not has_material_data:
        if material_check and material_check.lines:
            details["raw_materials"] = build_raw_materials_from_material_check(
                db,
                tenant_id,
                material_check.lines,
            )
        elif card and card.get("materials"):
            details["raw_materials"] = build_raw_materials_from_bom(card["materials"])
    if jc and jc.created_at and not details.get("job_info", {}).get("issue_date"):
        details = merge_details(
            details,
            {"job_info": {"issue_date": jc.created_at.date().isoformat()}},
        )
    return details or empty_details()


def _serialize_job_card_form(
    db: Session,
    so: SalesOrder,
    line: Any | None,
    jc: Any | None,
    *,
    product_code: str | None = None,
    customer_name: str | None = None,
    product_name: str | None = None,
    workflow_status: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.core.workflow_constants import normalize_priority
    from app.models.product import Product

    if line and line.product_id and not product_code:
        prod = db.get(Product, line.product_id)
        product_code = (prod.sku if prod else "") or ""

    priority = normalize_priority(jc.priority if jc else so.priority)
    preview_no = jc.job_card_no if jc else _generate_job_card_no(db, so.tenant_id)
    return {
        "job_card_id": jc.id if jc else None,
        "job_card_no": preview_no,
        "sales_order_id": so.id,
        "sales_order_no": so.order_number,
        "customer_id": jc.customer_id if jc else so.customer_id,
        "customer_name": customer_name,
        "product_id": jc.product_id if jc else (line.product_id if line else None),
        "product_name": product_name,
        "product_code": product_code or "",
        "quantity": float(jc.quantity if jc else (line.quantity if line else 0)),
        "unit": jc.unit if jc else (line.unit if line and line.unit else "Nos"),
        "required_delivery_date": (
            jc.required_delivery_date.isoformat()
            if jc and jc.required_delivery_date
            else (so.delivery_date.isoformat() if so.delivery_date else None)
        ),
        "priority": priority,
        "sales_person_id": jc.sales_person_id if jc else None,
        "sales_person_name": jc.sales_person_name if jc else so.sales_person,
        "notes": jc.notes if jc else "",
        "status": jc.status if jc else "draft",
        "is_created": bool(jc and jc.status == "created"),
        "workflow_status": workflow_status,
        "job_card_date": jc.created_at.date().isoformat() if jc and jc.created_at else None,
        "details": details or {},
    }


def _assert_job_card_save_permission(
    user: User,
    payload: dict[str, Any],
    *,
    finalize: bool,
    workflow_status: str | None,
) -> None:
    from fastapi import HTTPException

    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import TEAM_SALES, user_teams

    teams = user_teams(get_role_names(user))
    is_admin = user_is_admin(user)
    if finalize:
        if not is_admin and TEAM_SALES not in teams:
            raise HTTPException(status_code=403, detail="Sales team permission required")
        return

    header_keys = {
        "customer_id",
        "product_id",
        "quantity",
        "unit",
        "required_delivery_date",
        "priority",
        "sales_person_id",
        "sales_person_name",
        "notes",
    }
    touches_header = any(k in payload for k in header_keys)
    touches_details = "details" in payload and payload.get("details") is not None

    if touches_header and not is_admin and TEAM_SALES not in teams:
        raise HTTPException(status_code=403, detail="Sales team permission required")

    if touches_details:
        sections = _editable_sections_for_user(user, workflow_status)
        if not is_admin and not sections:
            raise HTTPException(status_code=403, detail="Not permitted to update job card details")


def save_sales_job_card(
    db: Session,
    tenant_id: int,
    sales_order_id: int,
    user: User,
    payload: dict[str, Any],
    *,
    finalize: bool = False,
) -> dict[str, Any]:
    """Create or update persisted sales job card; finalize triggers workflow handoff."""
    from fastapi import HTTPException

    from app.core.permissions import get_role_names
    from app.core.workflow_constants import TEAM_SALES, normalize_priority, user_teams
    from app.models.manufacturing_workflow import SalesJobCard
    from app.models.product import Product
    from app.models.sales import SalesOrderLine
    from app.schemas.job_card_details import JobCardDetailsPayload
    from app.services.job_card_details import (
        parse_details_json,
        serialize_details_json,
        validate_details,
    )
    from app.services.workflow_state_service import get_sales_order_or_404, transition_workflow_status
    from app.services.workflow_team_service import create_material_check_for_order

    so = get_sales_order_or_404(db, tenant_id, sales_order_id)
    ws_preview = (so.workflow_status or "").upper()
    store_issue_editor = (
        "inventory" in user_teams(get_role_names(user))
        and ws_preview in {"MATERIAL_AVAILABLE", "STORE_ISSUE_PENDING", "STORE_ISSUE_PARTIAL"}
    )
    _assert_job_card_save_permission(user, payload, finalize=finalize, workflow_status=ws_preview)

    if (so.status or "").lower() not in {"confirmed", "approved"} and not so.workflow_status:
        raise HTTPException(
            status_code=400,
            detail="Confirm the sales order before creating a job card",
        )

    lines = list(
        db.scalars(select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)).all()
    )
    line = lines[0] if lines else None

    jc_existing = _get_persisted_job_card(db, tenant_id, sales_order_id)
    header_keys = {
        "customer_id",
        "product_id",
        "quantity",
        "unit",
        "required_delivery_date",
        "priority",
        "sales_person_id",
        "sales_person_name",
        "notes",
    }
    touches_header = any(k in payload for k in header_keys)
    skip_header_validation = (
        jc_existing
        and jc_existing.status == "created"
        and not touches_header
        and not finalize
    )

    customer_id = payload.get("customer_id") or (jc_existing.customer_id if jc_existing else None) or so.customer_id
    product_id = payload.get("product_id") or (jc_existing.product_id if jc_existing else None) or (line.product_id if line else None)
    quantity = float(
        payload.get("quantity")
        or (jc_existing.quantity if jc_existing else None)
        or (line.quantity if line else 0)
    )
    unit = (
        payload.get("unit")
        or (jc_existing.unit if jc_existing else None)
        or (line.unit if line else "Nos")
        or "Nos"
    ).strip()
    priority = normalize_priority(
        payload.get("priority") or (jc_existing.priority if jc_existing else None) or so.priority
    )
    notes = (payload.get("notes") or (jc_existing.notes if jc_existing else "") or "")[:500]
    sales_person_id = payload.get("sales_person_id") or (jc_existing.sales_person_id if jc_existing else None)
    sales_person_name = (
        payload.get("sales_person_name")
        or (jc_existing.sales_person_name if jc_existing else None)
        or so.sales_person
    )

    errors: dict[str, str] = {}
    if not skip_header_validation:
        if not customer_id:
            errors["customer_id"] = "Customer is required"
        if not product_id:
            errors["product_id"] = "Product is required"
        if quantity <= 0:
            errors["quantity"] = "Quantity must be greater than 0"
        if not payload.get("required_delivery_date") and not so.delivery_date and not (jc_existing and jc_existing.required_delivery_date):
            errors["required_delivery_date"] = "Required delivery date is required"
        if not priority:
            errors["priority"] = "Priority is required"
        if errors:
            raise HTTPException(status_code=422, detail={"message": "Validation failed", "errors": errors})

    req_date = payload.get("required_delivery_date") or so.delivery_date
    if isinstance(req_date, str):
        req_date = datetime.fromisoformat(req_date.replace("Z", "+00:00")).date()

    jc = jc_existing
    if jc and jc.status == "created" and finalize:
        raise HTTPException(status_code=400, detail="Job card already created")

    details_patch = payload.get("details")
    merged_details = None
    if details_patch is not None:
        existing_details = parse_details_json(jc.details_json if jc else None)
        details_model = JobCardDetailsPayload.model_validate(details_patch)
        merged_details = details_model.to_merged_dict(existing_details)
        patch_keys = set(details_patch.keys()) if isinstance(details_patch, dict) else set()
        section_map = {
            "job_info": "sales",
            "raw_materials": "inventory",
            "production": "production",
            "output": "quality",
            "approval": "sales",
        }
        active_detail_sections = [
            section_map[k] for k in patch_keys if k in section_map
        ]
        if "output" in patch_keys and "operator" not in active_detail_sections:
            active_detail_sections.append("operator")
        if "production" in patch_keys and "operator" not in active_detail_sections:
            active_detail_sections.append("operator")
        detail_errors = validate_details(
            merged_details,
            editable_sections=_editable_sections_for_user(user, ws_preview),
            job_card_created=bool(jc and jc.status == "created") and not store_issue_editor,
            finalize=finalize,
            active_detail_sections=active_detail_sections if not finalize else None,
        )
        if detail_errors:
            raise HTTPException(
                status_code=422,
                detail={"message": "Validation failed", "errors": detail_errors},
            )

    if sales_person_id:
        sp_user = db.get(User, int(sales_person_id))
        if sp_user:
            sales_person_name = sp_user.full_name or sales_person_name

    if not jc:
        jc = SalesJobCard(
            tenant_id=tenant_id,
            job_card_no=_generate_job_card_no(db, tenant_id),
            sales_order_id=so.id,
            customer_id=int(customer_id),
            product_id=int(product_id) if product_id else None,
            quantity=quantity,
            unit=unit,
            required_delivery_date=req_date,
            priority=priority,
            sales_person_id=int(sales_person_id) if sales_person_id else None,
            sales_person_name=sales_person_name,
            notes=notes or None,
            status="draft",
            created_by_user_id=user.id,
            details_json=serialize_details_json(merged_details) if merged_details else None,
        )
        db.add(jc)
    elif jc.status != "created":
        jc.customer_id = int(customer_id)
        jc.product_id = int(product_id) if product_id else None
        jc.quantity = quantity
        jc.unit = unit
        jc.required_delivery_date = req_date
        jc.priority = priority
        jc.sales_person_id = int(sales_person_id) if sales_person_id else None
        jc.sales_person_name = sales_person_name
        jc.notes = notes or None
    else:
        jc.notes = notes or jc.notes
        jc.priority = priority

    if merged_details is not None and jc:
        jc.details_json = serialize_details_json(merged_details)

    so.priority = priority
    so.delivery_date = req_date
    if sales_person_name:
        so.sales_person = sales_person_name
    if line and product_id:
        line.product_id = int(product_id)
        line.quantity = quantity
        line.unit = unit
        prod = db.get(Product, int(product_id))
        if prod:
            line.item_description = prod.name

    ws = (so.workflow_status or "").upper()

    if finalize:
        jc.status = "created"
        jc.workflow_stage = ws or "SALES_CONFIRMED"
        if ws in {"", "SALES_CONFIRMED"}:
            transition_workflow_status(
                db,
                tenant_id=tenant_id,
                sales_order=so,
                new_status="MATERIAL_CHECK_PENDING",
                user=user,
                action="JOB_CARD_CREATED",
                team=TEAM_SALES,
                commit=False,
                notify=True,
            )
            create_material_check_for_order(db, tenant_id, so)
        elif ws == "MATERIAL_CHECK_PENDING":
            from app.models.manufacturing_workflow import ManufacturingWorkflowTransition

            db.add(
                ManufacturingWorkflowTransition(
                    tenant_id=tenant_id,
                    sales_order_id=so.id,
                    action="JOB_CARD_CREATED",
                    previous_status=ws,
                    new_status=ws,
                    user_id=user.id,
                    user_name=user.full_name,
                    team=TEAM_SALES,
                    details="Job card created",
                )
            )
            create_material_check_for_order(db, tenant_id, so)

    db.commit()
    db.refresh(jc)
    return build_sales_job_card(db, tenant_id, sales_order_id, user=user) or {}


def _editable_sections_for_user(user: User | None, workflow_status: str | None) -> list[str]:
    from app.core.permissions import get_role_names, user_is_admin
    from app.core.workflow_constants import user_teams

    if user_is_admin(user):
        return ["sales", "inventory", "production", "operator", "quality", "packing", "billing"]
    teams = user_teams(get_role_names(user)) if user else frozenset()
    ws = (workflow_status or "").upper()
    sections: list[str] = []
    if "sales" in teams and ws in {"", "DRAFT", "SALES_CONFIRMED", "MATERIAL_CHECK_PENDING"}:
        sections.append("sales")
    if "inventory" in teams and ws in {
        "MATERIAL_CHECK_PENDING",
        "MATERIAL_SHORTAGE",
        "MATERIAL_PARTIAL",
        "MATERIAL_AVAILABLE",
    }:
        sections.append("inventory")
    if "inventory" in teams and ws in {
        "MATERIAL_AVAILABLE",
        "STORE_ISSUE_PENDING",
        "STORE_ISSUE_PARTIAL",
    }:
        sections.extend(["sales", "inventory", "production", "operator", "quality", "packing", "billing"])
    if "production" in teams and ws in {
        "READY_FOR_PRODUCTION",
        "PRODUCTION_ASSIGNED",
        "PRODUCTION_REWORK",
        "QUALITY_REJECTED",
    }:
        sections.append("production")
    if "operator" in teams and ws in {"PRODUCTION_ASSIGNED", "PRODUCTION_IN_PROGRESS"}:
        sections.append("operator")
    if "quality" in teams and ws == "QUALITY_CHECK_PENDING":
        sections.append("quality")
    if "packing" in teams and ws in {
        "QUALITY_APPROVED",
        "PACKING_PENDING",
        "PACKING_IN_PROGRESS",
        "PACKING_ISSUE",
    }:
        sections.append("packing")
    if "billing" in teams and ws in {"BILLING_PENDING", "BILLING_HOLD", "PACKED"}:
        sections.append("billing")
    return sections


def _allowed_actions(
    user: User | None,
    workflow_status: str | None,
    has_wo: bool,
    *,
    job_card_created: bool = False,
) -> list[str]:
    sections = _editable_sections_for_user(user, workflow_status)
    actions: list[str] = []
    ws = (workflow_status or "").upper()
    if "sales" in sections:
        actions.append("confirm_order")
        if not job_card_created:
            actions.extend(["save_job_card", "create_job_card"])
        else:
            actions.append("save_job_card")
    if "inventory" in sections:
        actions.extend(["submit_material_check", "mark_materials_available", "mark_material_shortage"])
    if "production" in sections and has_wo:
        actions.append("assign_operator")
    if "operator" in sections and has_wo:
        actions.extend(["start_production", "complete_production"])
    if "quality" in sections:
        actions.extend(["approve_qc", "reject_qc"])
    if "packing" in sections:
        actions.append("complete_packing")
    if "billing" in sections:
        actions.append("create_invoice")
    if ws == "COMPLETED":
        actions = ["view"]
    return actions


def build_sales_job_card(
    db: Session, tenant_id: int, sales_order_id: int, user: User | None = None
) -> dict[str, Any] | None:
    """Job card document generated from a sales order (uses WO when available)."""
    from app.models.manufacturing_workflow import SalesOrderMaterialCheck
    from app.models.product import Product
    from app.models.sales import SalesOrder, SalesOrderLine
    from app.services.workflow_state_service import infer_workflow_status_from_legacy
    from sqlalchemy.orm import selectinload

    so = db.scalars(
        select(SalesOrder)
        .options(selectinload(SalesOrder.customer), selectinload(SalesOrder.line_items))
        .where(
            SalesOrder.id == sales_order_id,
            SalesOrder.tenant_id == tenant_id,
        )
    ).first()
    if not so:
        return None

    lines = list(
        db.scalars(select(SalesOrderLine).where(SalesOrderLine.sales_order_id == so.id)).all()
    )
    line = lines[0] if lines else None
    product_name = line.item_description if line else None
    if line and line.product_id:
        prod = db.get(Product, line.product_id)
        product_name = prod.name if prod else product_name

    customer_name = so.customer.name if so.customer else None
    workflow_status = so.workflow_status or infer_workflow_status_from_legacy(db, tenant_id, so)
    jc = _get_persisted_job_card(db, tenant_id, sales_order_id)
    product_code = ""
    if line and line.product_id:
        prod = db.get(Product, line.product_id)
        product_code = (prod.sku if prod else "") or ""

    material_check = db.scalars(
        select(SalesOrderMaterialCheck)
        .options(selectinload(SalesOrderMaterialCheck.lines))
        .where(
            SalesOrderMaterialCheck.tenant_id == tenant_id,
            SalesOrderMaterialCheck.sales_order_id == so.id,
        )
    ).first()

    po = db.scalars(
        select(ProductionOrder).where(
            ProductionOrder.tenant_id == tenant_id,
            ProductionOrder.sales_order_id == so.id,
        )
    ).first()
    wo = None
    if po:
        wo = db.scalars(
            select(WorkOrder).where(WorkOrder.production_order_id == po.id)
        ).first()

    if wo:
        card = build_job_card(db, tenant_id, wo.id, user=user) or {}
    else:
        jc_no = jc.job_card_no if jc else f"JC-{so.order_number}"
        card = {
            "id": jc.id if jc else None,
            "work_order_id": None,
            "job_card_no": jc_no,
            "status": so.status,
            "display_status": (workflow_status or so.status or "draft").replace("_", " "),
            "priority": so.priority or "medium",
            "header": {
                "sales_order_id": so.id,
                "sales_order_no": so.order_number,
                "customer": customer_name,
                "sales_person": so.sales_person,
                "product": product_name,
                "order_qty": float(line.quantity if line else 0),
                "uom": line.unit if line and line.unit else "Nos",
                "required_delivery": _fmt_date(so.delivery_date),
            },
            "summary": {
                "target_qty": float(line.quantity if line else 0),
                "produced_qty": 0,
                "rejected_qty": 0,
                "good_qty": 0,
                "balance_qty": float(line.quantity if line else 0),
                "progress_pct": 0,
            },
            "materials": [],
            "workflow": [],
        }

    card["sales_order_id"] = so.id
    card["workflow_status"] = workflow_status
    card["workflow_stage"] = _workflow_stage_label(workflow_status)
    job_card_created = bool(jc and jc.status == "created")
    card["editable_sections"] = _editable_sections_for_user(user, workflow_status)
    card["allowed_actions"] = _allowed_actions(
        user, workflow_status, bool(wo), job_card_created=job_card_created
    )
    priority_val = (jc.priority if jc else so.priority or card.get("priority") or "medium").lower()
    delivery_display = _fmt_date(
        jc.required_delivery_date if jc and jc.required_delivery_date else so.delivery_date
    )
    card["summary_panel"] = {
        "job_card_no": jc.job_card_no if jc else card.get("job_card_no") or f"JC-{so.order_number}",
        "sales_order_no": so.order_number,
        "customer": customer_name,
        "product": card.get("header", {}).get("product") or product_name,
        "order_quantity": float(jc.quantity if jc else (card.get("header", {}).get("order_qty") or (line.quantity if line else 0))),
        "required_delivery": delivery_display,
        "priority": priority_val,
        "uom": jc.unit if jc else (card.get("header", {}).get("uom") or (line.unit if line else "Nos")),
        "workflow_status": workflow_status,
    }
    card["sales_order_summary"] = {
        "sales_order_no": so.order_number,
        "customer": customer_name,
        "product": product_name,
        "order_quantity": card["summary_panel"]["order_quantity"],
        "required_delivery": delivery_display,
        "priority": priority_val,
        "uom": card["summary_panel"]["uom"],
    }
    card["status_badge"] = {
        "label": "Sales Confirmed"
        if not job_card_created
        else _workflow_stage_label(workflow_status),
        "tone": "success" if not job_card_created or workflow_status in {"SALES_CONFIRMED", "COMPLETED"} else "info",
    }
    resolved_details = _resolve_job_card_details(
        db,
        jc,
        tenant_id=tenant_id,
        card=card,
        material_check=material_check,
    )
    card["details"] = resolved_details
    card["form"] = _serialize_job_card_form(
        db,
        so,
        line,
        jc,
        product_code=product_code,
        customer_name=customer_name,
        product_name=product_name,
        workflow_status=workflow_status,
        details=resolved_details,
    )
    creator_name = None
    if jc and jc.created_by_user_id:
        creator = db.get(User, jc.created_by_user_id)
        creator_name = creator.full_name if creator else None
        card["audit"] = {
            "created_by": creator_name,
            "created_by_id": jc.created_by_user_id,
            "created_at": jc.created_at.isoformat() if jc.created_at else None,
            "updated_at": jc.updated_at.isoformat() if jc.updated_at else None,
        }

    from app.services.sales_job_card_document import build_sales_job_card_document

    card["sales_document"] = build_sales_job_card_document(
        db,
        so=so,
        lines=lines,
        jc=jc,
        po=po,
        resolved_details=resolved_details,
        workflow_status=workflow_status,
        creator_name=creator_name,
    )
    wf_for_ui = "SALES_CONFIRMED" if not job_card_created else workflow_status
    card["workflow_steps"] = _build_job_card_workflow_steps(wf_for_ui)
    card["workflow_tracker"] = card["workflow_steps"]
    card["workflow_current_stage"] = _build_workflow_current_stage(wf_for_ui)
    card["timeline"] = _build_job_card_timeline(db, tenant_id, sales_order_id)
    card["job_card_created"] = job_card_created
    if jc:
        card["job_card_no"] = jc.job_card_no

    if job_card_created:
        from app.models.manufacturing_workflow import SalesOrderMaterialCheck
        from app.services.workflow_routing_service import build_store_queue_context
        from sqlalchemy.orm import selectinload

        mc = db.scalars(
            select(SalesOrderMaterialCheck)
            .options(selectinload(SalesOrderMaterialCheck.lines))
            .where(
                SalesOrderMaterialCheck.tenant_id == tenant_id,
                SalesOrderMaterialCheck.sales_order_id == so.id,
            )
        ).first()
        card["store_context"] = build_store_queue_context(
            db,
            tenant_id,
            so,
            job_card=jc,
            material_check=mc,
            work_order_id=wo.id if wo else None,
        )

    return card


def list_sales_job_cards_by_workflow(
    db: Session, tenant_id: int, *, status_filter: str | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    """List job cards grouped by sales order workflow status (admin hub)."""
    from app.models.sales import SalesOrder

    q = select(SalesOrder).where(SalesOrder.tenant_id == tenant_id)
    if status_filter:
        q = q.where(SalesOrder.workflow_status == status_filter.upper())
    else:
        q = q.where(SalesOrder.workflow_status.isnot(None))
    orders = list(db.scalars(q.order_by(SalesOrder.id.desc()).limit(limit)).all())
    items = []
    for so in orders:
        card = build_sales_job_card(db, tenant_id, so.id)
        if card:
            items.append(
                {
                    "sales_order_id": so.id,
                    "job_card_no": card.get("job_card_no"),
                    "order_number": so.order_number,
                    "workflow_status": so.workflow_status,
                    "workflow_stage": card.get("workflow_stage"),
                    "summary_panel": card.get("summary_panel"),
                    "work_order_id": card.get("work_order_id"),
                }
            )
    return items
