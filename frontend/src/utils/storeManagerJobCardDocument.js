/** Store Manager Job Card document builder (STIC-style reference layout). */

import { fmtDate, formatCompanyAddress } from "./salesJobCardDocument";

function display(value) {
  if (value == null || value === "") return "—";
  return String(value);
}

function mapMaterialLines(materials) {
  if (!Array.isArray(materials)) return [];

  return materials.map((m, i) => {
    const req = Number(m.required_qty ?? m.quantity ?? 0);
    const issued = Number(m.issued_qty ?? 0);
    const balance =
      m.remaining_qty != null
        ? Number(m.remaining_qty)
        : m.balance_qty != null
          ? Number(m.balance_qty)
          : Math.max(0, req - issued);
    return {
      sl_no: i + 1,
      material_code: m.material_code || m.product_code || m.sku || "",
      material_name:
        m.material_name || m.material || m.component_name || m.product_name || "",
      specification: m.specification || m.description || "",
      uom: m.unit || m.uom || "Nos",
      required_qty: req,
      issued_qty: issued,
      balance_qty: balance,
      batch_no: m.batch_no || m.batch_lot_no || "",
      remarks: m.remarks || m.stock_status || "",
    };
  });
}

export function buildStoreManagerJobCardDocument({
  manualCard = null,
  soCard = null,
  row = null,
  storeContext = null,
  materialCheck = null,
  companyProfile = null,
}) {
  const card = manualCard || soCard || {};
  const sd = card.sales_document || {};
  const manualDoc = card.manual_document || {};
  const header = sd.header || manualDoc.header || {};
  const order = sd.order_details || manualDoc.order || {};
  const productLines = sd.product_lines || manualDoc.product_lines || [];
  const specs = sd.technical_specifications || manualDoc.technical_specifications || [];
  const storeWf = card.store_workflow || {};
  const productionInstructions = card.details?.production?.production_instructions || "";

  const salesJcNo = row?.job_card_no || header.job_card_no || card.job_card_no || "";
  const smJobCardNo = salesJcNo
    ? String(salesJcNo).replace(/^JC-/i, "SM-")
    : row?.job_card_id
      ? `SM-${new Date().getFullYear()}-${String(row.job_card_id).padStart(4, "0")}`
      : "";

  const materialsSource = [
    card.material_check?.lines,
    card.details?.material_check?.lines,
    storeContext?.material_requirements,
    materialCheck?.lines,
    materialCheck?.materials,
  ].find((lines) => Array.isArray(lines) && lines.length > 0) || [];

  const materials = mapMaterialLines(materialsSource);
  const firstProduct = productLines[0] || {};
  const totalQty = productLines.reduce((sum, ln) => sum + (Number(ln.quantity) || 0), 0);

  const storeComments = (storeWf.store_comments || [])
    .map((c) => c.text)
    .filter(Boolean)
    .join("\n");

  const city = companyProfile?.city || "";
  const location = city ? `Main Store - ${city}` : "Main Store";

  return {
    header: {
      job_card_no: smJobCardNo,
      sales_job_card_no: salesJcNo,
      date: header.job_card_date || row?.job_card_date || row?.received_at,
      department: "Stores",
      location,
    },
    request: {
      request_type: "Material Issue",
      raised_by: card.audit?.created_by || row?.created_by || order.sales_person || "Sales",
      reference_no: header.sales_order_no || row?.order_number || salesJcNo,
      request_date: header.job_card_date || order.sales_order_date || row?.order_date,
      required_date: order.delivery_date || row?.delivery_date,
      purpose: order.end_use || order.product_category || "Production requirement",
      remarks: order.remarks || storeContext?.notes || "",
    },
    department: {
      department: "Production",
      job_card_no: salesJcNo || row?.order_number,
      product_code: firstProduct.product_code || row?.product_code,
      product_name: firstProduct.product_name || row?.product_name,
      process: order.product_category || "",
      machine: "—",
      planned_quantity: totalQty || row?.quantity,
      uom: firstProduct.uom || firstProduct.unit || row?.unit || "Nos",
    },
    materials,
    instructions: String(productionInstructions)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    store_comments: storeComments || storeWf.return_remarks || storeContext?.notes || "",
    approval: {
      prepared_by: storeWf.acknowledged_by || "",
      verified_by: "",
      approved_by: userNameFromStore(storeWf),
      date: storeWf.acknowledged_at ? fmtDate(storeWf.acknowledged_at) : fmtDate(header.job_card_date),
    },
    company: {
      name: companyProfile?.company_name || companyProfile?.legal_name || companyProfile?.name || "",
      address: formatCompanyAddress(companyProfile),
    },
  };
}

function userNameFromStore(storeWf) {
  if (storeWf?.acknowledged_by) return storeWf.acknowledged_by;
  return "";
}

export { display as smjcDisplay };
