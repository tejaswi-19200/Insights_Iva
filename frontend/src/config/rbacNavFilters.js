/** Production Manager sidebar sections (used when filtering generic nav; dedicated nav uses productionManagerNavConfig). */
export const PRODUCTION_MANAGER_ALLOWED_SECTIONS = new Set([
  "dashboard",
  "production",
  "materials",
  "masters",
  "quality",
  "maintenance",
  "alerts",
  "documents",
  "meetings",
  "chat",
  "analytics",
  "settings",
]);

/** Paths Production Manager may open (nav + deep links). */
export const PRODUCTION_MANAGER_ALLOWED_CHILDREN = new Set([
  "/production",
  "/production/dashboard",
  "/production/planning",
  "/production/work-orders",
  "/production/schedule",
  "/production/tasks",
  "/production/reports",
  "/my-job-cards",
  "/masters/bom",

  "/inventory/raw-materials",
  "/inventory/finished-goods",
  "/inventory/stock-transfer",
  "/inventory/pending-inventory-checks",
  "/inventory/material-requests",
  "/inventory/issue-materials",
  "/inventory/stock-return",
  "/procurement/material-requests",

  "/quality",
  "/quality/in-process",
  "/quality/final",
  "/quality/batch-reports",
  "/quality/defects",
  "/quality/inspection",
  "/hr/attendance",

  "/maintenance",
  "/maintenance/equipment",
  "/maintenance/preventive",
  "/maintenance/breakdowns",
  "/maintenance/machine-history",
  "/maintenance/schedule",

  "/alerts",
  "/alerts/low-stock",
  "/alerts/machine-failure",
  "/alerts/production-delay",
  "/alerts/maintenance",
  "/alerts/quality",

  "/documents",
  "/meetings",
  "/chat",
  "/analytics/production",
  "/settings",
]);

/** Operator may only open production execution paths (no management/admin). */
/** Production paths operators may open (planning / allocation excluded). */
export const OPERATOR_ALLOWED_CHILDREN = new Set([
  "/production/work-orders",
  "/production/schedule",
  "/production/my-machine",
  "/production/my-entry",
]);

export const OPERATOR_BLOCKED_CHILDREN = new Set([
  "/production/planning",
  "/production/tasks",
  "/production/reports",
]);

export const OPERATOR_ALLOWED_PATHS = new Set([
  "/",
  "/manufacturing/workflow",
  "/my-job-cards",
  "/production",
  "/production/dashboard",
  "/production/work-orders",
  "/production/schedule",
  "/production/my-machine",
  "/production/my-entry",
  "/factory-monitor/machine-status",
  "/factory-monitor/production-lines",
  "/factory-monitor/live-production",
  "/documents",
  "/documents/production",
  "/alerts",
  "/alerts/low-stock",
  "/alerts/machine-failure",
  "/alerts/production-delay",
  "/alerts/maintenance",
  "/alerts/quality",
  "/alerts/safety",
  "/alerts/general",
  "/hr/attendance",
  "/hr/attendance/approval",
  "/hr/attendance/overtime",
  "/hr/attendance/adjusted-leave",
  "/hr/attendance/settings",
  "/attendance",
  "/hr/leave",
  "/hr/leave/approvals",
  "/admin/approvals",
  "/hr/leave/holiday",
  "/hr/leave/adjustment",
  "/hr/leave/plans",
  "/hr/leave/plans/create",
  "/hr/leave/create",
  "/leave",
  "/settings",
  "/settings/my-account",
  "/settings/notifications",
  "/settings/appearance",
  "/settings/help",
  "/settings/about",
  "/settings/alerts",
]);

/** HR Manager sidebar — HR module plus shared collaboration sections. */
export const HR_MANAGER_ALLOWED_SECTIONS = new Set([
  "dashboard",
  "hr",
  "documents",
  "alerts",
  "analytics",
  "meetings",
  "chat",
  "settings",
]);

/** Accountant sidebar — Finance/Accounting, Masters, Documents, General Alerts, Finance Analytics. */
export const ACCOUNTANT_ALLOWED_SECTIONS = new Set([
  "dashboard",
  "myJobCards",
  "finance",
  "masters",
  "documents",
  "alerts",
  "analytics",
  "chat",
  "settings",
]);

export const ACCOUNTANT_ALLOWED_CHILDREN = new Set([
  "/accounts/settings",
  "/my-job-cards",
  "/alerts",
  "/alerts/general",
  "/analytics/finance",
  "/analytics/executive",
  "/hr/attendance",
  "/hr/attendance/approval",
  "/hr/attendance/overtime",
  "/hr/attendance/adjusted-leave",
  "/hr/attendance/settings",
  "/attendance",
  "/hr/leave",
  "/hr/leave/approvals",
  "/admin/approvals",
  "/hr/leave/holiday",
  "/hr/leave/adjustment",
  "/hr/leave/plans",
  "/hr/leave/plans/create",
  "/hr/leave/create",
  "/leave",
]);

/** Sidebar sections hidden for Operator regardless of module grant. */
export const OPERATOR_BLOCKED_SECTIONS = new Set([
  "masters",
  "inventory",
  "procurement",
  "sales",
  "finance",
  "quality",
  "maintenance",
  "analytics",
  "admin",
  "meetings",
]);

export function productionManagerPathAllowed(pathname) {
  if (!pathname) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return true;
  if (path === "/production" || path === "/production/dashboard") return true;
  if (PRODUCTION_MANAGER_ALLOWED_CHILDREN.has(path)) return true;
  if (path.startsWith("/my-job-cards/") || path.startsWith("/job-cards/")) return true;
  if (path.startsWith("/production/")) return true;
  if (path.startsWith("/inventory/raw-materials")) return true;
  if (path.startsWith("/inventory/finished-goods")) return true;
  if (path.startsWith("/inventory/stock-transfer")) return true;
  if (path.startsWith("/inventory/pending-inventory-checks")) return true;
  if (path.startsWith("/inventory/material-requests")) return true;
  if (path.startsWith("/inventory/issue-materials")) return true;
  if (path.startsWith("/inventory/stock-return")) return true;
  if (path.startsWith("/procurement/material-requests")) return true;
  if (path.startsWith("/quality")) {
    if (path === "/quality/incoming" || path.startsWith("/quality/incoming/")) return false;
    return true;
  }
  if (path.startsWith("/hr/attendance")) return true;
  if (path.startsWith("/maintenance/")) return true;
  if (path.startsWith("/alerts/")) {
    return (
      path === "/alerts" ||
      path === "/alerts/low-stock" ||
      path === "/alerts/machine-failure" ||
      path === "/alerts/production-delay" ||
      path === "/alerts/maintenance" ||
      path === "/alerts/quality"
    );
  }
  if (path.startsWith("/documents")) return true;
  if (path.startsWith("/meetings")) return true;
  if (path.startsWith("/chat")) return true;
  if (path === "/analytics/production" || path.startsWith("/analytics/production/")) return true;
  if (path.startsWith("/manufacturing/workflow")) return true;
  if (path === "/settings" || path.startsWith("/settings/")) return true;
  return false;
}

/** Paths Quality Control may open (nav + job-card workflow deep links). */
export const QUALITY_CONTROL_ALLOWED_CHILDREN = new Set([
  "/dashboard",
  "/quality",
  "/quality/incoming",
  "/quality/in-process",
  "/quality/final",
  "/quality/batch-reports",
  "/quality/inspection",
  "/quality/defects",
  "/production/planning",
  "/inventory/raw-materials",
  "/inventory/finished-goods",
  "/alerts",
  "/alerts/quality",
  "/alerts/production-delay",
  "/alerts/low-stock",
  "/documents",
  "/meetings",
  "/chat",
  "/analytics/production",
  "/settings",
  "/my-job-cards",
]);

export function qualityControlPathAllowed(pathname) {
  if (!pathname) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/" || path === "/dashboard") return true;
  if (QUALITY_CONTROL_ALLOWED_CHILDREN.has(path)) return true;
  if (path.startsWith("/my-job-cards/") || path.startsWith("/job-cards/")) return true;
  if (path.startsWith("/quality/")) {
    return (
      path === "/quality" ||
      path.startsWith("/quality/incoming") ||
      path.startsWith("/quality/in-process") ||
      path.startsWith("/quality/final") ||
      path.startsWith("/quality/batch-reports") ||
      path.startsWith("/quality/inspection") ||
      path.startsWith("/quality/defects")
    );
  }
  if (path.startsWith("/production/planning")) return true;
  if (path.startsWith("/inventory/raw-materials")) return true;
  if (path.startsWith("/inventory/finished-goods")) return true;
  if (path.startsWith("/alerts/")) {
    return (
      path === "/alerts" ||
      path === "/alerts/quality" ||
      path === "/alerts/production-delay" ||
      path === "/alerts/low-stock"
    );
  }
  if (path.startsWith("/documents")) return true;
  if (path.startsWith("/meetings")) return true;
  if (path.startsWith("/chat")) return true;
  if (path === "/analytics/production" || path.startsWith("/analytics/production/")) return true;
  if (path.startsWith("/manufacturing/workflow")) return true;
  if (path === "/settings" || path.startsWith("/settings/")) return true;
  return false;
}

export function operatorPathAllowed(pathname) {
  if (!pathname) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return true;
  if (
    path === "/my-job-cards" ||
    path.startsWith("/my-job-cards/") ||
    path.startsWith("/job-cards/") ||
    path === "/sales/job-cards/create"
  ) {
    return true;
  }
  if (OPERATOR_BLOCKED_CHILDREN.has(path)) return false;
  if (OPERATOR_ALLOWED_PATHS.has(path)) return true;
  if (path.startsWith("/production/")) {
    return OPERATOR_ALLOWED_CHILDREN.has(path) || path.startsWith("/production/work-orders/");
  }
  if (path.startsWith("/manufacturing/")) return true;
  if (path.startsWith("/factory-monitor/")) return true;
  if (path.startsWith("/documents")) return true;
  if (path.startsWith("/alerts")) return true;
  if (path === "/settings" || path.startsWith("/settings/")) return true;
  if (path.startsWith("/chat")) return true;
  return false;
}
