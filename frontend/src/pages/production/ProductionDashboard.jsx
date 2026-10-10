import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Cpu,
  Factory,
  Package,
  PlayCircle,
  Users,
  AlertTriangle,
} from "lucide-react";
import DashboardReportExport from "../../components/common/DashboardReportExport";
import KpiCard from "../../components/common/KpiCard";
import { metricExportRows } from "../../utils/dashboardExportRows";

import Loader from "../../components/common/Loader";
import { useToast } from "../../context/ToastContext";
import { getProductionHub } from "../../api/productionApi";
import {
  HUB_FLOW,
  HUB_MODULES,
  hubStatusColor,
} from "../../data/productionHubMasterData";
import useManufacturingRefresh from "../../hooks/useManufacturingRefresh";
import MachineControlCard from "../../components/dashboard/MachineControlCard";
import { useCallback, useEffect, useState } from "react";


function StatusPanel({ title, items, icon: Icon, to }) {
  return (
    <section className="ui-card flex flex-col h-full p-4 transition-all hover:shadow-md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
          ) : null}
          {to ? (
            <Link
              to={to}
              className="text-sm sm:text-[15px] font-bold text-[var(--color-text)] hover:text-[var(--color-primary)] truncate transition-colors"
            >
              {title}
            </Link>
          ) : (
            <h3 className="text-sm sm:text-[15px] font-bold text-[var(--color-text)] truncate">{title}</h3>
          )}
        </div>
        {to ? (
          <Link
            to={to}
            className="shrink-0 text-xs font-semibold text-[var(--color-primary)] hover:underline flex items-center gap-0.5"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      <dl className="space-y-2 pt-2.5 border-t border-[var(--color-border-soft)]">
        {items.map(([label, value, status, itemTo]) => {
          const target = itemTo || to;
          const content = (
            <>
              <dt className="text-[13px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors">{label}</dt>
              <dd className={`text-[13px] font-bold tabular-nums ${hubStatusColor(status)}`}>{value ?? 0}</dd>
            </>
          );
          if (target) {
            return (
              <Link
                key={label}
                to={target}
                className="group flex items-center justify-between rounded-md px-2 py-1.5 -mx-2 transition hover:bg-[var(--color-surface-muted)] cursor-pointer"
              >
                {content}
              </Link>
            );
          }
          return (
            <div key={label} className="flex items-center justify-between px-2 py-1.5">
              {content}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function ModuleCard({ label, to }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-[var(--text-sm)] font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary)]"
    >
      {label}
      <ArrowRight className="h-4 w-4 text-[var(--color-text-faint)]" />
    </Link>
  );
}

function formatProducedToday(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n % 1 === 0 ? String(n) : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ProductionDashboard() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hub, setHub] = useState({});

  const summary = hub.production_summary || {};
  const actions = hub.action_required || {};

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const res = await getProductionHub();
      if (res?.data) setHub(res.data);
      else setHub({});
    } catch (err) {
      setHub({});
      const message = err?.response?.data?.message || "Unable to load production dashboard.";
      setError(message);
      if (isRefresh) addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);
  useManufacturingRefresh(() => load(true));

  if (loading && !hub.production_summary) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader label="Loading production dashboard…" />
      </div>
    );
  }

  const productionExportRows = metricExportRows([
    { label: "Job cards pending", value: summary.job_cards_pending ?? 0 },
    { label: "Job cards in progress", value: summary.job_cards_in_progress ?? 0 },
    { label: "Produced today", value: formatProducedToday(summary.produced_today) },
    { label: "Pending QC", value: summary.pending_qc ?? 0 },
    { label: "Material waiting", value: actions.material_waiting ?? 0 },
    { label: "Overdue production", value: actions.overdue_production ?? 0 },
  ]);

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden pb-4">
      <div className="flex justify-end">
        <DashboardReportExport
          title="Production Dashboard"
          filename="production-dashboard"
          rows={productionExportRows}
          disabled={Boolean(error)}
          module="production"
        />
      </div>
      {error ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-4 py-3">
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
          <button type="button" className="ui-btn ui-btn--secondary text-sm" onClick={() => load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="ui-card overflow-hidden p-0">
        <div className="border-b border-[var(--color-border-soft)] px-4 py-3 sm:px-5">
          <h3 className="text-sm font-bold text-[#1e3a5f] sm:text-[15px]">Production Summary</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
          <KpiCard
            label="Job Cards Pending"
            value={summary.job_cards_pending ?? 0}
            icon={ClipboardList}
            tone="warning"
            to="/my-job-cards?status=pending"
          />
          <KpiCard
            label="Job Cards In Progress"
            value={summary.job_cards_in_progress ?? 0}
            icon={PlayCircle}
            tone="info"
            to="/my-job-cards?status=in_progress"
          />
          <KpiCard
            label="Produced Today"
            value={formatProducedToday(summary.produced_today)}
            icon={CheckCircle2}
            tone="success"
            to="/production/reports"
          />
          <KpiCard
            label="Pending QC"
            value={summary.pending_qc ?? 0}
            icon={BadgeCheck}
            tone="violet"
            to="/quality/in-process"
          />
        </div>
      </section>

      <section className="ui-card overflow-hidden p-0">
        <div className="border-b border-[var(--color-border-soft)] px-4 py-3 sm:px-5">
          <h3 className="text-sm font-bold text-[#1e3a5f] sm:text-[15px]">Action Required</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <KpiCard
            label="Material Waiting"
            value={actions.material_waiting ?? 0}
            icon={Package}
            tone="warning"
            to="/inventory/material-requests"
          />
          <KpiCard
            label="Overdue Production"
            value={actions.overdue_production ?? 0}
            icon={Clock}
            tone="danger"
            to="/my-job-cards"
          />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatusPanel
          title="Machine Status"
          icon={Cpu}
          to="/production/machines"
          items={[
            ["Running", hub.machines_running, "running", "/production/machines?status=running"],
            ["Idle", hub.machines_idle, "idle", "/production/machines?status=idle"],
            ["Down / Maintenance", hub.machines_down, "warning", "/maintenance/equipment"],
          ]}
        />
        <StatusPanel
          title="Production Status"
          icon={Factory}
          to="/production/work-orders"
          items={[
            ["Running Jobs", hub.running_jobs, "running", "/production/work-orders?status=in_progress"],
            ["Machines Running", hub.machines_running, "running", "/production/machines"],
            ["Completed Today (WO)", hub.production_completed_today, "ok", "/production/work-orders?status=completed"],
          ]}
        />
        <StatusPanel
          title="Material Status"
          icon={Package}
          to="/inventory"
          items={[
            ["Available", hub.material_available, "ok", "/inventory/raw-materials"],
            ["Shortages", hub.material_shortages, "warning", "/inventory/material-requests"],
            ["Material Waiting", actions.material_waiting ?? 0, "warning", "/inventory/material-requests"],
          ]}
        />
        <StatusPanel
          title="Operator Status"
          icon={Users}
          to="/production/operator-jobs"
          items={[
            ["Present", hub.operators_present, "ok", "/production/operator-jobs"],
            ["Absent", hub.operators_absent, "warning", "/hr/attendance"],
            ["Total Assigned", (hub.operators_present ?? 0) + (hub.operators_absent ?? 0), "running", "/production/operator-jobs"],
          ]}
        />
        <StatusPanel
          title="Quality Status"
          icon={CheckCircle2}
          to="/quality"
          items={[
            ["Passed", hub.quality_passed, "ok", "/quality/inspection"],
            ["Failed", hub.quality_failed, "warning", "/quality/defects"],
            ["Pending Inspection", summary.pending_qc ?? 0, "idle", "/quality/in-process"],
          ]}
        />
        <section className="ui-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Quick Module Access
          </h3>
          <div className="grid gap-2">
            {HUB_MODULES.map((m) => (
              <ModuleCard key={m.to} label={m.label} to={m.to} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="ui-card flex flex-col h-full p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Running Jobs</h3>
            <Link to="/production/work-orders" className="text-xs font-semibold text-[var(--color-success)] hover:underline">
              View all
            </Link>
          </div>
          {(hub.recent_jobs || []).length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-[var(--color-text-muted)]">No running jobs right now.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(hub.recent_jobs || []).map((j) => (
                <div
                  key={j.work_order_number}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border-soft)] px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{j.work_order_number}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {j.product} · {j.machine}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold tabular-nums text-[var(--color-success)]">{j.progress_pct}%</p>
                    <p className="text-[10px] capitalize text-[var(--color-text-muted)]">{j.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <MachineControlCard onRefreshData={() => load(true)} />
      </div>

      <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Module integration flow</p>
        <div className="flex flex-wrap items-center gap-2">
          {HUB_FLOW.map((step, i) => (
            <span key={step} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <span className="rounded-md bg-[var(--color-surface)] px-2 py-1 font-semibold text-[var(--color-success)] ring-1 ring-[var(--color-border)]">{step}</span>
              {i < HUB_FLOW.length - 1 ? <ArrowRight className="h-3 w-3 text-[var(--color-text-faint)]" aria-hidden /> : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
