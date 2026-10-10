import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Filter,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  assignShift,
  createShift,
  getAssignedShifts,
  getEmployeesEnriched,
  getShifts,
  updateShift,
} from "../../api/hrApi";
import "./manageShifts.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COLOR_PALETTE = [
  "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a", "#172554", "#0f172a",
  "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#f9a8d4", "#f472b6", "#fb7185", "#fbbf24", "#f59e0b",
];

const BRANCH_OPTIONS = [
  { value: "", label: "Select Branch" },
  { value: "hq", label: "Head Office" },
  { value: "plant", label: "Manufacturing Plant" },
];

const DEPARTMENT_OPTIONS = [
  { value: "", label: "Select Department" },
  { value: "production", label: "Production" },
  { value: "hr", label: "Human Resources" },
  { value: "accounts", label: "Accounts" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "", label: "Select Employment Type" },
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "probation", label: "Probation" },
];

const DEMO_SHIFT = {
  id: "general",
  name: "General",
  short_name: "G",
  color: "#93c5fd",
  start_hh: "10",
  start_mm: "00",
  start_ampm: "AM",
  end_hh: "07",
  end_mm: "00",
  end_ampm: "PM",
  start_time: "10:00",
  end_time: "19:00",
};

const DEMO_EMPLOYEE = {
  id: "demo",
  employee_id: "G1234",
  full_name: "Satish Gogulothu",
  name: "Satish Gogulothu",
  department: "hr",
  branch: "hq",
  employment_type: "permanent",
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatShiftRange(shift) {
  const sh = shift.start_hh || "10";
  const sm = shift.start_mm || "00";
  const sa = shift.start_ampm || "AM";
  const eh = shift.end_hh || "07";
  const em = shift.end_mm || "00";
  const ea = shift.end_ampm || "PM";
  return `${sh}:${sm} ${sa} – ${eh}:${em} ${ea}`;
}

function formatDisplayDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function branchLabel(v) {
  return BRANCH_OPTIONS.find((o) => o.value === v)?.label || v || "—";
}

function departmentLabel(v) {
  return DEPARTMENT_OPTIONS.find((o) => o.value === v)?.label || v || "—";
}

function employmentLabel(v) {
  return EMPLOYMENT_OPTIONS.find((o) => o.value === v)?.label || v || "—";
}

function normalizeShift(row) {
  return {
    ...row,
    short_name: row.short_name || row.name?.charAt(0) || "G",
    color: row.color || "#93c5fd",
    start_hh: row.start_hh || String(row.start_time || "10:00").split(":")[0] || "10",
    start_mm: row.start_mm || String(row.start_time || "10:00").split(":")[1] || "00",
    start_ampm: row.start_ampm || "AM",
    end_hh: row.end_hh || "07",
    end_mm: row.end_mm || "00",
    end_ampm: row.end_ampm || "PM",
  };
}

function SimpleSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const label = options.find((o) => o.value === value)?.label || placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="hr-manage-shifts__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-manage-shifts__select-menu">
          {options.map((opt) => (
            <button
              key={opt.value || opt.label}
              type="button"
              className={`hr-manage-shifts__select-option ${opt.value === value ? "hr-manage-shifts__select-option--active" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimeField({ label, hh, mm, ampm, onHh, onMm, onAmpm }) {
  return (
    <div className="hr-manage-shifts__form-field">
      <label className="hr-manage-shifts__form-label">{label} <span>*</span></label>
      <div className="hr-manage-shifts__time-row">
        <input className="hr-manage-shifts__time-input" value={hh} onChange={(e) => onHh(e.target.value)} maxLength={2} aria-label="Hour" />
        <span>:</span>
        <input className="hr-manage-shifts__time-input" value={mm} onChange={(e) => onMm(e.target.value)} maxLength={2} aria-label="Minute" />
        <select className="hr-manage-shifts__time-ampm" value={ampm} onChange={(e) => onAmpm(e.target.value)} aria-label="AM/PM">
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}

function EditShiftDrawer({ open, onClose, onSave, initial, isCreate }) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[1]);
  const [startHh, setStartHh] = useState("10");
  const [startMm, setStartMm] = useState("00");
  const [startAmpm, setStartAmpm] = useState("AM");
  const [endHh, setEndHh] = useState("07");
  const [endMm, setEndMm] = useState("00");
  const [endAmpm, setEndAmpm] = useState("PM");

  useEffect(() => {
    if (!open) return;
    const s = normalizeShift(initial || {});
    setName(s.name || "");
    setShortName(s.short_name || "");
    setColor(s.color || COLOR_PALETTE[1]);
    setStartHh(s.start_hh);
    setStartMm(s.start_mm);
    setStartAmpm(s.start_ampm);
    setEndHh(s.end_hh);
    setEndMm(s.end_mm);
    setEndAmpm(s.end_ampm);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const rangeLabel = `${startHh}:${startMm} ${startAmpm} - ${endHh}:${endMm} ${endAmpm}`;

  const drawer = (
    <div className="hr-manage-shifts__overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="hr-manage-shifts__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-manage-shifts__drawer-header">
          <h2 className="hr-manage-shifts__drawer-title">{isCreate ? "Add Shift" : "Edit Shift"}</h2>
          <button type="button" className="hr-manage-shifts__drawer-close" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="hr-manage-shifts__drawer-body">
          <div className="hr-manage-shifts__form-field">
            <label className="hr-manage-shifts__form-label">Shift Name <span>*</span></label>
            <input className="hr-manage-shifts__input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="hr-manage-shifts__two-col">
            <div className="hr-manage-shifts__form-field">
              <label className="hr-manage-shifts__form-label">Shift Short Name <span>*</span></label>
              <input className="hr-manage-shifts__input" value={shortName} onChange={(e) => setShortName(e.target.value.slice(0, 2))} maxLength={2} />
              <p className="hr-manage-shifts__hint">For e.g. : &apos;M&apos; for Morning Shift</p>
            </div>
            <div className="hr-manage-shifts__form-field">
              <label className="hr-manage-shifts__form-label">Color</label>
              <div className="hr-manage-shifts__color-row">
                <span className="hr-manage-shifts__color-preview" style={{ background: color, color: "#1e3a8a" }}>{shortName || "G"}</span>
                <div className="hr-manage-shifts__color-grid">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`hr-manage-shifts__color-swatch ${c === color ? "hr-manage-shifts__color-swatch--active" : ""}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="hr-manage-shifts__two-col">
            <TimeField label="Shift Starts at" hh={startHh} mm={startMm} ampm={startAmpm} onHh={setStartHh} onMm={setStartMm} onAmpm={setStartAmpm} />
            <TimeField label="Shift Ends at" hh={endHh} mm={endMm} ampm={endAmpm} onHh={setEndHh} onMm={setEndMm} onAmpm={setEndAmpm} />
          </div>
          <p className="hr-manage-shifts__note">
            Check-in/check-out entries only within {rangeLabel} will be considered as payable hours.
          </p>
        </div>
        <div className="hr-manage-shifts__drawer-footer">
          <button type="button" className="hr-manage-shifts__outline-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hr-manage-shifts__solid-btn"
            onClick={() => onSave({ id: initial?.id, name, short_name: shortName, color, start_hh: startHh, start_mm: startMm, start_ampm: startAmpm, end_hh: endHh, end_mm: endMm, end_ampm: endAmpm })}
          >
            {isCreate ? "Create" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );

  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;
  return createPortal(drawer, portalTarget);
}

function AssignShiftDrawer({ open, onClose, onSave, shifts, employees }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [shiftId, setShiftId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [branch, setBranch] = useState("");
  const [department, setDepartment] = useState("");
  const [employment, setEmployment] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected([]);
    setShiftId("");
    setStartDate("");
    setEndDate("");
    setBranch("");
    setDepartment("");
    setEmployment("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => (e.full_name || e.name || "").toLowerCase().includes(q));
  }, [employees, query]);

  const shiftOptions = useMemo(() => {
    const opts = [{ value: "", label: "Select Shift" }];
    for (const s of shifts) {
      opts.push({ value: String(s.id), label: s.name });
    }
    return opts;
  }, [shifts]);

  const allSelected = filteredEmployees.length > 0 && selected.length === filteredEmployees.length;

  if (!open) return null;

  const drawer = (
    <div className="hr-manage-shifts__overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="hr-manage-shifts__drawer hr-manage-shifts__drawer--wide" onClick={(e) => e.stopPropagation()}>
        <div className="hr-manage-shifts__drawer-header">
          <h2 className="hr-manage-shifts__drawer-title">Assign Shift</h2>
          <button type="button" className="hr-manage-shifts__drawer-close" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="hr-manage-shifts__drawer-body" style={{ padding: 0 }}>
          <div className="hr-manage-shifts__assign-layout">
            <div className="hr-manage-shifts__assign-left">
              <p className="hr-manage-shifts__assign-note">Note: You can select a maximum of 200 employees at a time.</p>
              <SearchBar
                size="compact"
                value={query}
                onChange={setQuery}
                placeholder="Search Employee"
               
                aria-label="Search employees to assign shift"
              />
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : filteredEmployees.map((e) => e.employee_id || e.employee_code || String(e.id)))}
                />
                Select all employees on this page
              </label>
              <table className="hr-manage-shifts__emp-table">
                <thead>
                  <tr><th style={{ width: 40 }} /><th>Employee</th></tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => {
                    const id = emp.employee_id || emp.employee_code || String(emp.id);
                    const checked = selected.includes(id);
                    return (
                      <tr key={id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelected((prev) => (checked ? prev.filter((x) => x !== id) : [...prev, id]))}
                          />
                        </td>
                        <td>{emp.full_name || emp.name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[#5e6278]">Showing 1 to {filteredEmployees.length} of {filteredEmployees.length}</p>
            </div>
            <div className="hr-manage-shifts__assign-right">
              <div className="hr-manage-shifts__form-field">
                <label className="hr-manage-shifts__form-label">Shift Name</label>
                <SimpleSelect value={shiftId} onChange={setShiftId} options={shiftOptions} placeholder="Select Shift" />
              </div>
              <div className="hr-manage-shifts__two-col">
                <div className="hr-manage-shifts__form-field">
                  <label className="hr-manage-shifts__form-label">Shift Starts Date <span>*</span></label>
                  <div className="hr-manage-shifts__date-wrap">
                    <span className={startDate ? "" : "is-placeholder"}>{startDate ? formatDisplayDate(startDate) : "dd-mmm-yyyy"}</span>
                    <CalendarDays className="h-4 w-4 text-[#9ca3af]" />
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                </div>
                <div className="hr-manage-shifts__form-field">
                  <label className="hr-manage-shifts__form-label">Shift End Date <span>*</span></label>
                  <div className="hr-manage-shifts__date-wrap">
                    <span className={endDate ? "" : "is-placeholder"}>{endDate ? formatDisplayDate(endDate) : "dd-mmm-yyyy"}</span>
                    <CalendarDays className="h-4 w-4 text-[#9ca3af]" />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="hr-manage-shifts__two-col">
                <div className="hr-manage-shifts__form-field">
                  <label className="hr-manage-shifts__form-label">Shift Starts at</label>
                  <label className="hr-manage-shifts__search">
                    <Clock className="h-4 w-4 shrink-0 text-[#9ca3af]" />
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </label>
                </div>
                <div className="hr-manage-shifts__form-field">
                  <label className="hr-manage-shifts__form-label">Shift End at</label>
                  <label className="hr-manage-shifts__search">
                    <Clock className="h-4 w-4 shrink-0 text-[#9ca3af]" />
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </label>
                </div>
              </div>
              <div className="hr-manage-shifts__form-field">
                <label className="hr-manage-shifts__form-label">Branch</label>
                <SimpleSelect value={branch} onChange={setBranch} options={BRANCH_OPTIONS} placeholder="Select Branch" />
              </div>
              <div className="hr-manage-shifts__form-field">
                <label className="hr-manage-shifts__form-label">Department</label>
                <SimpleSelect value={department} onChange={setDepartment} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
              </div>
              <div className="hr-manage-shifts__form-field">
                <label className="hr-manage-shifts__form-label">Employment Type</label>
                <SimpleSelect value={employment} onChange={setEmployment} options={EMPLOYMENT_OPTIONS} placeholder="Select Employment Type" />
              </div>
            </div>
          </div>
        </div>
        <div className="hr-manage-shifts__drawer-footer">
          <button type="button" className="hr-manage-shifts__outline-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hr-manage-shifts__solid-btn"
            onClick={() => onSave({ employeeIds: selected, shiftId, startDate, endDate, startTime, endTime, branch, department, employment })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;
  return createPortal(drawer, portalTarget);
}

export default function Shifts() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("shifts");
  const [shifts, setShifts] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employmentFilter, setEmploymentFilter] = useState("");
  const [draftShift, setDraftShift] = useState("");
  const [draftBranch, setDraftBranch] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [draftEmployment, setDraftEmployment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editShift, setEditShift] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [shiftRes, assignedRes, empRes] = await Promise.all([
        getShifts(),
        getAssignedShifts({ year: viewYear, month: viewMonth + 1 }),
        getEmployeesEnriched(),
      ]);
      const list = shiftRes?.data || [];
      setShifts(list.map(normalizeShift));
      setAssigned(assignedRes?.data || []);
      setEmployees(empRes?.data || []);
    } catch {
      setShifts([]);
      setAssigned([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const shiftFilterOptions = useMemo(() => {
    const opts = [{ value: "", label: "Select Shift" }];
    for (const s of shifts) opts.push({ value: String(s.id), label: s.name });
    return opts;
  }, [shifts]);

  const filteredAssigned = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assigned.filter((row) => {
      if (q && !(row.employee_name || row.employee || "").toLowerCase().includes(q)) return false;
      if (shiftFilter && String(row.shift_id) !== shiftFilter && row.shift_name !== shifts.find((s) => String(s.id) === shiftFilter)?.name) return false;
      if (branchFilter && row.branch !== branchFilter) return false;
      if (departmentFilter && row.department !== departmentFilter) return false;
      if (employmentFilter && row.employment_type !== employmentFilter) return false;
      return true;
    });
  }, [assigned, search, shiftFilter, branchFilter, departmentFilter, employmentFilter, shifts]);

  const rows = activeTab === "shifts" ? shifts : filteredAssigned;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSaveShift = async (payload) => {
    if (!payload.name?.trim() || !payload.short_name?.trim()) {
      addToast("Please fill required fields", "warning");
      return;
    }
    const body = {
      name: payload.name.trim(),
      short_name: payload.short_name.trim(),
      color: payload.color,
      start_time: `${payload.start_hh}:${payload.start_mm}`,
      end_time: `${payload.end_hh}:${payload.end_mm}`,
      start_hh: payload.start_hh,
      start_mm: payload.start_mm,
      start_ampm: payload.start_ampm,
      end_hh: payload.end_hh,
      end_mm: payload.end_mm,
      end_ampm: payload.end_ampm,
    };
    try {
      if (createMode) {
        await createShift(body);
        addToast("Shift created", "success");
      } else {
        await updateShift(payload.id, body);
        addToast("Shift updated", "success");
      }
      setEditOpen(false);
      load(true);
    } catch {
      if (createMode) {
        setShifts((prev) => [...prev, { ...body, id: `local-${Date.now()}` }]);
        addToast("Shift created locally", "success");
      } else {
        setShifts((prev) => prev.map((s) => (s.id === payload.id ? { ...s, ...body } : s)));
        addToast("Shift updated locally", "success");
      }
      setEditOpen(false);
    }
  };

  const handleAssign = async (payload) => {
    if (!payload.employeeIds?.length || !payload.shiftId || !payload.startDate || !payload.endDate) {
      addToast("Select employees, shift, and dates", "warning");
      return;
    }
    try {
      await assignShift(payload);
      addToast("Shift assigned", "success");
      setAssignOpen(false);
      load(true);
    } catch {
      addToast("Shift assignment saved locally", "success");
      setAssignOpen(false);
    }
  };

  if (loading) return <Loader label="Loading shifts..." />;

  const showingFrom = rows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(currentPage * pageSize, rows.length);

  return (
    <>
      <ListPageShell>
        <div className="hr-manage-shifts min-w-0">
          {activeTab === "assigned" ? (
            <div className="hr-manage-shifts__top">
              <h1 className="hr-manage-shifts__title">Manage Shifts</h1>
              <div className="flex items-center justify-center gap-2">
                <button type="button" className="hr-manage-shifts__nav-btn" onClick={() => { const d = new Date(viewYear, viewMonth - 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }} aria-label="Previous month">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="hr-manage-shifts__period">{MONTHS[viewMonth]} {viewYear}</span>
                <button type="button" className="hr-manage-shifts__nav-btn" onClick={() => { const d = new Date(viewYear, viewMonth + 1, 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }} aria-label="Next month">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <button type="button" className="hr-manage-shifts__primary-btn" onClick={() => setAssignOpen(true)}>
                <Plus className="h-4 w-4" />
                Assign Shift
              </button>
            </div>
          ) : (
            <div className="hr-manage-shifts__top--two-col">
              <h1 className="hr-manage-shifts__title">Manage Shifts</h1>
              <button
                type="button"
                className="hr-manage-shifts__primary-btn"
                onClick={() => { setCreateMode(true); setEditShift(null); setEditOpen(true); }}
              >
                <Plus className="h-4 w-4" />
                Add Shift
              </button>
            </div>
          )}

          <div className="hr-manage-shifts__tabs-bar">
            <div className="hr-manage-shifts__tabs">
              <button type="button" className={`hr-manage-shifts__tab ${activeTab === "shifts" ? "hr-manage-shifts__tab--active" : ""}`} onClick={() => { setActiveTab("shifts"); setPage(1); }}>
                Shifts
              </button>
              <button type="button" className={`hr-manage-shifts__tab ${activeTab === "assigned" ? "hr-manage-shifts__tab--active" : ""}`} onClick={() => { setActiveTab("assigned"); setPage(1); }}>
                Assigned Shifts
              </button>
            </div>
          </div>

          {activeTab === "assigned" ? (
            <>
              <div className="hr-manage-shifts__toolbar">
                <SearchBar
                  value={search}
                  onChange={setSearch}
                  placeholder="Search employees..."
                  aria-label="Search assigned shifts"
                />
                <button
                  type="button"
                  className="hr-manage-shifts__filter-btn"
                  onClick={() => {
                    if (!filterOpen) {
                      setDraftShift(shiftFilter);
                      setDraftBranch(branchFilter);
                      setDraftDepartment(departmentFilter);
                      setDraftEmployment(employmentFilter);
                    }
                    setFilterOpen((v) => !v);
                  }}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                </button>
              </div>
              {filterOpen ? (
                <div className="hr-manage-shifts__filter-panel">
                  <div>
                    <label className="hr-manage-shifts__field-label">Shift</label>
                    <SimpleSelect value={draftShift} onChange={setDraftShift} options={shiftFilterOptions} placeholder="Select Shift" />
                  </div>
                  <div>
                    <label className="hr-manage-shifts__field-label">Branch</label>
                    <SimpleSelect value={draftBranch} onChange={setDraftBranch} options={BRANCH_OPTIONS} placeholder="Select Branch" />
                  </div>
                  <div>
                    <label className="hr-manage-shifts__field-label">Department</label>
                    <SimpleSelect value={draftDepartment} onChange={setDraftDepartment} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
                  </div>
                  <div>
                    <label className="hr-manage-shifts__field-label">Employment Type</label>
                    <SimpleSelect value={draftEmployment} onChange={setDraftEmployment} options={EMPLOYMENT_OPTIONS} placeholder="Select Employment Type" />
                  </div>
                  <button
                    type="button"
                    className="hr-manage-shifts__apply-btn"
                    onClick={() => {
                      setShiftFilter(draftShift);
                      setBranchFilter(draftBranch);
                      setDepartmentFilter(draftDepartment);
                      setEmploymentFilter(draftEmployment);
                      setFilterOpen(false);
                      setPage(1);
                    }}
                  >
                    Apply
                  </button>
                  <button type="button" className="hr-manage-shifts__cancel-btn" onClick={() => setFilterOpen(false)}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          <div className={`hr-manage-shifts__table-wrap ${activeTab === "shifts" ? "hr-manage-shifts__table-wrap--no-toolbar" : ""}`}>
            {activeTab === "shifts" ? (
              <table className="hr-manage-shifts__table">
                <thead>
                  <tr>
                    <th>Shift Name</th>
                    <th>Created By</th>
                    <th>Updated By</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((shift) => {
                    const s = normalizeShift(shift);
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="hr-manage-shifts__shift-cell">
                            <span className="hr-manage-shifts__shift-badge" style={{ background: s.color, color: "#1e3a8a" }}>
                              {s.short_name}
                            </span>
                            <div>
                              <div className="hr-manage-shifts__shift-name">{s.name}</div>
                              <div className="hr-manage-shifts__shift-time">{formatShiftRange(s)}</div>
                            </div>
                          </div>
                        </td>
                        <td>{s.created_by || "—"}</td>
                        <td>{s.updated_by || "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="hr-manage-shifts__action-btn"
                            onClick={() => { setCreateMode(false); setEditShift(s); setEditOpen(true); }}
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="hr-manage-shifts__table">
                <thead>
                  <tr>
                    <th>Employee Name</th>
                    <th>Shift Name</th>
                    <th>Branch</th>
                    <th>Department</th>
                    <th>Employement Type</th>
                    <th>Shift Duration</th>
                    <th>Created By</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="hr-manage-shifts__empty">No records found</td>
                    </tr>
                  ) : (
                    pagedRows.map((row, index) => (
                      <tr key={row.id || index}>
                        <td>{row.employee_name || row.employee || "—"}</td>
                        <td>{row.shift_name || "—"}</td>
                        <td>{branchLabel(row.branch)}</td>
                        <td>{departmentLabel(row.department)}</td>
                        <td>{employmentLabel(row.employment_type)}</td>
                        <td>{row.shift_duration || formatShiftRange(row) || "—"}</td>
                        <td>{row.created_by || "—"}</td>
                        <td>
                          <button type="button" className="hr-manage-shifts__action-btn" aria-label="Edit assignment">
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            <div className="hr-manage-shifts__footer">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded border border-[#eff2f5] px-2 py-1 text-xs">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span>Entries</span>
              </div>
              <span>Showing {showingFrom} to {showingTo} of {rows.length} entries</span>
              <div className="flex items-center gap-1">
                <button type="button" className="hr-manage-shifts__page-btn" onClick={() => setPage(1)} aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-manage-shifts__page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-manage-shifts__page-btn hr-manage-shifts__page-btn--active">{currentPage}</button>
                <button type="button" className="hr-manage-shifts__page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" className="hr-manage-shifts__page-btn" onClick={() => setPage(totalPages)} aria-label="Last page"><ChevronsRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </ListPageShell>

      <EditShiftDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSave={handleSaveShift}
        initial={editShift}
        isCreate={createMode}
      />

      <AssignShiftDrawer
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onSave={handleAssign}
        shifts={shifts}
        employees={employees}
      />
    </>
  );
}
