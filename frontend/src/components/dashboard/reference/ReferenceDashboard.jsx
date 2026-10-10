import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Clock,
  Gauge,
  IndianRupee,
  ListTodo,
  Package,
  ShoppingCart,
  Target,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

import DashboardReportExport from "../../common/DashboardReportExport";
import EmptyChart from "../../common/EmptyChart";
import { metricExportRows } from "../../../utils/dashboardExportRows";
import SkeletonCard, { SkeletonChart } from "../../common/SkeletonCard";
import AdminProductionWidgets from "./AdminProductionWidgets";
import AdminQuickActions from "./AdminQuickActions";
import ProductionPipeline from "./ProductionPipeline";
import { getErpDashboard } from "../../../api/dashboardApi";
import { getProductionOrders, getWorkOrders } from "../../../api/productionApi";
import { getMyApprovalCounts } from "../../../api/approvalsApi";
import useAuth from "../../../hooks/useAuth";
import MachineControlCard from "../MachineControlCard";
import ManufacturingWorkflowHub from "../ManufacturingWorkflowHub";
import DashboardCheckIn from "../DashboardCheckIn";
import useManufacturingRefresh from "../../../hooks/useManufacturingRefresh";
import { isAdmin, isOperator, userCanAccessApprovalQueue } from "../../../config/permissions";
import { CardShell, KpiIconWell, StatusBadge, TrendBadge, getKpiAccent } from "./ReferenceParts";

/** Masters → Products visual tokens (only reference for this dashboard). */
const YELLOW = "var(--color-cta)";

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  boxShadow: "var(--shadow-card-hover)",
  fontSize: 12,
  color: "var(--color-text)",
  backgroundColor: "var(--color-surface)",
};

const EMPTY_ERP_DASHBOARD = {
  dashboard_profile: "admin",
  visible_sections: [
    "kpi",
    "quick_actions",
    "todays_summary",
    "orders_overview",
    "inventory",
    "alerts",
    "production_overview",
    "shop_floor",
    "production_pipeline",
    "top_machines",
    "recent_work_orders",
  ],
  kpi_cards: [
    { id: "total-orders", title: "Total Orders", value: "0", change: "0%", trend: "up", icon: "shoppingCart" },
    { id: "today-production", title: "Today's Production", value: "0", change: "0%", trend: "up", icon: "factory" },
    { id: "machines-running", title: "Machines Running", value: "0/0", change: "0%", trend: "up", icon: "wrench" },
    { id: "pending-orders", title: "Pending Orders", value: "0", change: "0", trend: "up", icon: "clock" },
    { id: "pending-approvals", title: "Pending Approvals", value: "0", change: "0 new", trend: "up", icon: "alertTriangle" },
  ],
  production_overview: [],
  orders_overview: { pending: 0, in_progress: 0, completed: 0, total: 0 },
  inventory: { total_items: 0, low_stock: 0, out_of_stock: 0, valuation: 0 },
  recent_work_orders: [],
  shop_floor: [],
  alerts: [],
};

const DEFAULT_ERP_DASHBOARD = {
  dashboard_profile: "admin",
  visible_sections: [
    "kpi",
    "quick_actions",
    "todays_summary",
    "orders_overview",
    "inventory",
    "alerts",
    "production_overview",
    "shop_floor",
    "production_pipeline",
    "top_machines",
    "recent_work_orders",
  ],
  kpi_cards: [
    { id: "total-orders", title: "Total Orders", value: "24", change: "+12%", trend: "up", icon: "shoppingCart" },
    { id: "today-production", title: "Today's Production", value: "1,450", change: "+8%", trend: "up", icon: "factory" },
    { id: "machines-running", title: "Machines Running", value: "8/10", change: "80%", trend: "up", icon: "wrench" },
    { id: "pending-orders", title: "Pending Orders", value: "5", change: "-2", trend: "down", icon: "clock" },
    { id: "pending-approvals", title: "Pending Approvals", value: "3", change: "3 new", trend: "up", icon: "alertTriangle" },
  ],
  production_overview: [
    { name: "Mon", planned: 400, actual: 380 },
    { name: "Tue", planned: 450, actual: 440 },
    { name: "Wed", planned: 500, actual: 490 },
    { name: "Thu", planned: 480, actual: 470 },
    { name: "Fri", planned: 520, actual: 510 },
    { name: "Sat", planned: 300, actual: 320 },
    { name: "Sun", planned: 200, actual: 190 },
  ],
  shop_floor_status: [
    { machine: "CNC-01", status: "Running", operator: "Sateesh", efficiency: "94%" },
    { machine: "CNC-02", status: "Running", operator: "Ramesh", efficiency: "91%" },
    { machine: "PRESS-01", status: "Running", operator: "Kiran", efficiency: "88%" },
    { machine: "LATHE-03", status: "Idle", operator: "Unassigned", efficiency: "0%" },
  ],
  orders_overview: { total: 24, inProgress: 8, completed: 14, onHold: 2, progress: 68 },
  inventory_blocks: [
    { category: "Raw Materials", count: "142 items", status: "Optimal" },
    { category: "Finished Goods", count: "89 items", status: "Good" },
    { category: "Low Stock Alerts", count: "3 items", status: "Warning" },
  ],
  recent_work_orders: [
    { id: 101, wo: "WO-2026-001", product: "Hydraulic Pump Valve", qty: 150, status: "In Progress", due: "2026-09-15" },
    { id: 102, wo: "WO-2026-002", product: "Flange Assembly B-12", qty: 300, status: "Planned", due: "2026-09-18" },
    { id: 103, wo: "WO-2026-003", product: "Precision Gear Set", qty: 80, status: "Completed", due: "2026-09-10" },
  ],
  alerts_feed: [
    { id: "alt-1", message: "Low stock alert: Stainless Steel Rods (Grade 304)", time: "10 mins ago", type: "warning" },
    { id: "alt-2", message: "Preventive maintenance scheduled for CNC-01", time: "1 hour ago", type: "info" },
  ],
  todays_summary: [
    { key: "goodQty", label: "Good Qty Today", value: "1,420 pcs", icon: "checkCircle" },
    { key: "rejectQty", label: "Rejections", value: "30 pcs (2.1%)", icon: "alertTriangle" },
    { key: "manpower", label: "Manpower Present", value: "18 / 20", icon: "users" },
  ],
};

const KPI_TITLE_KEYS = {
  "total-orders": "totalOrders",
  "today-production": "todaysProduction",
  "machines-running": "machinesRunning",
  "pending-orders": "pendingOrders",
  "pending-approvals": "pendingApprovals",
  "good-qty": "goodQtyToday",
  "reject-qty": "rejectQtyToday",
  "inventory-value": "inventoryValue",
  "low-stock": "lowStockItems",
  "raw-materials": "rawMaterials",
  "finished-goods": "finishedGoods",
  warehouses: "warehouses",
  "stock-movements": "stockMovements",
  "total-users": "totalUsers",
  departments: "departments",
  "active-users": "activeUsers",
  "total-employees": "totalEmployees",
  "active-alerts": "activeAlerts",
  "total-sales-orders": "totalSalesOrders",
  "pending-sales-orders": "pendingSalesOrders",
  "todays-sales": "todaysSales",
  "outstanding-receivables": "outstandingReceivables",
  "monthly-revenue": "monthlyRevenue",
  quotations: "quotations",
  "conversion-rate": "conversionRate",
  "overdue-invoices": "overdueInvoices",
  "total-production-orders": "totalProductionOrders",
  "planned-orders": "plannedOrders",
  "in-progress-orders": "inProgressOrders",
  "completed-orders": "completedOrders",
  "delayed-orders": "delayedOrders",
  "production-target": "productionTarget",
  "production-efficiency": "productionEfficiency",
  "machine-utilization": "machineUtilization",
  "total-inventory-items": "totalInventoryItems",
  "out-of-stock": "outOfStockItems",
  "pending-material-issues": "pendingMaterialIssues",
  "pending-goods-receipts": "pendingGoodsReceipts",
  "present-today": "presentToday",
  "absent-today": "absentToday",
  "on-leave": "onLeave",
  "pending-leave-requests": "pendingLeaveRequests",
  "new-employees": "newEmployees",
  "attendance-rate": "attendanceRate",
  "pending-hr-requests": "pendingHrRequests",
  "total-receivables": "totalReceivables",
  "total-payables": "totalPayables",
  "todays-revenue": "todaysRevenue",
  "pending-invoices": "pendingInvoices",
  "overdue-payments": "overduePayments",
  expenses: "expenses",
  "gst-payable": "gstPayable",
  "cash-bank-balance": "cashBankBalance",
  "revenue-cost-snapshot": "revenueCostSnapshot",
  "my-work-orders": "myWorkOrders",
  "todays-target": "todaysTarget",
  "completed-today": "completedToday",
  "operator-in-progress": "inProgressOrders",
  "pending-tasks": "pendingTasksKpi",
  "assigned-machine": "assignedMachine",
  "machine-status": "machineStatus",
  "material-availability": "materialAvailability",
  "quality-checks-pending": "qualityChecksPending",
};


const TREND_LABEL_KEYS = {
  "vs last 7 days": "vsLast7Days",
  "vs yesterday": "vsYesterday",
  "vs total machines": "vsTotalMachines",
  "units on hand": "unitsOnHand",
  "active locations": "activeLocations",
  "GRNs today": "grnsToday",
  "awaiting action": "awaitingAction",
  "registered users": "registeredUsers",
  "active departments": "activeDepartments",
  "production orders": "productionOrders",
  "open work orders": "openWorkOrders",
  "net margin this month": "netMarginThisMonth",
  "no data this month": "noDataThisMonth",
};

const SHOP_FLOOR_KEYS = {
  Running: "running",
  Idle: "idle",
  Setup: "setup",
  Maintenance: "maintenance",
  Breakdown: "breakdown",
};

const INVENTORY_KEYS = ["rawMaterials", "wipItems", "finishedGoods", "lowStockItems"];
const WAREHOUSE_KEYS = ["mainStore", "productionStore", "fgStore", "others"];
const SUMMARY_KEYS = ["manPower", "workingHours", "powerConsumption", "productionEfficiency", "targetAchievement"];

const EMPTY_ORDERS = { total: 0, inProgress: 0, completed: 0, onHold: 0, progress: 0 };
const PERIOD_KEYS = { Daily: "daily", Weekly: "weekly", Monthly: "monthly", Yearly: "yearly" };

const summaryIcons = { users: Users, clock: Clock, zap: Zap, gauge: Gauge, target: Target, boxes: Boxes, cart: ShoppingCart, alert: AlertTriangle, package: Package };
const alertIcons = { alert: AlertTriangle, wrench: Wrench, box: Package, check: CheckCircle2, cart: ShoppingCart };
const blockIcons = { boxes: Boxes, cog: Wrench, package: Package, alert: AlertTriangle };

function sectionVisible(sections, key) {
  if (!Array.isArray(sections) || sections.length === 0) return true;
  return sections.includes(key);
}

function formatInr(n) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `₹${v.toLocaleString()}`;
  }
}

function DashboardSkeleton() {
  return (
    <div className="min-h-full bg-[var(--color-bg)]" aria-busy="true" aria-label="Loading dashboard">
      <div className="ui-page mx-auto max-w-[var(--page-max)] ui-stack">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <SkeletonChart />
          </div>
          <div className="xl:col-span-3">
            <SkeletonChart />
          </div>
          <div className="xl:col-span-4">
            <SkeletonChart />
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_CARD_LINKS = {
  "total-users": "/admin/users",
  departments: "/masters/departments",
  "active-users": "/admin/users",
  "total-employees": "/masters/departments",
  "pending-approvals": "/admin/approvals",
  "total-orders": "/production/planning",
  "today-production": "/production/planning?preset=today",
  "pending-orders": "/production/work-orders?view=pending",
  "revenue-cost-snapshot": "/accounts/profit-loss",
  "machines-running": "/production/machines",
  "good-qty": "/production/reports",
  "reject-qty": "/production/reports",
  "inventory-value": "/inventory",
  "low-stock": "/alerts/low-stock",
  "raw-materials": "/inventory/raw-materials",
  "finished-goods": "/inventory/finished-goods",
  warehouses: "/inventory/warehouses",
  "stock-movements": "/inventory/stock-ledger",
  "total-sales-orders": "/sales/orders",
  "pending-sales-orders": "/sales/orders",
  "todays-sales": "/sales/orders",
  "outstanding-receivables": "/finance/accounts-receivable",
  "monthly-revenue": "/sales/invoices",
  quotations: "/sales/quotations",
  "conversion-rate": "/sales/quotations",
  "overdue-invoices": "/sales/invoices",
  "total-production-orders": "/production/planning",
  "planned-orders": "/production/planning",
  "in-progress-orders": "/production/work-orders",
  "completed-orders": "/production/work-orders",
  "delayed-orders": "/production/work-orders",
  "production-target": "/production/planning",
  "production-efficiency": "/production/reports",
  "machine-utilization": "/production/machines",
  "total-inventory-items": "/inventory",
  "out-of-stock": "/inventory",
  "pending-material-issues": "/procurement/material-requests",
  "pending-goods-receipts": "/procurement/goods-receipt",
  "present-today": "/masters/departments",
  "absent-today": "/masters/departments",
  "on-leave": "/masters/departments",
  "pending-leave-requests": "/masters/departments",
  "new-employees": "/masters/departments",
  "attendance-rate": "/masters/departments",
  "pending-hr-requests": "/masters/departments",
  "total-receivables": "/finance/accounts-receivable",
  "total-payables": "/finance/accounts-payable",
  "todays-revenue": "/sales/invoices",
  "pending-invoices": "/sales/invoices",
  "overdue-payments": "/finance/accounts-payable",
  expenses: "/accounts/expenses",
  "gst-payable": "/accounts/tax-reports",
  "cash-bank-balance": "/accounts/ledger",
  "my-work-orders": "/production/work-orders",
  "todays-target": "/production/planning",
  "completed-today": "/production/work-orders",
  "operator-in-progress": "/production/work-orders",
  "pending-tasks": "/production/tasks",
  "assigned-machine": "/production/machines",
  "machine-status": "/production/machines",
  "material-availability": "/inventory",
  "quality-checks-pending": "/quality",
};

function KpiStrip({ cards = [] }) {
  const { t } = useTranslation();
  if (!cards.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#e4e4ea] bg-white px-6 py-10 text-center text-[13px] text-[#8a8a96] shadow-sm">
        {t("common.noData", "No data available.")}
      </div>
    );
  }
  const stripModifier =
    cards.length === 6 || cards.length % 6 === 0
      ? "ui-kpi-strip--6"
      : cards.length === 5 || cards.length % 5 === 0
        ? "ui-kpi-strip--5"
        : "";
  return (
    <div className={`ui-kpi-strip ${stripModifier}`.trim()}>
      {cards.map((card) => {
        const titleKey = KPI_TITLE_KEYS[card.id];
        const trendKey = TREND_LABEL_KEYS[card.trendLabel];
        const accent = getKpiAccent(card.id);
        const isMachines = card.id === "machines-running" || card.id === "machine-utilization";
        const trendIsPct = String(card.trend ?? "").includes("%");
        const trendLabel = isMachines
          ? t("refDashboard.utilization", "utilization")
          : trendKey
            ? t(`refDashboard.${trendKey}`)
            : card.trendLabel;
        const cardTitle = titleKey ? t(`refDashboard.${titleKey}`) : card.title;
        const targetLink = card.link || DEFAULT_CARD_LINKS[card.id];
        const cardSurfaceCls = `group relative flex h-full w-full min-h-[var(--kpi-dashboard-min-height)] flex-col overflow-hidden rounded-xl p-3.5 shadow-sm transition-colors duration-200 ${accent.cardBg} ${accent.hoverBorder}`;
        const linkCardCls = `${cardSurfaceCls} cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]`;
        const staticCardCls = cardSurfaceCls;
        const cls = targetLink ? linkCardCls : staticCardCls;
        const inner = (
          <>
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <KpiIconWell id={card.id} />
              {targetLink ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]" />
              ) : null}
            </div>
            <p className="line-clamp-2 text-[11px] font-medium leading-snug text-[var(--color-text-muted)]">{cardTitle}</p>
            <p className={`ui-kpi__value mt-1 leading-none tracking-tight ${String(card.value).includes(" / ") ? "text-lg" : "text-[1.5rem]"}`}>
              {card.value}
              {card.unit ? <span className="ml-1 text-sm font-semibold text-[var(--color-text-secondary)]">{card.unit}</span> : null}
              {card.suffix ? <span className="ml-1 text-base font-semibold text-[var(--color-text-muted)]">{card.suffix}</span> : null}
            </p>
            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
              <TrendBadge
                up={card.trendUp}
                value={card.trend}
                label={trendLabel}
                mode={isMachines ? "utilization" : trendIsPct ? "change" : "info"}
              />
            </div>
          </>
        );
        return targetLink ? (
          <Link
            key={card.id}
            to={targetLink}
            className={cls}
            aria-label={t("refDashboard.openKpiDetails", "View {{title}} details", { title: cardTitle })}
          >
            {inner}
          </Link>
        ) : (
          <div key={card.id} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function PendingTasks({ overview, inventoryBlocks = [], alerts = [], profile }) {
  const { t } = useTranslation();
  const lowStock = inventoryBlocks.find((b) => b.key === "low_stock")?.count ?? 0;
  const tasks = [];

  if (profile === "store") {
    if (overview?.total) {
      tasks.push({
        id: "dispatch",
        label: overview?.labels?.total || t("refDashboard.pendingDispatch", "Pending Dispatch"),
        value: overview.total,
        to: "/sales/dispatch",
        tone: "amber",
      });
    }
    if (overview?.inProgress) {
      tasks.push({
        id: "grn-qc",
        label: overview?.labels?.inProgress || t("refDashboard.pendingGrnQc", "Pending GRN QC"),
        value: overview.inProgress,
        to: "/procurement/goods-receipt",
        tone: "sky",
      });
    }
    if (lowStock) {
      tasks.push({
        id: "low-stock",
        label: t("refDashboard.lowStockItems"),
        value: lowStock,
        to: "/alerts/low-stock",
        tone: "rose",
      });
    }
  } else {
    if (overview?.inProgress) {
      tasks.push({
        id: "in-progress",
        label: t("refDashboard.inProgress"),
        value: overview.inProgress,
        to: "/production/work-orders",
        tone: "sky",
      });
    }
    if (overview?.onHold) {
      tasks.push({
        id: "on-hold",
        label: t("refDashboard.onHold"),
        value: overview.onHold,
        to: "/production/work-orders",
        tone: "rose",
      });
    }
    if (lowStock) {
      tasks.push({
        id: "low-stock",
        label: t("refDashboard.lowStockItems"),
        value: lowStock,
        to: "/alerts/low-stock",
        tone: "amber",
      });
    }
  }

  if (alerts.length) {
    tasks.push({
      id: "alerts",
      label: t("refDashboard.openAlerts", "Open Alerts"),
      value: alerts.length,
      to: "/alerts",
      tone: "violet",
    });
  }

  const toneClass = {
    sky: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
    amber: "bg-[#fff6e5] text-[#b45309]",
    rose: "bg-[#fde8e8] text-[#ef4444]",
    violet: "bg-[#f3eefc] text-[#6d28d9]",
  };

  return (
    <CardShell
      title={t("refDashboard.pendingTasks", "Pending Tasks")}
      subtitle={t("refDashboard.pendingTasksHint", "Items that need attention today")}
      action={
        <ListTodo className="h-4 w-4 text-[#9a9aa5]" aria-hidden />
      }
    >
      {!tasks.length ? (
        <p className="py-6 text-center text-[13px] text-[#8a8a96]">{t("refDashboard.allCaughtUp", "You're all caught up.")}</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                to={task.to}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#ececf0] bg-[#fafafa] px-3 py-2.5 transition hover:bg-[#f3f3f6] dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-750"
              >
                <span className="text-[13px] font-medium text-[#1a1a1f] dark:text-white">{task.label}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${toneClass[task.tone]}`}>
                  {Number(task.value).toLocaleString()}
                  <ArrowRight className="h-3 w-3 opacity-70" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function FinancialSnapshot({ inventoryBlocks = [] }) {
  const { t } = useTranslation();
  const raw = inventoryBlocks.find((b) => b.key === "raw");
  const fg = inventoryBlocks.find((b) => b.key === "fg");
  const low = inventoryBlocks.find((b) => b.key === "low_stock");
  const totalValue = (Number(raw?.value) || 0) + (Number(fg?.value) || 0);

  const rows = [
    { label: t("refDashboard.totalInventoryValue", "Total Inventory Value"), value: formatInr(totalValue), icon: IndianRupee },
    { label: t("refDashboard.rawMaterials"), value: formatInr(raw?.value), icon: Boxes },
    { label: t("refDashboard.finishedGoods"), value: formatInr(fg?.value), icon: Package },
    { label: t("refDashboard.lowStockItems"), value: String(low?.count ?? 0), icon: AlertTriangle },
  ];

  return (
    <CardShell
      title={t("refDashboard.financialSnapshot", "Financial Snapshot")}
      subtitle={t("refDashboard.financialSnapshotHint", "Inventory valuation from live stock")}
      action={
        <Link to="/analytics/finance" className="text-[12px] font-semibold text-[var(--color-primary)] hover:underline">
          {t("common.viewAll")}
        </Link>
      }
    >
      <ul className="space-y-2.5">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.label} className="flex items-center justify-between gap-3 rounded-lg bg-[#f3f3f6] px-3 py-2.5 dark:bg-slate-800">
              <span className="flex items-center gap-2 text-[13px] text-[#4a4a55] dark:text-slate-300">
                <Icon className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
                {row.label}
              </span>
              <span className="text-[13px] font-bold tabular-nums text-[#1a1a1f] dark:text-white">{row.value}</span>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

function ProductionOverview({ chartSets }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState("Daily");
  const chartData = chartSets?.[period] ?? [];
  const hasChartData = chartData.length > 0;
  return (
    <CardShell
      title={t("refDashboard.productionOverview")}
      className="h-full"
      action={
        <div className="flex rounded-lg border border-[#e8e8ee] bg-[#f3f3f6] p-0.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-800" role="tablist" aria-label={t("refDashboard.productionOverview")}>
          {Object.entries(PERIOD_KEYS).map(([label, key]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={period === label}
              onClick={() => setPeriod(label)}
              className={`rounded-md px-2.5 py-1 transition-colors ${period === label ? "bg-white text-[#1a1a1f] shadow-sm dark:bg-slate-700 dark:text-white" : "text-[#6b6b76] dark:text-slate-400"}`}
            >
              {t(`refDashboard.${key}`)}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-[260px] w-full">
        {hasChartData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} key={period}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececf0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b6b76" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b6b76" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8, color: "#4a4a55" }} />
              <Line type="monotone" dataKey="planned" name={t("refDashboard.plannedQty")} stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--color-primary)" }} />
              <Line type="monotone" dataKey="actual" name={t("refDashboard.actualQty")} stroke="#15803d" strokeWidth={2.5} dot={{ r: 3, fill: "#15803d" }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message={t("common.noData", "No data available.")} />
        )}
      </div>
    </CardShell>
  );
}

function ShopFloorStatus({ statusData = [] }) {
  const { t } = useTranslation();
  const total = statusData.reduce((s, d) => s + d.value, 0);
  if (!statusData.length) {
    return (
      <CardShell title={t("refDashboard.shopFloorStatus")} className="h-full">
        <EmptyChart message={t("common.noData", "No data available.")} className="min-h-[180px]" />
      </CardShell>
    );
  }
  return (
    <CardShell title={t("refDashboard.shopFloorStatus")} className="h-full">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-[160px] w-[160px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="value" cx="50%" cy="50%" innerRadius={48} outerRadius={68} paddingAngle={2}>
                {statusData.map((e) => (
                  <Cell key={e.name} fill={e.color} stroke="none" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-medium text-[#8a8a96] dark:text-slate-400">{t("refDashboard.totalMachines")}</span>
            <span className="text-2xl font-bold text-[#1a1a1f] dark:text-white">{total}</span>
          </div>
        </div>
        <ul className="w-full space-y-2 text-sm">
          {statusData.map((item) => {
            const key = SHOP_FLOOR_KEYS[item.name];
            return (
              <li key={item.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[#4a4a55] dark:text-slate-300">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{key ? t(`refDashboard.${key}`) : item.name}</span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-[#1a1a1f] dark:text-white">{item.value}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </CardShell>
  );
}

function TopMachines({ machines = [] }) {
  const { t } = useTranslation();
  if (!machines.length) {
    return (
      <CardShell title={t("refDashboard.topMachines")} className="h-full">
        <p className="py-8 text-center text-sm text-[#8a8a96] dark:text-slate-400">{t("common.noData", "No data available.")}</p>
      </CardShell>
    );
  }
  return (
    <CardShell title={t("refDashboard.topMachines")} className="h-full">
      <ul className="space-y-3">
        {machines.map((m) => (
          <li key={m.id} className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[10px] font-bold text-[var(--color-primary)]">
              {String(m.id).split("-")[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-semibold text-[#1a1a1f] dark:text-white">{m.id}</span>
                <span className="font-bold tabular-nums text-[var(--color-primary)]">{m.utilization}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f3f3f6] dark:bg-slate-800">
                <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${m.utilization}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function OrdersOverview({ overview = EMPTY_ORDERS }) {
  const { t } = useTranslation();
  const labels = overview.labels || {};
  const stats = [
    { label: labels.total || t("refDashboard.totalOrders"), value: overview.total, color: "text-[var(--color-primary)]" },
    { label: labels.inProgress || t("refDashboard.inProgress"), value: overview.inProgress, color: "text-[#b45309] dark:text-amber-400" },
    { label: labels.completed || t("refDashboard.completed"), value: overview.completed, color: "text-[#15803d] dark:text-emerald-400" },
    { label: labels.onHold || t("refDashboard.onHold"), value: overview.onHold, color: "text-[#ef4444] dark:text-rose-400" },
  ];
  return (
    <CardShell title={t("refDashboard.ordersOverview")}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-[#f3f3f6] px-3 py-2.5 text-center dark:bg-slate-800">
            <p className="text-[10px] font-medium text-[#8a8a96] dark:text-slate-400">{s.label}</p>
            <p className={`text-xl font-bold tabular-nums ${s.color}`}>{Number(s.value ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-medium text-[#4a4a55] dark:text-slate-300">{t("refDashboard.overallProgress")}</span>
          <span className="font-bold tabular-nums text-[var(--color-primary)]">{overview.progress}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[#f3f3f6] dark:bg-slate-800">
          <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${overview.progress}%` }} />
        </div>
      </div>
    </CardShell>
  );
}

function InventorySummary({ blocks = [], warehouses = [] }) {
  const { t } = useTranslation();
  if (!blocks.length) {
    return (
      <CardShell title={t("refDashboard.inventorySummary")}>
        <p className="py-8 text-center text-sm text-[#8a8a96] dark:text-slate-400">{t("common.noData", "No data available.")}</p>
      </CardShell>
    );
  }
  return (
    <CardShell title={t("refDashboard.inventorySummary")}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        {blocks.map((b, i) => {
          const Icon = blockIcons[b.icon] || Boxes;
          const labelKey = INVENTORY_KEYS[i];
          return (
            <div key={b.label} className="flex items-center gap-3 rounded-lg border border-[#ececf0] px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${b.color || "var(--color-primary)"}18`, color: b.color || "var(--color-primary)" }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums text-[#1a1a1f] dark:text-white">{Number(b.count ?? 0).toLocaleString()}</p>
                <p className="text-[10px] leading-tight text-[#8a8a96] dark:text-slate-400">
                  {labelKey ? t(`refDashboard.${labelKey}`) : b.label}
                </p>
                {b.quantity !== undefined && b.quantity !== b.count && b.quantity > 0 ? (
                  <p className="text-[9px] font-medium text-[#9a9aa5] dark:text-slate-400">{Number(b.quantity).toLocaleString()} units</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mb-2 text-xs font-semibold text-[#4a4a55] dark:text-slate-300">{t("refDashboard.warehouseLocation")}</p>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {warehouses.map((w, i) => (
          <div
            key={w.name}
            style={{ width: `${w.pct || 0}%`, backgroundColor: w.color || "#9a9aa5" }}
            title={WAREHOUSE_KEYS[i] ? t(`refDashboard.${WAREHOUSE_KEYS[i]}`) : w.name}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#8a8a96] dark:text-slate-400">
        {warehouses.map((w, i) => (
          <span key={w.name} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: w.color || "#9a9aa5" }} />
            {WAREHOUSE_KEYS[i] ? t(`refDashboard.${WAREHOUSE_KEYS[i]}`) : w.name}
          </span>
        ))}
      </div>
    </CardShell>
  );
}

function AlertsNotifications({ alerts = [] }) {
  const { t } = useTranslation();
  return (
    <CardShell
      title={t("refDashboard.alertsNotifications")}
      action={
        <Link to="/alerts" className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
          {t("common.viewAll")}
        </Link>
      }
    >
      {!alerts.length ? (
        <p className="py-6 text-center text-sm text-[#8a8a96] dark:text-slate-400">{t("common.noData", "No data available.")}</p>
      ) : (
        <ul className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
          {alerts.map((a, i) => {
            const Icon = alertIcons[a.icon] || AlertTriangle;
            const inner = (
              <>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${a.color || "var(--color-primary)"}18`, color: a.color || "var(--color-primary)" }}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-[#1a1a1f] dark:text-white">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-[#9a9aa5] dark:text-slate-400">{a.time || "—"}</p>
                </div>
              </>
            );
            return (
              <li key={a.id || i}>
                {a.link ? (
                  <Link to={a.link} className="-m-1 flex gap-3 rounded-lg p-1 hover:bg-[#f3f3f6] dark:hover:bg-slate-800">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex gap-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

function RecentWorkOrders({ workOrders = [] }) {
  const { t } = useTranslation();
  return (
    <CardShell
      title={t("refDashboard.recentWorkOrders")}
      action={
        <Link to="/production/work-orders" className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
          {t("common.viewAll")}
        </Link>
      }
    >
      {!workOrders.length ? (
        <p className="py-6 text-center text-sm text-[#8a8a96] dark:text-slate-400">{t("common.noRecords", "No records found.")}</p>
      ) : (
        <div className="ui-table-wrap ui-table-wrap--scroll">
          <table className="ui-table w-full min-w-[420px] text-left text-sm">
            <thead className="ui-table-head">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t("refDashboard.woNo")}</th>
                <th className="px-3 py-2.5 font-medium">{t("refDashboard.product")}</th>
                <th className="px-3 py-2.5 font-medium">{t("refDashboard.qty")}</th>
                <th className="px-3 py-2.5 font-medium">{t("refDashboard.status")}</th>
                <th className="px-3 py-2.5 font-medium">{t("refDashboard.dueDate")}</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo._rowKey ?? wo.id ?? wo.wo}>
                  <td className="px-3 py-2.5 font-semibold text-[var(--color-primary)]">{wo.wo}</td>
                  <td className="px-3 py-2.5 text-[#1a1a1f] dark:text-white">{wo.product}</td>
                  <td className="px-3 py-2.5 tabular-nums text-[#4a4a55] dark:text-slate-300">{wo.qty}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={wo.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#8a8a96] dark:text-slate-400">{wo.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

function isProductionManagerUser(user) {
  if (!user) return false;
  const roles = Array.isArray(user.roles)
    ? user.roles.map((r) => (typeof r === "object" ? r.name : String(r)))
    : [];
  const roleStr = String(user.role || user.role_name || (typeof user.roles === "string" ? user.roles : "")).toLowerCase();
  const allRoles = [...roles.map((r) => String(r).toLowerCase()), roleStr];
  if (allRoles.some((r) => r.includes("admin"))) return false;
  return allRoles.some((r) => r.includes("production manager") || r.includes("production_manager"));
}

function TodaysSummary({ items = [] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isPM = isProductionManagerUser(user);
  const isOp = isOperator(user);
  const filteredItems = useMemo(() => {
    if (isOp) {
      return items.filter(
        (item) =>
          item.key !== "manPower" &&
          item.key !== "manpower" &&
          item.key !== "powerConsumption" &&
          item.key !== "stockMovements" &&
          item.label !== "Man Power" &&
          item.label !== "Manpower" &&
          item.label !== "Power Consumption" &&
          item.label !== "Stock Movements"
      );
    }
    if (isPM) {
      return items.filter(
        (item) =>
          item.key !== "powerConsumption" &&
          item.key !== "stockMovements" &&
          item.label !== "Power Consumption" &&
          item.label !== "Stock Movements"
      );
    }
    return items;
  }, [items, isPM, isOp]);

  if (!filteredItems.length) {
    return (
      <CardShell title={t("refDashboard.todaysSummary")}>
        <p className="py-8 text-center text-sm text-[#8a8a96] dark:text-slate-400">{t("common.noData", "No data available.")}</p>
      </CardShell>
    );
  }
  return (
    <CardShell title={t("refDashboard.todaysSummary")}>
      <ul className="space-y-2.5">
        {filteredItems.map((item, i) => {
          const Icon = summaryIcons[item.icon] || BarChart3;
          const label = item.key
            ? t(`refDashboard.${item.key}`, item.label)
            : SUMMARY_KEYS[i]
              ? t(`refDashboard.${SUMMARY_KEYS[i]}`)
              : item.label;
          return (
            <li key={item.key || item.label || i} className="flex items-center justify-between gap-3 rounded-lg bg-[#f3f3f6] px-3 py-2.5 dark:bg-slate-800">
              <span className="flex items-center gap-2.5 text-sm text-[#4a4a55] dark:text-slate-300">
                <Icon className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
                {label}
              </span>
              <span className="text-sm font-bold tabular-nums text-[#1a1a1f] dark:text-white">{item.value}</span>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

export default function ReferenceDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOp = isOperator(user);
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [liveCounts, setLiveCounts] = useState({
    ordersCount: null,
    pendingOrdersCount: null,
    pendingApprovalsCount: null,
    todayProdCount: null,
  });
  const [quickActionsRefreshKey, setQuickActionsRefreshKey] = useState(0);

  const load = useCallback((isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    const approvalsFetch = userCanAccessApprovalQueue(user)
      ? getMyApprovalCounts()
      : Promise.resolve({ data: null });

    getErpDashboard({ includeManufacturingWorkflow: false })
      .then((dashRes) => {
        if (dashRes?.data) {
          setApiData(dashRes.data);
          setError(null);
        } else {
          setApiData(EMPTY_ERP_DASHBOARD);
          setError(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        setApiData(EMPTY_ERP_DASHBOARD);
        setError(err?.message || "Unable to load dashboard.");
        setLoading(false);
      });

    Promise.allSettled([getProductionOrders(), getWorkOrders(), approvalsFetch]).then(
      ([prodRes, woRes, approvalsRes]) => {
      let customOrders = [];
      try {
        customOrders = JSON.parse(localStorage.getItem("gns_custom_production_orders") || "[]");
      } catch {
        customOrders = [];
      }

      let prodList = [];
      if (prodRes.status === "fulfilled" && Array.isArray(prodRes.value?.data)) {
        prodList = prodRes.value.data;
      }

      let woList = [];
      if (woRes.status === "fulfilled" && Array.isArray(woRes.value?.data)) {
        woList = woRes.value.data;
      }

      let realPendingApprovalsCount = null;
      if (approvalsRes.status === "fulfilled" && approvalsRes.value?.data != null) {
        const n = Number(approvalsRes.value.data.total);
        realPendingApprovalsCount = Number.isFinite(n) ? n : 0;
      }

      const allOrdersMap = new Map();
      prodList.forEach((o) => allOrdersMap.set(String(o.id), o));
      customOrders.forEach((o) => allOrdersMap.set(String(o.id), o));
      const allOrders = Array.from(allOrdersMap.values());

      const totOrders = allOrders.length;

      const pendOrdersCount = woList.length > 0
        ? woList.filter((w) => {
            const st = (w.status || "").toLowerCase();
            return st !== "completed" && st !== "closed" && st !== "cancelled" && st !== "done";
          }).length
        : allOrders.filter((o) => {
            const st = (o.status || "").toLowerCase();
            return st === "planned" || st === "pending" || st === "in_progress" || st === "draft";
          }).length;

      const todayIso = new Date().toISOString().slice(0, 10);
      const todayProdCount = allOrders.filter((o) => {
        const sDate = o.start_date ? String(o.start_date).slice(0, 10) : "";
        const cDate = o.created_at ? String(o.created_at).slice(0, 10) : "";
        const st = (o.status || "").toLowerCase();
        return (sDate === todayIso || (!sDate && cDate === todayIso)) && st !== "cancelled";
      }).length;

      setLiveCounts({
        ordersCount: totOrders,
        pendingOrdersCount: pendOrdersCount,
        pendingApprovalsCount: realPendingApprovalsCount,
        todayProdCount: todayProdCount > 0 ? todayProdCount : null,
      });
      setQuickActionsRefreshKey((k) => k + 1);
    });
  }, [user]);

  useEffect(() => {
    load(false);
  }, [load]);
  useManufacturingRefresh(() => load(true));

  const profile = apiData?.dashboard_profile || "admin";
  const sections = apiData?.visible_sections || [];
  const isStoreProfile = profile === "store";
  // Prefer backend profile so Operator KPIs/sections stay server-enforced.
  const isOpProfile = profile === "operator" || isOp;

  const kpiCardsLive = useMemo(() => {
    if (!apiData?.kpi_cards?.length) return [];

    return apiData.kpi_cards.map((k) => {
      const isFormattedValue =
        typeof k.value === "string" &&
        (k.value.includes("/") || k.value.includes("₹") || k.value.includes("%") || k.value === "—");
      let value = k.value;
      if (!isFormattedValue) {
        let rawVal = Number(k.value) || 0;
        if (k.id === "pending-approvals") {
          if (liveCounts.pendingApprovalsCount !== null) rawVal = liveCounts.pendingApprovalsCount;
        } else if (k.id === "total-orders" || k.id === "total-production-orders") {
          if (liveCounts.ordersCount !== null) rawVal = liveCounts.ordersCount;
        } else if (k.id === "pending-orders") {
          if (liveCounts.pendingOrdersCount !== null) rawVal = liveCounts.pendingOrdersCount;
        } else if (k.id === "today-production") {
          if (liveCounts.todayProdCount !== null) rawVal = liveCounts.todayProdCount;
        }
        value = rawVal;
      }

      return { ...k, value };
    });
  }, [apiData, liveCounts]);

  const chartSets = useMemo(() => {
    if (!apiData) return null;
    return {
      Daily: apiData.production_overview || [],
      Weekly: apiData.production_overview_weekly || [],
      Monthly: apiData.production_overview_monthly || [],
      Yearly: apiData.production_overview_yearly || [],
    };
  }, [apiData]);

  const alertsLive = useMemo(() => apiData?.alerts_feed || [], [apiData]);
  const ordersOverview = useMemo(
    () => ({ ...EMPTY_ORDERS, ...(apiData?.orders_overview || {}) }),
    [apiData]
  );

  const workOrdersLive = useMemo(() => {
    if (!apiData?.recent_work_orders?.length) return [];
    return apiData.recent_work_orders.map((w, index) => ({
      id: w.id,
      wo: w.wo,
      product: w.product,
      qty: w.qty,
      status: w.status,
      due: w.due ? String(w.due).slice(0, 10) : "—",
      _rowKey: w.id != null ? `wo-${w.id}` : `${w.wo}-${index}`,
    }));
  }, [apiData]);

  const showProduction = !isOpProfile && !isStoreProfile && sectionVisible(sections, "production_overview");
  const showShopFloor = !isOpProfile && !isStoreProfile && sectionVisible(sections, "shop_floor");
  const showTopMachines = !isOpProfile && !isStoreProfile && sectionVisible(sections, "top_machines");
  const showInventory = !isOpProfile && sectionVisible(sections, "inventory");
  const showQuickActions = !isOpProfile && sectionVisible(sections, "quick_actions");
  const showProductionPipeline =
    !isOpProfile && !isStoreProfile && sectionVisible(sections, "production_pipeline");
  const showAdminProductionWidgets =
    profile === "admin" && sectionVisible(sections, "admin_production_widgets");
  const showRecentWo = !isStoreProfile && sectionVisible(sections, "recent_work_orders");
  const showFinance = !isOpProfile && showInventory && ["admin", "full"].includes(profile);
  const showPendingTasks = !isOpProfile && sectionVisible(sections, "orders_overview");
  const showTodaysSummary = sectionVisible(sections, "todays_summary");
  const topRowVisibleCount = (showPendingTasks ? 1 : 0) + (showFinance ? 1 : 0) + (showTodaysSummary ? 1 : 0);

  const topRowGridCls = isOpProfile
    ? "grid-cols-1"
    : topRowVisibleCount === 1
      ? "grid-cols-1"
      : topRowVisibleCount === 2
        ? "grid-cols-1 md:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  const showOrdersOverview = sectionVisible(sections, "orders_overview");
  const showAlerts = sectionVisible(sections, "alerts");
  const midRowVisibleCount = (showOrdersOverview ? 1 : 0) + (showInventory ? 1 : 0) + (showAlerts ? 1 : 0);

  const midRowGridCls = isOpProfile
    ? "grid-cols-1 md:grid-cols-2"
    : midRowVisibleCount === 1
      ? "grid-cols-1"
      : midRowVisibleCount === 2
        ? "grid-cols-1 md:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  const erpExportRows = useMemo(
    () => metricExportRows(kpiCardsLive.map((card) => ({ label: card.title, value: card.value }))),
    [kpiCardsLive]
  );

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="min-h-full bg-[var(--color-bg)]">
        <div className="ui-page mx-auto max-w-[var(--page-max)]">
          <div
            className="rounded-xl border border-[#fde8e8] bg-white px-6 py-10 text-center text-sm text-[#ef4444] shadow-sm"
            role="alert"
          >
            {error}
            <button
              type="button"
              onClick={() => load(false)}
              className="mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: YELLOW }}
            >
              {t("common.retry", "Retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[var(--color-bg)]">
      <div className="ui-page mx-auto max-w-[var(--page-max)] ui-stack">
        {sectionVisible(sections, "kpi") ? <KpiStrip cards={kpiCardsLive} /> : null}

        {sectionVisible(sections, "kpi") ? (
          <div className="flex justify-end">
            <DashboardReportExport
              title={isOp ? "Operator Dashboard" : "ERP Dashboard"}
              filename="erp-dashboard"
              rows={erpExportRows}
              module="dashboard"
            />
          </div>
        ) : null}

        <DashboardCheckIn />

        {sectionVisible(sections, "manufacturing_workflow") ? <ManufacturingWorkflowHub /> : null}

        {topRowVisibleCount > 0 && (
          <div className={`grid gap-5 ${topRowGridCls}`}>
            {showPendingTasks ? (
              <PendingTasks
                overview={ordersOverview}
                inventoryBlocks={apiData?.inventory_blocks || []}
                alerts={alertsLive}
                profile={profile}
              />
            ) : null}
            {showFinance ? <FinancialSnapshot inventoryBlocks={apiData?.inventory_blocks || []} /> : null}
            {showTodaysSummary ? (
              <TodaysSummary items={apiData?.todays_summary || []} />
            ) : null}
          </div>
        )}

        {showProductionPipeline ? (
          <ProductionPipeline
            data={apiData?.production_pipeline}
            loading={loading}
            error={error}
            onRetry={() => load(true)}
            refreshKey={quickActionsRefreshKey}
          />
        ) : null}

        {showAdminProductionWidgets ? (
          <AdminProductionWidgets data={apiData?.admin_production_widgets} loading={loading} />
        ) : null}

        {(showProduction || showShopFloor || showTopMachines || (isOpProfile && sectionVisible(sections, "production_overview"))) && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {(showProduction || (isOpProfile && sectionVisible(sections, "production_overview"))) && (
              <div
                className={
                  isOpProfile
                    ? "xl:col-span-6"
                    : !showShopFloor && !showTopMachines
                      ? "xl:col-span-12"
                      : !showShopFloor
                        ? "xl:col-span-7"
                        : !showTopMachines
                          ? "xl:col-span-8"
                          : "xl:col-span-5"
                }
              >
                <ProductionOverview chartSets={chartSets} />
              </div>
            )}
            {isOpProfile ? (
              <div className="xl:col-span-6">
                <MachineControlCard initialMachines={apiData?.top_machines || apiData?.machines} onRefreshData={() => load(true)} />
              </div>
            ) : null}
            {showShopFloor ? (
              <div className={!showTopMachines ? "xl:col-span-5" : "xl:col-span-3"}>
                <ShopFloorStatus statusData={apiData?.shop_floor_status || []} />
              </div>
            ) : null}
            {showTopMachines ? (
              <div className={!showShopFloor ? "xl:col-span-7" : "xl:col-span-4"}>
                <TopMachines machines={apiData?.top_machines || []} />
              </div>
            ) : null}
          </div>
        )}

        {midRowVisibleCount > 0 && (
          <div className={`grid gap-5 ${midRowGridCls}`}>
            {showOrdersOverview ? <OrdersOverview overview={ordersOverview} /> : null}
            {showInventory ? (
              <InventorySummary blocks={apiData?.inventory_blocks || []} warehouses={apiData?.warehouse_locations || []} />
            ) : null}
            {showAlerts ? <AlertsNotifications alerts={alertsLive} /> : null}
          </div>
        )}

        {(showQuickActions || showRecentWo) && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {showQuickActions ? (
              <div
                className={
                  showRecentWo
                    ? profile === "admin" || isAdmin(user)
                      ? "xl:col-span-4"
                      : "xl:col-span-3"
                    : "xl:col-span-12"
                }
              >
                <AdminQuickActions
                  summary={apiData?.quick_actions_summary}
                  loading={loading}
                  error={error}
                  onRetry={() => load(true)}
                  refreshKey={quickActionsRefreshKey}
                />
              </div>
            ) : null}
            {showRecentWo ? (
              <div
                className={
                  showQuickActions
                    ? profile === "admin" || isAdmin(user)
                      ? "xl:col-span-8"
                      : "xl:col-span-9"
                    : "xl:col-span-12"
                }
              >
                <RecentWorkOrders workOrders={workOrdersLive} />
              </div>
            ) : null}
          </div>
        )}

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-[#e4e4ea] pt-4 text-center text-[11px] text-[#8a8a96] sm:flex-row sm:text-left">
          <p>{t("refDashboard.copyright")}</p>
          <p>{t("refDashboard.poweredBy")}</p>
        </footer>
      </div>
    </div>
  );
}
