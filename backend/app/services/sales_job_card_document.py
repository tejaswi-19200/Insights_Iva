"""Build structured Sales Job Card document payload from SO / customer / product data."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session


def _fmt_date(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _customer_address(customer) -> str:
    if not customer:
        return ""
    metadata_start = re.compile(
        r"(?:^|,\s*|\|\s*)(?:Payment Terms|Balance|Party type|GST Treatment):",
        re.IGNORECASE,
    )
    candidates = [
        customer.address_line1,
        customer.address_line2,
        customer.city,
        customer.state,
        customer.pincode,
    ]
    parts: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        cleaned = metadata_start.split(str(candidate or ""), maxsplit=1)[0]
        for part in re.split(r"[,\r\n]+", cleaned):
            value = part.strip()
            key = re.sub(r"[^a-z0-9]", "", value.casefold())
            if key and key not in seen:
                seen.add(key)
                parts.append(value)
    return ", ".join(parts)


def _append_spec(specs: list[dict[str, Any]], parameter: str, specification: Any) -> None:
    if specification is None:
        return
    text = str(specification).strip()
    if not text:
        return
    specs.append({"sl_no": len(specs) + 1, "parameter": parameter, "specification": text})


def _specs_from_production_order(po) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    if not po:
        return specs
    mapping = [
        ("Base Material / Face Paper", po.face_paper_paper),
        ("Face Paper GSM", po.face_paper_gsm),
        ("Face Paper Mill Grade", po.face_paper_mill_grade),
        ("Face Paper Thickness (µ)", po.face_paper_thick_microns),
        ("Coating GSM", po.coating_gsm),
        ("Coating Width (mm)", po.coating_width_mm),
        ("Coating Colour", po.coating_colour),
        ("Coating CRA %", po.coating_cra_pct),
        ("Coating Mill Grade", po.coating_mill_grade),
        ("Coating Quality", po.coating_quality),
        ("Release GSM / Sq.M", po.release_gsm_sqmtrs),
        ("Release Size (Nos)", po.release_size_nos),
    ]
    for label, val in mapping:
        _append_spec(specs, label, val)
    return specs


def _specs_from_details(details: dict[str, Any] | None) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    if not details:
        return specs
    production = details.get("production") or {}
    output = details.get("output") or {}
    _append_spec(specs, "Process", production.get("process"))
    _append_spec(specs, "Slitting Size", production.get("slitting_size"))
    _append_spec(specs, "Planned Quantity", production.get("planned_quantity"))
    _append_spec(specs, "Width", output.get("width"))
    _append_spec(specs, "GSM", output.get("gsm"))
    _append_spec(specs, "Colour", output.get("colour"))
    _append_spec(specs, "CRA %", output.get("cra_percent"))
    for row in details.get("raw_materials") or []:
        name = row.get("material_name") or "Material"
        if row.get("gsm"):
            _append_spec(specs, f"{name} GSM", row.get("gsm"))
        if row.get("mill_grade"):
            _append_spec(specs, f"{name} Mill Grade", row.get("mill_grade"))
        if row.get("paper_type"):
            _append_spec(specs, f"{name} Paper Type", row.get("paper_type"))
    return specs


def _specs_from_product(db: Session, product_id: int | None) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    if not product_id:
        return specs
    from app.models.product import Product

    prod = db.get(Product, product_id)
    if not prod:
        return specs
    _append_spec(specs, "Product Category", prod.category)
    _append_spec(specs, "HSN Code", prod.hsn_code)
    _append_spec(specs, "Description", prod.description)
    return specs


def _job_card_status_label(jc, workflow_status: str | None) -> str:
    if not jc:
        return "Draft"
    if jc.status == "draft":
        return "Draft"
    if jc.status == "created":
        ws = (workflow_status or jc.workflow_stage or "").upper()
        if ws in {"COMPLETED"}:
            return "Completed"
        if ws in {"CANCELLED"}:
            return "Cancelled"
        if ws in {"", "SALES_CONFIRMED", "MATERIAL_CHECK_PENDING"}:
            return "Created"
        return "In Progress"
    return (jc.status or "Draft").replace("_", " ").title()


def build_sales_job_card_document(
    db: Session,
    *,
    so,
    lines: list,
    jc=None,
    po=None,
    resolved_details: dict[str, Any] | None = None,
    workflow_status: str | None = None,
    creator_name: str | None = None,
) -> dict[str, Any]:
    """Aggregate customer, order, lines, and specs for the Sales Job Card UI."""
    from app.models.product import Product

    customer = so.customer
    product_lines: list[dict[str, Any]] = []
    categories: list[str] = []

    for i, ln in enumerate(lines, start=1):
        prod = db.get(Product, ln.product_id) if ln.product_id else None
        code = (prod.sku if prod else "") or ""
        name = (prod.name if prod else None) or ln.item_description or ""
        desc = (prod.description if prod else None) or ln.item_description or ""
        if prod and prod.category:
            categories.append(prod.category)
        product_lines.append(
            {
                "sl_no": i,
                "product_id": ln.product_id,
                "product_code": code,
                "product_name": name,
                "description": desc,
                "quantity": float(ln.quantity or 0),
                "uom": ln.unit or (prod.unit if prod else "Nos") or "Nos",
            }
        )

    specs: list[dict[str, Any]] = []
    for block in (
        _specs_from_production_order(po),
        _specs_from_details(resolved_details),
    ):
        for row in block:
            if not any(s["parameter"] == row["parameter"] for s in specs):
                row["sl_no"] = len(specs) + 1
                specs.append(row)

    if not specs and lines:
        for ln in lines:
            for row in _specs_from_product(db, ln.product_id):
                if not any(s["parameter"] == row["parameter"] for s in specs):
                    row["sl_no"] = len(specs) + 1
                    specs.append(row)

    jc_date = _fmt_date(jc.created_at.date() if jc and jc.created_at else so.order_date)
    approval = (resolved_details or {}).get("approval") or {}

    return {
        "header": {
            "job_card_no": jc.job_card_no if jc else None,
            "job_card_date": jc_date,
            "sales_order_no": so.order_number,
            "customer_po_no": so.reference_number,
            "status": _job_card_status_label(jc, workflow_status),
            "workflow_status": workflow_status,
        },
        "customer_details": {
            "customer_name": customer.name if customer else None,
            "contact_person": customer.contact_name if customer else None,
            "phone": customer.phone if customer else None,
            "email": customer.email if customer else None,
            "billing_address": _customer_address(customer),
        },
        "order_details": {
            "sales_order_date": _fmt_date(so.order_date),
            "delivery_date": _fmt_date(
                jc.required_delivery_date if jc and jc.required_delivery_date else so.delivery_date
            ),
            "product_category": ", ".join(dict.fromkeys(categories)) if categories else None,
            "end_use": None,
            "payment_terms": so.payment_terms,
            "priority": (jc.priority if jc else so.priority) or "medium",
            "remarks": jc.notes if jc else None,
            "sales_person": jc.sales_person_name if jc and jc.sales_person_name else so.sales_person,
        },
        "product_lines": product_lines,
        "technical_specifications": specs,
        "approval": {
            "prepared_by": approval.get("prepared_by") or creator_name,
            "prepared_date": approval.get("prepared_date") or jc_date,
            "checked_by": approval.get("checked_by"),
            "checked_date": approval.get("checked_date"),
            "approved_by": approval.get("approved_by"),
            "approved_date": approval.get("approved_date"),
            "customer_acknowledgement": approval.get("customer_acknowledgement"),
        },
    }
