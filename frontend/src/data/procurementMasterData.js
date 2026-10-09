/** Procurement demo data and helpers. */

export const MR_PRIORITIES = ["low", "medium", "high", "urgent"];
export const MR_DEPARTMENTS = ["Production", "Maintenance", "Quality", "Stores", "Engineering"];
export const PROCUREMENT_FLOW = [
  "Production", "Material Requirement", "Material Request", "Manager Approval",
  "Request for Quotation (RFQ)", "Vendor Quotations", "Quotation Comparison", "Purchase Order",
  "Vendor Delivery", "Goods Receipt Note (GRN)", "Quality Inspection", "Raw Material Inventory",
  "Vendor Invoice", "Payment", "Ledger",
];

export const DEMO_MR_SUMMARY = { total_requests: 0, pending_approval: 0, approved: 0, rejected: 0, converted_to_rfq: 0, urgent_requests: 0 };
export const DEMO_MR_LIST = [];

export const DEMO_RFQ_SUMMARY = { open_rfqs: 0, vendor_responses: 0, expired_rfqs: 0, awarded_rfqs: 0 };
export const DEMO_RFQ_LIST = [];
export const DEMO_VENDOR_COMPARISON = [];

export const DEMO_PO_SUMMARY = { total_po: 0, pending: 0, approved: 0, delivered: 0, cancelled: 0, po_value: 0 };
export const DEMO_PO_LIST = [];

export const DEMO_GRN_SUMMARY = { todays_grn: 0, pending_qc: 0, received: 0, rejected: 0, total_value: 0 };
export const DEMO_GRN_LIST = [];

export const DEMO_BILL_SUMMARY = { total_bills: 0, due_bills: 0, paid: 0, outstanding: 0 };
export const DEMO_BILL_LIST = [];

export const DEMO_PROCUREMENT_HUB = {
  purchase_spend: 0,
  pending_approvals: 0,
  open_rfqs: 0,
  active_vendors: 0,
  outstanding_bills: 0,
  todays_deliveries: 0,
  top_vendors: [],
  pending_orders: [],
  alerts: [],
};

export function formatInr(v) {
  if (v == null || v === "") return "₹0";
  const n = Number(v);
  if (Number.isNaN(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN")}`;
}

export function filterPurchaseOrdersByStatus(rows, statusFilter = "") {
  return rows.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return statusFilter ? status === statusFilter : status !== "cancelled";
  });
}

export function priorityColor(p) {
  const m = { urgent: "bg-red-100 text-red-800", high: "bg-orange-100 text-orange-800", medium: "bg-blue-100 text-blue-800", low: "bg-slate-100 text-slate-700" };
  return m[p] || m.medium;
}

export function statusColor(s) {
  const m = { pending: "bg-amber-100 text-amber-800", approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", open: "bg-blue-100 text-blue-800", awarded: "bg-emerald-100 text-emerald-800", expired: "bg-slate-200 text-slate-700", draft: "bg-slate-100 text-slate-700", delivered: "bg-teal-100 text-[var(--color-success)]", paid: "bg-green-100 text-green-800", due: "bg-orange-100 text-orange-800" };
  return m[s] || "bg-slate-100 text-slate-700";
}
