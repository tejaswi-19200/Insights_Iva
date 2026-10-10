import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  Clock,
  Edit3,
  ExternalLink,
  FileText,
  MapPin,
  Navigation,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

import Button from "../../components/common/Button";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import Loader from "../../components/common/Loader";
import SiteVisitMap from "../../components/hr/SiteVisitMap";
import { ListPageShell } from "../../components/common/ListPageShell";
import { HrPage, HrPageHeader } from "../../components/hr/hrUi";
import usePageRefresh from "../../hooks/usePageRefresh";
import useAuth from "../../hooks/useAuth";
import { useToast } from "../../context/ToastContext";
import {
  createSiteVisit,
  deleteSiteVisit,
  getEmployeesEnriched,
  getSiteVisits,
  updateSiteVisit,
} from "../../api/hrApi";
import {
  DEMO_SITE_VISIT_EMPLOYEES,
  formatMonthPicker,
  formatMonthYear,
  formatSiteVisitDate,
  formatWeekRangeLabel,
  getWeekDays,
  getWeekRange,
  mergeSiteVisitEmployees,
  placesLabel,
  totalVisitsForPeriod,
} from "../../data/siteVisitData";

const MAIN_TABS = [
  { id: "my", label: "My Visits" },
  { id: "employee", label: "Employee Visits" },
];

const PERIOD_TABS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const PURPOSE_OPTIONS = [
  "Site Inspection",
  "Client Meeting",
  "Equipment Installation",
  "Material Delivery",
  "Routine Maintenance",
  "Survey & Audit",
  "Technical Support",
  "Other",
];

const STATUS_CONFIG = {
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
    icon: CheckCircle2,
  },
  in_progress: {
    label: "In Progress",
    className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800",
    icon: Clock,
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
    icon: AlertCircle,
  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.completed;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.className}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {cfg.label}
    </span>
  );
}

function NoDataIllustration({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 grid h-24 w-24 place-items-center rounded-full bg-[var(--color-surface-muted)]">
        <svg viewBox="0 0 80 80" className="h-14 w-14 text-[var(--color-text-muted)] opacity-50" aria-hidden>
          <rect x="18" y="12" width="36" height="48" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M42 12 V24 H54" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="48" cy="44" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <line x1="54" y1="50" x2="62" y2="58" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-base font-semibold text-[var(--color-text)]">No Site Visits Found</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--color-text-muted)]">
        No visits recorded for the selected period. Log a new site visit to track locations, purpose, and time.
      </p>
      {onAdd ? (
        <div className="mt-5">
          <Button variant="add" type="button" onClick={onAdd} leftIcon={<Plus className="h-4 w-4" strokeWidth={2.5} />}>
            Record Site Visit
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MonthNavigator({ date, onChange, className = "" }) {
  const shift = (delta) => {
    const next = new Date(date);
    next.setMonth(next.getMonth() + delta);
    onChange(next);
  };
  const setToday = () => onChange(new Date());

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`.trim()}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-[var(--color-border-soft)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-[8rem] text-center text-base font-bold text-[var(--color-text)]">
          {formatMonthYear(date)}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-[var(--color-border-soft)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
          aria-label="Next month"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <button
        type="button"
        onClick={setToday}
        className="rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] dark:bg-slate-900"
      >
        Current Month
      </button>
    </div>
  );
}

function PeriodToggle({ value, onChange }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-[var(--color-primary)]">
      {PERIOD_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex-1 px-3 py-2 text-sm font-semibold transition-colors ${
            value === tab.id
              ? "bg-[var(--color-primary)] text-white"
              : "bg-white text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] dark:bg-slate-900"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function EmployeeRow({ employee, selected, onSelect, selectionStyle = "border" }) {
  const selectedClass =
    selectionStyle === "bar"
      ? "border border-[var(--color-border-soft)] border-r-4 border-r-[var(--color-primary)] bg-[var(--color-primary-soft)]/40"
      : selected
        ? "border border-[var(--color-primary)] bg-[var(--color-primary-soft)]/30"
        : "border border-[var(--color-border-soft)] hover:bg-[var(--color-surface-muted)]";

  return (
    <button
      type="button"
      onClick={() => onSelect(employee)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${selectedClass}`}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
        {employee.has_avatar ? (
          <span className="text-xs font-semibold text-[var(--color-primary)]">{employee.initials}</span>
        ) : (
          <User className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--color-text)]">{employee.name}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{placesLabel(employee.places_visited)}</p>
      </div>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" aria-hidden />
    </button>
  );
}

function RecordSiteVisitModal({ open, onClose, onSave, initialData, employees }) {
  const [customerSite, setCustomerSite] = useState("");
  const [purpose, setPurpose] = useState(PURPOSE_OPTIONS[0]);
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("13:00");
  const [location, setLocation] = useState("");
  const [travelDetails, setTravelDetails] = useState("");
  const [status, setStatus] = useState("completed");
  const [employeeId, setEmployeeId] = useState("");
  const [notes, setNotes] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setCustomerSite(initialData.customer_site || "");
      setPurpose(initialData.purpose || PURPOSE_OPTIONS[0]);
      setVisitDate(initialData.visit_date ? String(initialData.visit_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
      setStartTime(initialData.start_time ? String(initialData.start_time).slice(0, 5) : "10:00");
      setEndTime(initialData.end_time ? String(initialData.end_time).slice(0, 5) : "13:00");
      setLocation(initialData.location || "");
      setTravelDetails(initialData.travel_details || "");
      setStatus(initialData.status || "completed");
      setEmployeeId(initialData.employee_id ? String(initialData.employee_id) : "");
      setNotes(initialData.notes || "");
    } else {
      setCustomerSite("");
      setPurpose(PURPOSE_OPTIONS[0]);
      setVisitDate(new Date().toISOString().slice(0, 10));
      setStartTime("10:00");
      setEndTime("13:00");
      setLocation("");
      setTravelDetails("");
      setStatus("completed");
      setEmployeeId("");
      setNotes("");
    }
  }, [open, initialData]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const handleGetGps = () => {
    if (!navigator.geolocation) {
      addToast("Geolocation is not supported by your browser.", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        const coordText = `GPS: ${lat}, ${lng}`;
        setLocation((prev) => (prev ? `${prev} (${coordText})` : coordText));
        addToast("GPS Coordinates detected successfully!", "success");
      },
      (err) => {
        setLocating(false);
        addToast(`Could not obtain location: ${err.message}`, "error");
      },
      { timeout: 8000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customerSite.trim()) {
      addToast("Please enter customer or site name", "error");
      return;
    }
    setSaving(true);
    try {
      const selectedEmp = employees.find((emp) => String(emp.id) === String(employeeId));
      const payload = {
        customer_site: customerSite.trim(),
        purpose: purpose.trim(),
        visit_date: visitDate,
        start_time: startTime,
        end_time: endTime,
        location: location.trim(),
        travel_details: travelDetails.trim(),
        status,
        employee_id: employeeId ? Number(employeeId) : null,
        employee_name: selectedEmp ? selectedEmp.name : undefined,
        notes: notes.trim(),
      };
      await onSave(payload, initialData?.id);
      onClose();
    } catch (err) {
      addToast(err?.message || "Failed to save site visit", "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">
              {initialData ? "Edit Site Visit" : "Record Site Visit"}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Log on-site client interactions, inspections, or maintenance visits.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[80vh] overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
              Customer / Site Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={customerSite}
              onChange={(e) => setCustomerSite(e.target.value)}
              placeholder="e.g. Apex Industrial Park - Unit 4"
              className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Purpose of Visit
              </label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              >
                {PURPOSE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Assigned Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              >
                <option value="">Current User / Self</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Visit Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                End Time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-[var(--color-text)]">
                Location / Address
              </label>
              <button
                type="button"
                onClick={handleGetGps}
                disabled={locating}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                <Navigation className="h-3 w-3" />
                {locating ? "Detecting GPS…" : "Detect GPS"}
              </button>
            </div>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Hitec City, Plot 22, Hyderabad"
              className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Travel Details
              </label>
              <input
                type="text"
                value={travelDetails}
                onChange={(e) => setTravelDetails(e.target.value)}
                placeholder="e.g. Company Car - 24 km"
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
              >
                <option value="completed">Completed</option>
                <option value="in_progress">In Progress</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text)] mb-1">
              Notes & Observations
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Key discussion points, customer feedback, or follow-up tasks…"
              className="w-full rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--color-border-soft)]">
            <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="add" type="submit" loading={saving}>
              {initialData ? "Save Changes" : "Record Visit"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function MapPreviewModal({ open, onClose, visit }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !visit || typeof document === "undefined") return null;

  const mockEmployee = {
    id: visit.id || 1,
    name: visit.customer_site || "Site Location",
    initials: (visit.customer_site || "ST").slice(0, 2).toUpperCase(),
    has_avatar: false,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)]">{visit.customer_site}</h2>
            <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mt-0.5">
              <MapPin className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              {visit.location || "Location Coordinates Preview"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="h-[360px] rounded-xl overflow-hidden border border-[var(--color-border-soft)]">
            <SiteVisitMap employee={mockEmployee} className="h-full w-full" />
          </div>
          {visit.notes ? (
            <p className="mt-3 text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] p-3 rounded-lg">
              <span className="font-semibold text-[var(--color-text)]">Notes: </span>
              {visit.notes}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function SiteVisit() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState("my");
  const [period, setPeriod] = useState("daily");
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [visits, setVisits] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState(null);
  const [mapModalVisit, setMapModalVisit] = useState(null);
  const [deletingVisit, setDeletingVisit] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [empRes, visitRes] = await Promise.all([
        getEmployeesEnriched().catch(() => ({ data: [] })),
        getSiteVisits().catch(() => ({ data: [] })),
      ]);
      const rawVisits = Array.isArray(visitRes.data) ? visitRes.data : [];
      setVisits(rawVisits);

      const merged = mergeSiteVisitEmployees(empRes.data || [], { period, visits: rawVisits });
      setEmployees(merged);
      setSelectedEmployeeId((prev) => prev ?? merged[0]?.id ?? null);
    } catch {
      if (!isRefresh) {
        const fallback = mergeSiteVisitEmployees([], { period });
        setEmployees(fallback);
        setSelectedEmployeeId((prev) => prev ?? fallback[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [period]);

  usePageRefresh(() => load(true));

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveVisit = async (payload, visitId) => {
    if (visitId) {
      await updateSiteVisit(visitId, payload);
      addToast("Site visit updated successfully", "success");
    } else {
      await createSiteVisit(payload);
      addToast("Site visit recorded successfully", "success");
    }
    load(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingVisit) return;
    setDeleteBusy(true);
    try {
      await deleteSiteVisit(deletingVisit.id);
      addToast("Site visit deleted", "success");
      setDeletingVisit(null);
      load(true);
    } catch (err) {
      addToast(err?.message || "Failed to delete site visit", "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const selectedMonthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

  const monthVisits = useMemo(() => {
    return visits.filter((v) => {
      const vDate = v.visit_date ? String(v.visit_date).slice(0, 7) : "";
      return vDate === selectedMonthStr;
    });
  }, [visits, selectedMonthStr]);

  const monthKpis = useMemo(() => {
    const total = monthVisits.length;
    const completed = monthVisits.filter((v) => v.status === "completed").length;
    const inProgress = monthVisits.filter((v) => v.status === "in_progress" || v.status === "scheduled").length;
    const sites = new Set(monthVisits.map((v) => v.customer_site).filter(Boolean)).size;
    return { total, completed, inProgress, sites };
  }, [monthVisits]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) || filteredEmployees[0] || null,
    [employees, selectedEmployeeId, filteredEmployees]
  );

  const selectedEmployeeVisits = useMemo(() => {
    if (!selectedEmployee) return [];
    return visits.filter((v) => {
      const matchEmp = v.employee_id === selectedEmployee.id || (v.employee_name && v.employee_name.toLowerCase() === selectedEmployee.name.toLowerCase());
      return matchEmp;
    });
  }, [visits, selectedEmployee]);

  const weekRange = useMemo(() => getWeekRange(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const visitTotal = useMemo(() => totalVisitsForPeriod(employees, period), [employees, period]);

  if (loading) return <Loader label="Loading site visits..." />;

  return (
    <ListPageShell>
      <HrPage>
        <HrPageHeader
          title="Site Visit"
          action={
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="outline"
                to="/hr/reports/site-visit"
                leftIcon={<FileText className="h-4 w-4" />}
              >
                Reports
              </Button>
              <Button
                variant="add"
                type="button"
                onClick={() => {
                  setEditingVisit(null);
                  setModalOpen(true);
                }}
                leftIcon={<Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
              >
                Record Site Visit
              </Button>
            </div>
          }
        />

        <div className="ui-card overflow-hidden shadow-sm">
          {/* Main Module Tabs */}
          <div className="flex overflow-x-auto border-b border-[var(--color-border-soft)]">
            {MAIN_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMainTab(tab.id)}
                className={`shrink-0 border-b-2 px-6 py-3.5 text-sm font-semibold transition-colors ${
                  mainTab === tab.id
                    ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 sm:p-6">
            {mainTab === "my" ? (
              <div className="space-y-6">
                {/* Month Navigator */}
                <MonthNavigator date={monthDate} onChange={setMonthDate} />

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                  <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">Total Visits</p>
                    <p className="mt-1 text-2xl font-bold text-[var(--color-text)]">{monthKpis.total}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">Completed</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{monthKpis.completed}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">Active / Scheduled</p>
                    <p className="mt-1 text-2xl font-bold text-sky-600 dark:text-sky-400">{monthKpis.inProgress}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">Sites Visited</p>
                    <p className="mt-1 text-2xl font-bold text-[var(--color-primary)]">{monthKpis.sites}</p>
                  </div>
                </div>

                {/* Visits List or Empty State */}
                {monthVisits.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {monthVisits.map((v) => (
                      <div
                        key={v.id}
                        className="flex flex-col justify-between rounded-xl border border-[var(--color-border-soft)] bg-white p-4 shadow-xs transition-shadow hover:shadow-md dark:bg-slate-900"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)]">
                              <Calendar className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                              {formatSiteVisitDate(v.visit_date)}
                            </span>
                            <StatusBadge status={v.status} />
                          </div>

                          <div>
                            <h3 className="text-base font-bold text-[var(--color-text)] line-clamp-1" title={v.customer_site}>
                              {v.customer_site}
                            </h3>
                            <p className="text-xs font-medium text-[var(--color-primary)] mt-0.5">
                              {v.purpose || "Site Visit"}
                            </p>
                          </div>

                          {v.location ? (
                            <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)] line-clamp-2">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] mt-0.5" />
                              <span>{v.location}</span>
                            </p>
                          ) : null}

                          {(v.start_time || v.end_time) ? (
                            <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                              <Clock className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                {v.start_time ? String(v.start_time).slice(0, 5) : "—"} to {v.end_time ? String(v.end_time).slice(0, 5) : "—"}
                              </span>
                            </p>
                          ) : null}

                          {v.travel_details ? (
                            <p className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-muted)] px-2.5 py-1 rounded-md">
                              🚗 {v.travel_details}
                            </p>
                          ) : null}

                          {v.notes ? (
                            <p className="text-xs text-[var(--color-text-muted)] italic line-clamp-2">
                              "{v.notes}"
                            </p>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-between border-t border-[var(--color-border-soft)] pt-3 mt-4">
                          <button
                            type="button"
                            onClick={() => setMapModalVisit(v)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Map View
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingVisit(v);
                                setModalOpen(true);
                              }}
                              className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                              title="Edit Visit"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingVisit(v)}
                              className="grid h-7 w-7 place-items-center rounded-md text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/50"
                              title="Delete Visit"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <NoDataIllustration
                    onAdd={() => {
                      setEditingVisit(null);
                      setModalOpen(true);
                    }}
                  />
                )}
              </div>
            ) : (
              /* Employee Visits Tab */
              <div className="grid gap-6 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
                <aside className="flex min-h-[460px] flex-col gap-3.5 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                  <PeriodToggle value={period} onChange={setPeriod} />

                  {period === "daily" ? (
                    <label className="relative flex items-center gap-2 rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-2 text-sm text-[var(--color-text-secondary)] dark:bg-slate-900">
                      <span className="min-w-0 flex-1">{formatSiteVisitDate(selectedDate.toISOString().slice(0, 10))}</span>
                      <input
                        type="date"
                        value={selectedDate.toISOString().slice(0, 10)}
                        onChange={(e) => setSelectedDate(new Date(`${e.target.value}T12:00:00`))}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Select date"
                      />
                      <Calendar className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                    </label>
                  ) : null}

                  {period === "weekly" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--color-text)]">
                        <button
                          type="button"
                          onClick={() => {
                            const d = new Date(selectedDate);
                            d.setDate(d.getDate() - 7);
                            setSelectedDate(d);
                          }}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          aria-label="Previous week"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-center text-xs sm:text-sm">
                          {formatWeekRangeLabel(weekRange.start, weekRange.end)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const d = new Date(selectedDate);
                            d.setDate(d.getDate() + 7);
                            setSelectedDate(d);
                          }}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          aria-label="Next week"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex justify-between gap-1">
                        {weekDays.map((day) => (
                          <button
                            key={day.key}
                            type="button"
                            onClick={() => setSelectedDate(new Date(`${day.key}T12:00:00`))}
                            className={`flex flex-1 flex-col items-center rounded-lg py-1.5 text-xs ${
                              day.isSelected
                                ? "bg-[var(--color-primary)] font-semibold text-white"
                                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                            }`}
                          >
                            <span>{day.label}</span>
                            <span className="text-sm">{day.date}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {period === "monthly" ? (
                    <label className="relative flex items-center gap-2 rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-2 text-sm text-[var(--color-text-secondary)] dark:bg-slate-900">
                      <span className="min-w-0 flex-1">{formatMonthPicker(selectedDate)}</span>
                      <input
                        type="month"
                        value={`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}`}
                        onChange={(e) => {
                          const [y, m] = e.target.value.split("-");
                          setSelectedDate(new Date(Number(y), Number(m) - 1, 1));
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Select month"
                      />
                      <Calendar className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                    </label>
                  ) : null}

                  <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-2 dark:bg-slate-900">
                    <Search className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search Employees…"
                      className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-[var(--color-text-faint)]"
                    />
                  </label>

                  <div className="flex items-center justify-between px-0.5 text-sm">
                    <span className="font-semibold text-[var(--color-text)]">Employees</span>
                    {(period === "weekly" || period === "monthly") && visitTotal > 0 ? (
                      <span className="font-semibold text-[var(--color-primary)]">{visitTotal} Visits</span>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5 max-h-[380px]">
                    {filteredEmployees.length ? (
                      filteredEmployees.map((emp) => (
                        <EmployeeRow
                          key={emp.id}
                          employee={emp}
                          selected={emp.id === selectedEmployee?.id}
                          onSelect={(e) => setSelectedEmployeeId(e.id)}
                          selectionStyle={period === "weekly" || period === "monthly" ? "bar" : "border"}
                        />
                      ))
                    ) : (
                      <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">No employees found</p>
                    )}
                  </div>
                </aside>

                <div className="space-y-4">
                  {/* Selected Employee Header & Summary */}
                  {selectedEmployee ? (
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                      <div className="flex items-center gap-3">
                        <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-primary-soft)] text-base font-bold text-[var(--color-primary)]">
                          {selectedEmployee.initials}
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-[var(--color-text)]">{selectedEmployee.name}</h3>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {placesLabel(selectedEmployee.places_visited)} • Active field employee
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="add"
                        type="button"
                        onClick={() => {
                          setEditingVisit(null);
                          setModalOpen(true);
                        }}
                        leftIcon={<Plus className="h-4 w-4" strokeWidth={2.5} />}
                      >
                        Record Visit
                      </Button>
                    </div>
                  ) : null}

                  {/* Interactive Site Map */}
                  <div className="h-[360px] rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] overflow-hidden shadow-xs">
                    {selectedEmployee ? (
                      <SiteVisitMap employee={selectedEmployee} className="h-full w-full" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
                        Select an employee to view location & routes
                      </div>
                    )}
                  </div>

                  {/* Selected Employee's Recorded Visits */}
                  {selectedEmployeeVisits.length > 0 ? (
                    <div className="rounded-xl border border-[var(--color-border-soft)] bg-white p-4 dark:bg-slate-900">
                      <h4 className="text-sm font-bold text-[var(--color-text)] mb-3">
                        Visits by {selectedEmployee?.name} ({selectedEmployeeVisits.length})
                      </h4>
                      <div className="space-y-2.5">
                        {selectedEmployeeVisits.map((v) => (
                          <div
                            key={v.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[var(--color-text)] text-sm">{v.customer_site}</span>
                                <StatusBadge status={v.status} />
                              </div>
                              <p className="text-[var(--color-text-muted)]">
                                {formatSiteVisitDate(v.visit_date)} • {v.purpose} • {v.location || "On-site"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setMapModalVisit(v)}
                              className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)] hover:underline"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              View
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Record / Edit Site Visit Modal */}
        <RecordSiteVisitModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditingVisit(null);
          }}
          onSave={handleSaveVisit}
          initialData={editingVisit}
          employees={employees}
        />

        {/* Map Preview Modal */}
        <MapPreviewModal
          open={Boolean(mapModalVisit)}
          onClose={() => setMapModalVisit(null)}
          visit={mapModalVisit}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          open={Boolean(deletingVisit)}
          title="Delete Site Visit"
          message={`Are you sure you want to delete the site visit to "${deletingVisit?.customer_site}"? This action cannot be undone.`}
          confirmLabel="Delete Visit"
          destructive
          loading={deleteBusy}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeletingVisit(null)}
        />
      </HrPage>
    </ListPageShell>
  );
}
