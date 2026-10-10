"""Production job card extended details — parse, merge, validate."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

LOCAL_TYPES = frozenset({"local", "non-local", "non_local", "non local"})


def empty_details() -> dict[str, Any]:
    return {
        "job_info": {
            "location": "",
            "issue_date": "",
            "issue_time": "",
            "po_date": "",
            "po_time": "",
            "local_type": "",
        },
        "raw_materials": [],
        "production": {
            "process": "",
            "machine_id": None,
            "machine_name": "",
            "operator_id": None,
            "operator_name": "",
            "planned_quantity": None,
            "uom": "",
            "start_date": "",
            "start_time": "",
            "due_date": "",
            "due_time": "",
            "slitting_size": "",
            "production_instructions": "",
            "remarks": "",
        },
        "output": {
            "output_quantity": None,
            "output_uom": "",
            "width": "",
            "gsm": "",
            "colour": "",
            "cra_percent": None,
            "good_quantity": None,
            "rejected_quantity": None,
            "wastage_quantity": None,
            "batch_lot_no": "",
            "remarks": "",
        },
        "approval": {
            "prepared_by": "",
            "prepared_by_id": None,
            "prepared_date": "",
            "checked_by": "",
            "checked_by_id": None,
            "checked_date": "",
            "approved_by": "",
            "approved_by_id": None,
            "approved_date": "",
            "remarks": "",
        },
    }


def parse_details_json(raw: str | None) -> dict[str, Any]:
    base = empty_details()
    if not raw:
        return base
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return base
    if not isinstance(data, dict):
        return base
    return merge_details(base, data)


def serialize_details_json(details: dict[str, Any]) -> str:
    return json.dumps(details or empty_details(), separators=(",", ":"), default=str)


def merge_details(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    result = empty_details()
    for key in ("job_info", "production", "output", "approval"):
        src = existing.get(key) if isinstance(existing.get(key), dict) else {}
        p = patch.get(key) if isinstance(patch.get(key), dict) else {}
        merged = {**result[key], **src, **p}
        result[key] = merged
    if isinstance(patch.get("raw_materials"), list):
        result["raw_materials"] = [_normalize_material_row(r) for r in patch["raw_materials"]]
    elif isinstance(existing.get("raw_materials"), list):
        result["raw_materials"] = [_normalize_material_row(r) for r in existing["raw_materials"]]
    if isinstance(patch.get("manual_document"), dict):
        result["manual_document"] = patch["manual_document"]
    elif isinstance(existing.get("manual_document"), dict):
        result["manual_document"] = existing["manual_document"]
    if isinstance(patch.get("store_workflow"), dict):
        result["store_workflow"] = patch["store_workflow"]
    elif isinstance(existing.get("store_workflow"), dict):
        result["store_workflow"] = existing["store_workflow"]
    if isinstance(patch.get("send_assignments"), list):
        result["send_assignments"] = list(patch["send_assignments"])
    elif isinstance(existing.get("send_assignments"), list):
        result["send_assignments"] = list(existing["send_assignments"])
    if isinstance(patch.get("send_history"), list):
        result["send_history"] = list(patch["send_history"])
    elif isinstance(existing.get("send_history"), list):
        result["send_history"] = list(existing["send_history"])
    if isinstance(patch.get("material_check"), dict):
        result["material_check"] = patch["material_check"]
    elif isinstance(existing.get("material_check"), dict):
        result["material_check"] = existing["material_check"]
    if isinstance(patch.get("workflow_history"), list):
        result["workflow_history"] = list(patch["workflow_history"])
    elif isinstance(existing.get("workflow_history"), list):
        result["workflow_history"] = list(existing["workflow_history"])
    return result


def _normalize_material_row(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    return {
        "sl_no": row.get("sl_no"),
        "material_name": _trim(row.get("material_name")),
        "material_code": _trim(row.get("material_code")),
        "paper_type": _trim(row.get("paper_type")),
        "gsm": _trim(row.get("gsm")),
        "mill_grade": _trim(row.get("mill_grade")),
        "quantity": row.get("quantity"),
        "uom": _trim(row.get("uom")),
        "batch_lot_no": _trim(row.get("batch_lot_no")),
        "quality": _trim(row.get("quality")),
        "remarks": _trim(row.get("remarks")),
        "product_id": row.get("product_id"),
        "inventory_item_id": row.get("inventory_item_id"),
    }


def _trim(value: Any, max_len: int = 500) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def _positive_num(value: Any, field: str, errors: dict[str, str], *, required: bool = False) -> None:
    if value is None or value == "":
        if required:
            errors[field] = "Required"
        return
    try:
        n = float(value)
    except (TypeError, ValueError):
        errors[field] = "Must be a number"
        return
    if n < 0:
        errors[field] = "Must be zero or greater"


def _percent(value: Any, field: str, errors: dict[str, str]) -> None:
    if value is None or value == "":
        return
    try:
        n = float(value)
    except (TypeError, ValueError):
        errors[field] = "Must be a number"
        return
    if n < 0 or n > 100:
        errors[field] = "Must be between 0 and 100"


def validate_details(
    details: dict[str, Any],
    *,
    editable_sections: list[str],
    job_card_created: bool,
    finalize: bool = False,
    active_detail_sections: list[str] | None = None,
) -> dict[str, str]:
    """Return field-keyed validation errors for editable sections."""
    errors: dict[str, str] = {}
    allowed = set(editable_sections or [])
    if active_detail_sections is not None:
        sections = allowed.intersection(set(active_detail_sections))
    elif finalize:
        sections = allowed
    else:
        sections = allowed
    if not sections and not finalize:
        return errors

    job_info = details.get("job_info") or {}
    production = details.get("production") or {}
    output = details.get("output") or {}
    raw_materials = details.get("raw_materials") or []

    if "sales" in sections or finalize:
        lt = _trim(job_info.get("local_type")).lower().replace("_", "-")
        if lt and lt not in LOCAL_TYPES:
            errors["details.job_info.local_type"] = "Must be Local or Non-Local"

    if "inventory" in sections or finalize:
        for i, row in enumerate(raw_materials):
            if not _trim(row.get("material_name")):
                errors[f"details.raw_materials.{i}.material_name"] = "Material name is required"
            _positive_num(row.get("quantity"), f"details.raw_materials.{i}.quantity", errors)

    if "production" in sections or "operator" in sections or finalize:
        process = _trim(production.get("process"))
        if ("production" in sections or finalize) and job_card_created and not process:
            errors["details.production.process"] = "Process is required"
        if process and "slitting" in process.lower():
            if not _trim(production.get("slitting_size")):
                errors["details.production.slitting_size"] = "Slitting size is required for slitting process"
        if "production" in sections or finalize:
            if job_card_created and not _trim(production.get("machine_name")) and not production.get("machine_id"):
                errors["details.production.machine_name"] = "Machine is required"
        _positive_num(
            production.get("planned_quantity"),
            "details.production.planned_quantity",
            errors,
            required=("production" in sections and job_card_created),
        )

    if "quality" in sections or "operator" in sections or finalize:
        _positive_num(output.get("output_quantity"), "details.output.output_quantity", errors)
        _positive_num(output.get("good_quantity"), "details.output.good_quantity", errors)
        _positive_num(output.get("rejected_quantity"), "details.output.rejected_quantity", errors)
        _positive_num(output.get("wastage_quantity"), "details.output.wastage_quantity", errors)
        _percent(output.get("cra_percent"), "details.output.cra_percent", errors)
        gsm = _trim(output.get("gsm"))
        if gsm and not re.match(r"^\d+(\.\d+)?$", gsm):
            errors["details.output.gsm"] = "GSM must be numeric"
        width = _trim(output.get("width"))
        if width and not re.match(r"^\d+(\.\d+)?(\s*[xX×]\s*\d+(\.\d+)?)?$", width.replace(" ", "")):
            if not re.match(r"^\d+(\.\d+)?$", width):
                errors["details.output.width"] = "Invalid width format"

    return errors


def queue_fields_from_details(details: dict[str, Any]) -> dict[str, Any]:
    prod = details.get("production") or {}
    out = details.get("output") or {}
    planned = prod.get("planned_quantity")
    output_qty = out.get("good_quantity") or out.get("output_quantity")
    return {
        "machine_name": prod.get("machine_name") or None,
        "operator_name": prod.get("operator_name") or None,
        "planned_qty": float(planned) if planned not in (None, "") else None,
        "output_qty": float(output_qty) if output_qty not in (None, "") else None,
        "production_start_date": prod.get("start_date") or None,
        "production_due_date": prod.get("due_date") or None,
    }


def build_raw_materials_from_material_check(
    db: Session,
    tenant_id: int,
    lines: list[Any],
) -> list[dict[str, Any]]:
    from app.models.product import Product

    rows: list[dict[str, Any]] = []
    for i, ln in enumerate(lines or [], start=1):
        if isinstance(ln, dict):
            code = ln.get("material_code") or ln.get("sku") or ln.get("product_code") or ""
            name = ln.get("material_name") or ""
            qty = float(ln.get("required_qty") or 0)
            uom = ln.get("uom") or ""
            rem = ln.get("stock_location") or ln.get("remarks") or ""
            pid = ln.get("product_id")
            iid = ln.get("inventory_item_id")
        else:
            code = getattr(ln, "material_code", "") or getattr(ln, "sku", "") or getattr(ln, "product_code", "") or ""
            name = getattr(ln, "material_name", "") or ""
            qty = float(getattr(ln, "required_qty", 0) or 0)
            uom = getattr(ln, "uom", "Nos") or "Nos"
            rem = getattr(ln, "stock_location", "") or getattr(ln, "remarks", "") or ""
            pid = getattr(ln, "product_id", None)
            iid = getattr(ln, "inventory_item_id", None)

        product = (
            db.scalars(
                select(Product).where(
                    Product.id == pid,
                    Product.tenant_id == tenant_id,
                )
            ).first()
            if pid
            else None
        )
        rows.append(
            {
                "sl_no": i,
                "material_name": name,
                "material_code": code or (product.sku if product else ""),
                "paper_type": "",
                "gsm": "",
                "mill_grade": "",
                "quantity": qty,
                "uom": uom or (product.unit if product else None) or "Nos",
                "batch_lot_no": "",
                "quality": "",
                "remarks": rem,
                "product_id": pid,
                "inventory_item_id": iid,
            }
        )
    return rows


def build_raw_materials_from_bom(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i, m in enumerate(materials or [], start=1):
        rows.append(
            {
                "sl_no": i,
                "material_name": m.get("name") or m.get("material_name") or "",
                "material_code": m.get("code") or m.get("sku") or "",
                "paper_type": m.get("paper_type") or "",
                "gsm": m.get("gsm") or "",
                "mill_grade": m.get("mill_grade") or "",
                "quantity": m.get("required_qty") or m.get("quantity"),
                "uom": m.get("uom") or m.get("unit") or "Nos",
                "batch_lot_no": m.get("batch_lot_no") or "",
                "quality": m.get("quality") or "",
                "remarks": m.get("remarks") or "",
                "product_id": m.get("product_id"),
                "inventory_item_id": m.get("inventory_item_id"),
            }
        )
    return rows
