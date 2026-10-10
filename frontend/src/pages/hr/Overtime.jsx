import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  Monitor,
  Search,
  User,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { getEmployeesEnriched } from "../../api/hrApi";
import "./overtime.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_OPTIONS = [
  { value: "", label: "Status" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const REASON_OPTIONS = [
  { value: "", label: "Select Reason" },
  { value: "extra_work", label: "Extra work" },
  { value: "forgot_start", label: "Forgot to start" },
  { value: "forgot_end", label: "Forgot to end" },
  { value: "official_visit", label: "On official visit" },
  { value: "weekly_off_swap", label: "Weekly-off swap" },
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

const DEMO_EMPLOYEE = { id: "demo", employee_id: "G1234", full_name: "Satish Gogulothu", name: "Satish Gogulothu" };

function formatDayLabel(year, month, day) {
  return `${String(day).padStart(2, "0")} ${MONTHS[month]}`;
}

function formatDisplayDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function getWeekStart(date) {
  const start = new Date(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatWeekRange(anchor) {
  const start = getWeekStart(anchor);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatDayLabel(start.getFullYear(), start.getMonth(), start.getDate())} - ${formatDayLabel(end.getFullYear(), end.getMonth(), end.getDate())}`;
}

function parseTimeToMinutes(hh, mm, ampm) {
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  let hours = h % 12;
  if (ampm === "PM") hours += 12;
  return hours * 60 + m;
}

function calcTotalHours(checkIn, checkOut) {
  const inMin = parseTimeToMinutes(checkIn.hh, checkIn.mm, checkIn.ampm);
  const outMin = parseTimeToMinutes(checkOut.hh, checkOut.mm, checkOut.ampm);
  if (inMin == null || outMin == null || outMin <= inMin) return "0.00";
  return ((outMin - inMin) / 60).toFixed(2);
}

function EmployeeFilterSelect({ value, onChange, employees, includeAll = true, fullWidth = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const list = includeAll ? [{ value: "all", label: "All Employees" }] : [];
    for (const emp of employees) {
      const id = emp.employee_id || emp.employee_code || String(emp.id);
      list.push({ value: id, label: emp.full_name || emp.name || "Employee" });
    }
    return list;
  }, [employees, includeAll]);

  const selectedLabel = options.find((o) => o.value === value)?.label || (includeAll ? "All Employees" : "Select employee");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative ${fullWidth ? "w-full" : "w-[170px] shrink-0"}`}
    >
      <button type="button" className="hr-overtime__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-overtime__select-menu">
          {includeAll ? (
            <div className="hr-overtime__search-wrap">
              <label className="hr-overtime__search-input">
                <Search className="h-4 w-4 shrink-0 text-[#9ca3af]" aria-hidden />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Employee"
                />
              </label>
            </div>
          ) : null}
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value || "empty"}>
                  <button
                    type="button"
                    className={`hr-overtime__option ${active ? "hr-overtime__option--employee-active" : ""}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StatusFilterSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabel = STATUS_OPTIONS.find((o) => o.value === value)?.label || "Status";

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-[125px] shrink-0">
      <button type="button" className="hr-overtime__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-overtime__select-menu">
          <ul className="py-1">
            {STATUS_OPTIONS.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value || "status-all"}>
                  <button
                    type="button"
                    className={`hr-overtime__option ${active ? "hr-overtime__option--status-active" : ""}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SimpleSelect({ value, onChange, options, placeholder, activeClass = "hr-overtime__option--reason-active" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;

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
      <button type="button" className="hr-overtime__form-select w-full" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-overtime__select-menu">
          <ul className="py-1">
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value || "opt-empty"}>
                  <button
                    type="button"
                    className={`hr-overtime__option ${active ? activeClass : ""}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DatePickerField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => (value ? new Date(value).getFullYear() : new Date().getFullYear()));
  const [viewMonth, setViewMonth] = useState(() => (value ? new Date(value).getMonth() : new Date().getMonth()));
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const selectedDate = value ? new Date(value) : null;

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="hr-overtime__form-select w-full" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>
          {value ? formatDisplayDate(value) : "dd-mmm-yyyy"}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-overtime__calendar">
          <div className="hr-overtime__calendar-nav">
            <button type="button" className="hr-overtime__nav-btn" onClick={() => {
              const m = viewMonth - 1;
              if (m < 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth(m);
            }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#1e293b]">
              <span>{MONTHS[viewMonth]}</span>
              <span>{viewYear}</span>
            </div>
            <button type="button" className="hr-overtime__nav-btn" onClick={() => {
              const m = viewMonth + 1;
              if (m > 11) { setViewMonth(0); setViewYear((y) => y + 1); } else setViewMonth(m);
            }}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="hr-overtime__calendar-grid">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
              <div key={d} className="hr-overtime__calendar-weekday">{d}</div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <span key={`pad-${i}`} />;
              const isSelected =
                selectedDate &&
                selectedDate.getDate() === day &&
                selectedDate.getMonth() === viewMonth &&
                selectedDate.getFullYear() === viewYear;
              return (
                <button
                  key={day}
                  type="button"
                  className={isSelected ? "is-selected" : ""}
                  onClick={() => {
                    onChange(new Date(viewYear, viewMonth, day));
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeField({ label, value, onChange }) {
  const toggleAmPm = () => {
    onChange({ ...value, ampm: value.ampm === "AM" ? "PM" : "AM" });
  };

  return (
    <div className="hr-overtime__time-group">
      <label>{label} <span className="text-[#ef4444]">*</span></label>
      <div className="hr-overtime__time-inputs">
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          placeholder="HH"
          value={value.hh}
          onChange={(e) => onChange({ ...value, hh: e.target.value.replace(/\D/g, "").slice(0, 2) })}
          className="hr-overtime__time-box"
        />
        <span>:</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          placeholder="MM"
          value={value.mm}
          onChange={(e) => onChange({ ...value, mm: e.target.value.replace(/\D/g, "").slice(0, 2) })}
          className="hr-overtime__time-box"
        />
        <button type="button" className="hr-overtime__ampm" onClick={toggleAmPm}>
          {value.ampm}
        </button>
      </div>
    </div>
  );
}

function OvertimeRequestModal({ open, onClose, employees, onSubmit }) {
  const defaultEmployeeId = employees[0]?.employee_id || employees[0]?.employee_code || String(employees[0]?.id) || "";
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [overtimeDate, setOvertimeDate] = useState(null);
  const [checkIn, setCheckIn] = useState({ hh: "", mm: "", ampm: "AM" });
  const [checkOut, setCheckOut] = useState({ hh: "", mm: "", ampm: "AM" });
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId);
      setOvertimeDate(null);
      setCheckIn({ hh: "", mm: "", ampm: "AM" });
      setCheckOut({ hh: "", mm: "", ampm: "AM" });
      setReason("");
    }
  }, [open, defaultEmployeeId]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const totalHours = calcTotalHours(checkIn, checkOut);

  const handleSubmit = (mode) => {
    onSubmit({
      mode,
      employeeId,
      overtimeDate,
      checkIn,
      checkOut,
      reason,
      totalHours,
    });
    onClose();
  };

  return createPortal(
    <div
      className="hr-overtime__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Overtime Request"
      onClick={onClose}
    >
      <div className="hr-overtime__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-overtime__drawer-header">
          <svg className="hr-overtime__drawer-waves" viewBox="0 0 120 48" fill="none" aria-hidden>
            <path d="M0 32C20 20 40 44 60 28C80 12 100 36 120 24V48H0V32Z" fill="rgba(255,255,255,0.6)" />
            <path d="M0 24C18 14 36 34 54 22C72 10 96 30 120 18V48H0V24Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          <button type="button" className="hr-overtime__modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="hr-overtime__drawer-body">
          <div className="hr-overtime__drawer-form">
            <h2 className="hr-overtime__modal-title">Overtime Request</h2>

            <div className="hr-overtime__field">
              <label className="hr-overtime__field-label">Employee Name <span>*</span></label>
              <EmployeeFilterSelect
                value={employeeId}
                onChange={setEmployeeId}
                employees={employees}
                includeAll={false}
                fullWidth
              />
            </div>

            <div className="hr-overtime__field">
              <label className="hr-overtime__field-label">Overtime Date <span>*</span></label>
              <DatePickerField value={overtimeDate} onChange={setOvertimeDate} />
            </div>

            <div className="hr-overtime__time-row">
              <TimeField label="Check-In" value={checkIn} onChange={setCheckIn} />
              <TimeField label="Check-Out" value={checkOut} onChange={setCheckOut} />
            </div>

            <p className="hr-overtime__total-hours">Total Hours : {totalHours}</p>

            <div className="hr-overtime__field">
              <label className="hr-overtime__field-label">Reason <span>*</span></label>
              <SimpleSelect value={reason} onChange={setReason} options={REASON_OPTIONS} placeholder="Select Reason" />
            </div>
          </div>

          <div className="hr-overtime__modal-actions">
            <button type="button" className="hr-overtime__primary-btn" onClick={() => handleSubmit("regularize")}>
              Regularize Overtime
            </button>
            <button type="button" className="hr-overtime__primary-btn" onClick={() => handleSubmit("request")}>
              Send Request
            </button>
          </div>
        </div>
      </div>
    </div>,
    (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body
  );
}

function FilterPopover({ open, onClose, branch, department, onBranchChange, onDepartmentChange, onApply, onClear }) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="hr-overtime__filter-popover">
      <div className="hr-overtime__filter-popover-header">
        <h3>Filter</h3>
        <button type="button" className="hr-overtime__modal-close" onClick={onClose} aria-label="Close filter">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-overtime__filter-popover-body">
        <div className="hr-overtime__field">
          <label className="hr-overtime__field-label">Branch</label>
          <SimpleSelect value={branch} onChange={onBranchChange} options={BRANCH_OPTIONS} placeholder="Select Branch" />
        </div>
        <div className="hr-overtime__field">
          <label className="hr-overtime__field-label">Department</label>
          <SimpleSelect value={department} onChange={onDepartmentChange} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
        </div>
      </div>
      <div className="hr-overtime__filter-popover-footer">
        <button
          type="button"
          className="hr-overtime__outline-btn"
          onClick={() => {
            if (onClear) onClear();
            else {
              onBranchChange("");
              onDepartmentChange("");
              onClose();
            }
          }}
        >
          Clear
        </button>
        <button type="button" className="hr-overtime__primary-btn" onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

export default function Overtime() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [periodView, setPeriodView] = useState("month");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [requestOpen, setRequestOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterBtnRef = useRef(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const empRes = await getEmployeesEnriched();
      const empList = empRes?.data || [];
      setEmployees(empList);

      const sampleOt = empList.slice(0, 4).map((emp, idx) => {
        const empName = emp.full_name || emp.name || "Employee";
        const empId = emp.employee_id || emp.employee_code || `EMP-${idx + 1}`;
        return {
          id: `ot-${idx + 1}`,
          employee_id: empId,
          employee_name: empName,
          name: empName,
          overtime_date: `${String(idx + 1).padStart(2, "0")}-Sep-2026`,
          check_in: "06:00 PM",
          check_out: idx % 2 === 0 ? "08:30 PM" : "09:00 PM",
          total_hours: idx % 2 === 0 ? "2.50" : "3.00",
          reason: idx % 2 === 0 ? "Extra work on production line" : "Urgent machine maintenance",
          branch: "hq",
          department: "production",
          approval_status: idx === 0 ? "Pending" : idx === 1 ? "Approved" : "Pending",
        };
      });

      setRecords(empList.length ? sampleOt : []);
      setSelectedRowId(empList.length ? sampleOt[0]?.id : null);
      setSelectedIds([]);
    } catch {
      setEmployees([]);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const filteredRecords = useMemo(() => {
    return (records || []).filter((row) => {
      if (employeeFilter !== "all") {
        const id = row.employee_id || row.employee_code;
        if (id !== employeeFilter && row.employee_name !== employeeFilter) return false;
      }
      if (statusFilter) {
        const st = String(row.approval_status || "").toLowerCase();
        if (st !== statusFilter) return false;
      }
      if (branchFilter && row.branch !== branchFilter) return false;
      if (departmentFilter && row.department !== departmentFilter) return false;
      return true;
    });
  }, [records, employeeFilter, statusFilter, branchFilter, departmentFilter]);

  const selectedRecord = filteredRecords.find((r) => r.id === selectedRowId) || null;

  const periodLabel =
    periodView === "week" ? formatWeekRange(weekAnchor) : `${MONTHS[viewMonth]} ${viewYear}`;

  const shiftPeriod = (delta) => {
    if (periodView === "week") {
      const next = new Date(weekAnchor);
      next.setDate(next.getDate() + delta * 7);
      setWeekAnchor(next);
      setViewYear(next.getFullYear());
      setViewMonth(next.getMonth());
      return;
    }
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setWeekAnchor(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const allSelected = filteredRecords.length > 0 && selectedIds.length === filteredRecords.length;

  const toggleAll = () => {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(filteredRecords.map((r) => r.id));
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleApproveReject = () => {
    if (!selectedIds.length) {
      addToast("Select at least one record to approve or reject", "warning");
      return;
    }
    const count = selectedIds.length;
    setRecords((prev) =>
      prev.map((r) => (selectedIds.includes(r.id) ? { ...r, approval_status: "Approved" } : r))
    );
    addToast(`${count} overtime request${count === 1 ? "" : "s"} approved successfully`, "success");
    setSelectedIds([]);
  };

  const handleRequestSubmit = (payload) => {
    const selectedEmp = employees.find(
      (e) => (e.employee_id || e.employee_code || String(e.id)) === payload.employeeId
    );
    const empName = selectedEmp?.full_name || selectedEmp?.name || "Employee";
    const dateStr = payload.overtimeDate ? formatDisplayDate(payload.overtimeDate) : "Today";
    const inTime = payload.checkIn.hh ? `${payload.checkIn.hh}:${payload.checkIn.mm || "00"} ${payload.checkIn.ampm}` : "—";
    const outTime = payload.checkOut.hh ? `${payload.checkOut.hh}:${payload.checkOut.mm || "00"} ${payload.checkOut.ampm}` : "—";

    const newRecord = {
      id: `ot-new-${Date.now()}`,
      employee_id: payload.employeeId,
      employee_name: empName,
      name: empName,
      overtime_date: dateStr,
      check_in: inTime,
      check_out: outTime,
      total_hours: payload.totalHours || "0.00",
      reason: payload.reason || "Extra work",
      branch: "hq",
      department: "production",
      approval_status: payload.mode === "regularize" ? "Approved" : "Pending",
    };

    setRecords((prev) => [newRecord, ...prev]);
    setSelectedRowId(newRecord.id);

    addToast(
      payload.mode === "regularize" ? "Overtime regularized and recorded" : "Overtime request submitted successfully",
      "success"
    );
  };

  if (loading) return <Loader label="Loading overtime..." />;

  return (
    <ListPageShell>
      <div className="hr-overtime min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="hr-overtime__title">Overtime</h1>
          <div className="hr-overtime__view-toggle shrink-0 self-start sm:self-auto">
            <button
              type="button"
              className={`hr-overtime__view-btn ${periodView === "week" ? "hr-overtime__view-btn--active" : ""}`}
              onClick={() => setPeriodView("week")}
            >
              <CalendarDays className="h-4 w-4" />
              Week View
            </button>
            <button
              type="button"
              className={`hr-overtime__view-btn ${periodView === "month" ? "hr-overtime__view-btn--active" : ""}`}
              onClick={() => setPeriodView("month")}
            >
              <CalendarDays className="h-4 w-4" />
              Month View
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white px-5 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 shrink-0">
              <EmployeeFilterSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} />
              <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} />
            </div>

            <div className="flex items-center justify-center gap-2 shrink-0">
              <button type="button" className="hr-overtime__nav-btn" onClick={() => shiftPeriod(-1)} aria-label="Previous period">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="hr-overtime__period-label min-w-[85px] text-center font-bold text-slate-800 dark:text-slate-100">{periodLabel}</span>
              <button type="button" className="hr-overtime__nav-btn" onClick={() => shiftPeriod(1)} aria-label="Next period">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button type="button" className="hr-overtime__icon-btn" onClick={() => load(true)} aria-label="Refresh">
                <History className="h-5 w-5" />
              </button>
              <button type="button" className="hr-overtime__outline-btn" onClick={handleApproveReject}>
                Click To Approve / Reject
              </button>
              <button type="button" className="hr-overtime__primary-btn" onClick={() => setRequestOpen(true)}>
                Overtime Request
              </button>
              <div className="relative">
                <button
                  ref={filterBtnRef}
                  type="button"
                  className={`hr-overtime__filter-btn ${filterOpen ? "hr-overtime__filter-btn--active" : ""}`}
                  onClick={() => setFilterOpen((v) => !v)}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                </button>
                <FilterPopover
                  open={filterOpen}
                  onClose={() => setFilterOpen(false)}
                  branch={branchFilter}
                  department={departmentFilter}
                  onBranchChange={setBranchFilter}
                  onDepartmentChange={setDepartmentFilter}
                  onClear={() => {
                    setBranchFilter("");
                    setDepartmentFilter("");
                    setFilterOpen(false);
                    addToast("Filters cleared", "info");
                  }}
                  onApply={() => {
                    setFilterOpen(false);
                    addToast("Filters applied", "success");
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="hr-overtime__panel min-w-0">
            <div className="overflow-x-auto">
              <table className="hr-overtime__table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="hr-overtime__checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        disabled={!filteredRecords.length}
                        aria-label="Select all"
                      />
                    </th>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Total Hours</th>
                    <th>Approval Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="hr-overtime__empty">No Data Found</td>
                    </tr>
                  ) : (
                    filteredRecords.map((row) => (
                      <tr
                        key={row.id}
                        className={selectedRowId === row.id ? "hr-overtime__row--selected cursor-pointer" : "cursor-pointer"}
                        onClick={() => setSelectedRowId(row.id)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="hr-overtime__checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleRow(row.id)}
                            aria-label={`Select ${row.employee_name}`}
                          />
                        </td>
                        <td>{row.employee_name || row.name}</td>
                        <td>{row.date || row.record_date}</td>
                        <td>{row.total_hours}</td>
                        <td>{row.approval_status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hr-overtime__panel min-w-0">
            {selectedRecord ? (
              <div className="p-5">
                <h3 className="mb-3 text-base font-semibold text-[#1e293b]">{selectedRecord.employee_name || selectedRecord.name}</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[#6b7280]">Date</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.date || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6b7280]">Total Hours</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.total_hours || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6b7280]">Check-In</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.check_in || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6b7280]">Check-Out</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.check_out || "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[#6b7280]">Reason</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.reason || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6b7280]">Approval Status</dt>
                    <dd className="font-medium text-[#374151]">{selectedRecord.approval_status || "—"}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="hr-overtime__detail-empty">
                <div className="relative grid h-24 w-24 place-items-center rounded-lg border border-[#e5e7eb] bg-[#f8fafc]">
                  <Monitor className="h-10 w-10 text-[#94a3b8]" strokeWidth={1.5} />
                  <User className="absolute bottom-3 h-5 w-5 text-[#64748b]" strokeWidth={1.5} />
                </div>
                <p>No Employee Selected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <OvertimeRequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        employees={employees}
        onSubmit={handleRequestSubmit}
      />
    </ListPageShell>
  );
}
