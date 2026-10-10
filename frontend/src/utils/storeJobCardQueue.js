import { jobCardDetailsUrl } from "./jobCardRoutes";
import { stageJobCardUrl } from "./workflowStageRoutes";

/** Matches backend ACTIONABLE_STATUSES_BY_TEAM for inventory (strict my-queue). */
export const STORE_ACTIONABLE_STATUSES = new Set([
  "MATERIAL_CHECK_PENDING",
  "MATERIAL_SHORTAGE",
  "MATERIAL_PARTIAL",
  "MATERIAL_AVAILABLE",
  "STORE_ISSUE_PENDING",
  "STORE_ISSUE_PARTIAL",
]);

export const STORE_STATUS_BUCKETS = {
  store_pending: ["MATERIAL_CHECK_PENDING", "MATERIAL_SHORTAGE"],
  ready_to_issue: ["MATERIAL_AVAILABLE", "STORE_ISSUE_PENDING"],
  partially_issued: ["STORE_ISSUE_PARTIAL", "MATERIAL_PARTIAL"],
};

const STORE_STATUS_LABELS = {
  MATERIAL_CHECK_PENDING: "Inventory Check Pending",
  MATERIAL_SHORTAGE: "Material Shortage",
  MATERIAL_AVAILABLE: "Materials Available",
  STORE_ISSUE_PENDING: "Ready to Issue",
  MATERIAL_PARTIAL: "Materials Partially Available",
  STORE_ISSUE_PARTIAL: "Partially Issued",
};

const STORE_STATUS_VARIANTS = {
  MATERIAL_CHECK_PENDING: "warning",
  MATERIAL_SHORTAGE: "danger",
  MATERIAL_AVAILABLE: "success",
  STORE_ISSUE_PENDING: "warning",
  MATERIAL_PARTIAL: "warning",
  STORE_ISSUE_PARTIAL: "info",
};

export const STORE_STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "store_pending", label: "Store Pending" },
  { value: "ready_to_issue", label: "Ready to Issue" },
  { value: "partially_issued", label: "Partially Issued" },
];

const ACTION_LABELS = {
  view: "Open Job Card",
  check_stock: "Inventory Check",
  record_shortage: "Record Shortage",
  issue_materials: "Issue Material",
  partial_issue: "Partial Issue",
  send_to_production: "Complete Store Stage",
  hold: "Hold",
  add_remarks: "Add Remarks",
};

export function storeStatusVariant(row) {
  const ws = String(row?.workflow_status || "").toUpperCase();
  return STORE_STATUS_VARIANTS[ws] || "warning";
}

export function storeQueueStatusLabel(row) {
  const ws = String(row?.workflow_status || "").toUpperCase();
  if (STORE_STATUS_LABELS[ws]) return STORE_STATUS_LABELS[ws];
  if (row?.queue_status_label) return row.queue_status_label;
  return row?.status_label || row?.status || "—";
}

function jobCardSortNumber(row) {
  const jno = String(row?.job_card_no || row?.order_number || "").trim();
  const match = jno.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/** Stable ascending order for store serial numbers (aligned with backend queue). */
export function compareStoreQueueRows(a, b) {
  const na = jobCardSortNumber(a);
  const nb = jobCardSortNumber(b);
  if (na !== nb) return na - nb;
  const ja = String(a?.job_card_no || a?.order_number || "").toLowerCase();
  const jb = String(b?.job_card_no || b?.order_number || "").toLowerCase();
  if (ja !== jb) return ja.localeCompare(jb);
  const ta = String(a?.received_at || a?.created_at || a?.order_date || "");
  const tb = String(b?.received_at || b?.created_at || b?.order_date || "");
  if (ta !== tb) return ta.localeCompare(tb);
  const ia = Number(a?.job_card_id || a?.sales_order_id || 0);
  const ib = Number(b?.job_card_id || b?.sales_order_id || 0);
  return ia - ib;
}

export function matchesStoreStatusBucket(row, bucketKey) {
  if (!bucketKey) return true;
  const ws = String(row?.workflow_status || "").toUpperCase();
  const bucket = STORE_STATUS_BUCKETS[bucketKey];
  if (bucket) return bucket.includes(ws);
  return ws === String(bucketKey).toUpperCase();
}

export function storeActionUrl(row, action) {
  if (row?.is_manual && row?.job_card_id) {
    const base = `/my-job-cards?dept=inventory&jc=${row.job_card_id}`;
    if (action === "view" || action === "check_stock" || action === "add_remarks") return base;
    return base;
  }
  const orderId = row?.sales_order_id ?? row?.id;
  if (!orderId) return "/my-job-cards";
  if (action === "view") return jobCardDetailsUrl(orderId);
  if (action === "hold" || action === "add_remarks") return null;
  if (action === "check_stock" || action === "record_shortage") {
    return stageJobCardUrl(orderId, row.workflow_status || "MATERIAL_CHECK_PENDING");
  }
  if (action === "issue_materials" || action === "partial_issue" || action === "send_to_production") {
    return `/manufacturing/workflow/order/${orderId}/store`;
  }
  return stageJobCardUrl(orderId, row.workflow_status);
}

export function storeRowMenuItems(row) {
  const actions = Array.isArray(row?.allowed_actions) ? row.allowed_actions : ["view"];
  return actions
    .filter((action) => ACTION_LABELS[action])
    .map((action) => ({
      key: action,
      label: ACTION_LABELS[action],
      to: storeActionUrl(row, action),
    }));
}

export function uniqueFilterValues(rows, key) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const value = String(row?.[key] || "").trim();
    if (!value) continue;
    const id = value.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
