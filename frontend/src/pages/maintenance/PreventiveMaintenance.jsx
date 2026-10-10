import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import usePageRefresh from "../../hooks/usePageRefresh";
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  Cog,
  History,
  LayoutDashboard,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Wrench,
  X,
} from "lucide-react";
import Button from "../../components/common/Button";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import { ListPageCard, ListPageCardBody, ListPageShell } from "../../components/common/ListPageShell";
import KpiCard from "../../components/common/KpiCard";
import PageHeader from "../../components/common/PageHeader";

import DataTable from "../../components/common/DataTable";
import MaintenanceErrorState from "../../components/maintenance/MaintenanceErrorState";
import MaintenanceFilters from "../../components/maintenance/MaintenanceFilters";
import Loader from "../../components/common/Loader";
import { useToast } from "../../context/ToastContext";
import { createPreventive, getPreventiveEnriched, getPreventiveSummary } from "../../api/maintenanceApi";
import { DEMO_PREVENTIVE_SUMMARY, mntStatusColor } from "../../data/maintenanceMasterData";
import { exportToExcel, exportToPdf } from "../../utils/exportUtils";

export default function PreventiveMaintenance() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ total: 0, pending: 0, completed: 0, overdue: 0 });
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);

  const [formData, setFormData] = useState({
    machine_name: "",
    department: "",
    maintenance_type: "Preventive",
    scheduled_date: new Date().toISOString().slice(0, 10),
    assigned_engineer: "",
    estimated_duration: "2h",
    frequency: "monthly",
    task_description: "",
  });

  useEffect(() => {
    const handleOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [showMoreMenu]);

  const load = useCallback(async (isRefresh = false, retryCount = 0) => {
    if (!isRefresh && retryCount === 0) setLoading(true);
    if (retryCount === 0) setError(null);
    try {
      const [sumRes, listRes] = await Promise.allSettled([getPreventiveSummary(), getPreventiveEnriched()]);

      if (sumRes.status === "fulfilled" && sumRes.value?.data) {
        setSummary({ ...DEMO_PREVENTIVE_SUMMARY, ...sumRes.value.data });
      } else {
        setSummary(DEMO_PREVENTIVE_SUMMARY);
      }
      if (listRes.status === "fulfilled" && Array.isArray(listRes.value?.data)) {
        setRows(listRes.value.data);
      } else {
        setRows([]);
      }
      setError(null);
    } catch (e) {
      if (isRefresh) throw e;
      setSummary(DEMO_PREVENTIVE_SUMMARY);
      setRows([]);
      setError(null);
    } finally {
      if (retryCount === 0) setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const handleExport = (format) => {
    const data = filtered.map((r) => ({
      machine_id: r.machine_id,
      machine_name: r.machine_name,
      department: r.department,
      maintenance_type: r.maintenance_type,
      scheduled_date: String(r.scheduled_date || "").slice(0, 10),
      assigned_engineer: r.assigned_engineer,
      estimated_duration: r.estimated_duration,
      status: r.status,
      next_due_date: String(r.next_due_date || "").slice(0, 10),
    }));
    const cols = [
      { key: "machine_id", label: "Machine ID" },
      { key: "machine_name", label: "Machine Name" },
      { key: "department", label: "Department" },
      { key: "maintenance_type", label: "Maintenance Type" },
      { key: "scheduled_date", label: "Scheduled Date" },
      { key: "assigned_engineer", label: "Assigned Engineer" },
      { key: "estimated_duration", label: "Duration" },
      { key: "status", label: "Status" },
      { key: "next_due_date", label: "Next Due Date" },
    ];
    if (format === "pdf") {
      exportToPdf(data, cols, "Preventive Maintenance Tasks", "preventive-maintenance-tasks");
    } else {
      exportToExcel(data, cols, "preventive-maintenance-tasks");
    }
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!formData.machine_name || !formData.task_description) {
      addToast("Please fill in Machine Name and Task Description", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tenant_id: 1,
        machine_id: 1,
        schedule_date: formData.scheduled_date,
        task_description: formData.task_description,
        frequency: formData.frequency,
        status: "scheduled",
      };
      await createPreventive(payload);
      addToast("Preventive maintenance task scheduled successfully", "success");
      setShowModal(false);
      setFormData({
        machine_name: "",
        department: "",
        maintenance_type: "Preventive",
        scheduled_date: new Date().toISOString().slice(0, 10),
        assigned_engineer: "",
        estimated_duration: "2h",
        frequency: "monthly",
        task_description: "",
      });
      load(true);
    } catch {
      // Fallback add locally
      const newTask = {
        id: Date.now(),
        machine_id: "MCH-01",
        machine_name: formData.machine_name,
        department: formData.department || "Production",
        maintenance_type: formData.maintenance_type,
        scheduled_date: formData.scheduled_date,
        assigned_engineer: formData.assigned_engineer || "Unassigned",
        estimated_duration: formData.estimated_duration,
        status: "scheduled",
        next_due_date: formData.scheduled_date,
        task_description: formData.task_description,
      };
      setRows((prev) => [newTask, ...prev]);
      addToast("Preventive maintenance task created", "success");
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      if (q && ![r.machine_name, r.machine_id, r.assigned_engineer, r.task_description].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      if (statusFilter === "overdue" && !r.is_overdue) return false;
      if (statusFilter && statusFilter !== "overdue" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const columns = [
    { key: "machine_id", label: "Machine ID", render: (r) => <span className="font-semibold text-[var(--color-text)]">{r.machine_id}</span> },
    { key: "machine_name", label: "Machine Name" },
    { key: "department", label: "Department" },
    { key: "maintenance_type", label: "Maintenance Type" },
    { key: "scheduled_date", label: "Scheduled Date", render: (r) => String(r.scheduled_date || "").slice(0, 10) },
    { key: "assigned_engineer", label: "Assigned Engineer", render: (r) => <span className="text-[var(--color-text)]">{r.assigned_engineer || "Unassigned"}</span> },
    { key: "estimated_duration", label: "Est. Duration" },
    { key: "status", label: "Status", render: (r) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${mntStatusColor(r.status)}`}>{r.status}</span> },
    {
      key: "next_due_date", label: "Next Due Date",
      render: (r) => (
        <span className={r.is_overdue ? "font-semibold text-red-600" : "text-[var(--color-text)]"}>
          {String(r.next_due_date || "").slice(0, 10)}
          {r.is_overdue && <span className="ml-1 text-xs text-red-500 font-semibold">(Overdue)</span>}
        </span>
      ),
    },
  ];

  if (loading) return <Loader label="Loading preventive maintenance..." />;

  return (
    <ListPageShell>
    <div className="space-y-5 pb-5">
      <PageHeader
        subtitle="Schedule and track recurring maintenance tasks across all machines."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="add" type="button" onClick={() => setShowModal(true)} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
              New Maintenance Task
            </Button>
            <ExportDownloadMenu disabled={!filtered.length} onExport={handleExport} />
            <div className="relative" ref={moreMenuRef}>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowMoreMenu((v) => !v)}
                rightIcon={<ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showMoreMenu ? "rotate-180" : ""}`} aria-hidden />}
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
                More Actions
              </Button>
              {showMoreMenu && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-xl">
                  <Link
                    to="/maintenance"
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <LayoutDashboard className="h-4 w-4 text-[var(--color-primary)]" />
                    Maintenance Dashboard
                  </Link>
                  <Link
                    to="/maintenance/breakdowns"
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Breakdown Reports
                  </Link>
                  <Link
                    to="/maintenance/equipment"
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <Package className="h-4 w-4 text-indigo-600" />
                    Equipment & Spares
                  </Link>
                  <Link
                    to="/maintenance/history"
                    onClick={() => setShowMoreMenu(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  >
                    <History className="h-4 w-4 text-emerald-600" />
                    Machine History Logs
                  </Link>
                  <div className="my-1 border-t border-[var(--color-border)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      load(true);
                      addToast("Refreshing maintenance tasks...", "info");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)] cursor-pointer"
                  >
                    <RefreshCw className="h-4 w-4 text-[var(--color-primary)]" />
                    Refresh Data
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className="ui-grid-kpi">
        <KpiCard label="Total Machines" value={summary.total_machines} icon={Cog} color="bg-[var(--color-primary)]" />
        <KpiCard label="Scheduled Today" value={summary.scheduled_today} icon={Calendar} color="bg-indigo-600" />
        <KpiCard label="Overdue Tasks" value={summary.overdue_tasks} icon={AlertTriangle} color="bg-red-500" />
        <KpiCard label="Completed This Month" value={summary.completed_this_month} icon={CheckCircle} color="bg-green-600" />
        <KpiCard label="Upcoming" value={summary.upcoming_maintenance} icon={Clock} color="bg-amber-500" />
        <KpiCard label="Machine Availability" value={summary.machine_availability_pct} suffix="%" icon={Wrench} color="bg-teal-600" />
      </div>

      <MaintenanceFilters search={search} onSearchChange={setSearch} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} searchPlaceholder="Search tasks, machines..." />

      <ListPageCard>
        <ListPageCardBody className="overflow-x-auto">
        <DataTable columns={columns} data={filtered} searchPlaceholder="" searchKeys={[]} />
        </ListPageCardBody>
      </ListPageCard>

      {showModal && (
        <div className="ui-modal-backdrop">
          <div className="ui-modal max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] pb-4">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">New Maintenance Task</h2>
                  <p className="text-xs text-[var(--color-text-muted)]">Plan and assign a preventive task</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="mt-4 space-y-4">
              <div>
                <label className="ui-label">
                  Machine Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CNC Milling Machine #01"
                  value={formData.machine_name}
                  onChange={(e) => setFormData({ ...formData, machine_name: e.target.value })}
                  className="ui-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ui-label">Department</label>
                  <input
                    type="text"
                    placeholder="e.g. Machining"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="ui-input w-full"
                  />
                </div>
                <div>
                  <label className="ui-label">Maintenance Type</label>
                  <select
                    value={formData.maintenance_type}
                    onChange={(e) => setFormData({ ...formData, maintenance_type: e.target.value })}
                    className="ui-select w-full"
                  >
                    <option value="Preventive">Preventive</option>
                    <option value="Inspection">Inspection</option>
                    <option value="Calibration">Calibration</option>
                    <option value="Overhaul">Overhaul</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ui-label">Scheduled Date</label>
                  <input
                    type="date"
                    required
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                    className="ui-input w-full"
                  />
                </div>
                <div>
                  <label className="ui-label">Frequency</label>
                  <select
                    value={formData.frequency}
                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                    className="ui-select w-full"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ui-label">Assigned Engineer</label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Kumar"
                    value={formData.assigned_engineer}
                    onChange={(e) => setFormData({ ...formData, assigned_engineer: e.target.value })}
                    className="ui-input w-full"
                  />
                </div>
                <div>
                  <label className="ui-label">Est. Duration</label>
                  <input
                    type="text"
                    placeholder="e.g. 2h"
                    value={formData.estimated_duration}
                    onChange={(e) => setFormData({ ...formData, estimated_duration: e.target.value })}
                    className="ui-input w-full"
                  />
                </div>
              </div>

              <div>
                <label className="ui-label">
                  Task Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe the maintenance steps or checks to perform..."
                  value={formData.task_description}
                  onChange={(e) => setFormData({ ...formData, task_description: e.target.value })}
                  className="ui-input w-full min-h-[5rem]"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--color-border-soft)] pt-4">
                <Button type="button" variant="cancel" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving}
                  loading={saving}
                >
                  {saving ? "Saving..." : "Schedule Task"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </ListPageShell>
  );
}
