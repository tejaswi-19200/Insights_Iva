import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Search,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { createLeaveRequest, getEmployeesEnriched, getLeaveEnriched, updateLeaveRequest } from "../../api/hrApi";
import { saveLocalLeave, updateLocalLeaveStatus, mergeLeavesWithLocal } from "../../utils/leaveStorage";
import "./leaveApprovals.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEMO_EMPLOYEES = [];
const SAMPLE_LEAVE_RECORDS = [];


const LEAVE_TYPE_FILTER_OPTIONS = [
  { value: "", label: "Leave Type" },
  { value: "casual", label: "Casual Leave" },
  { value: "comp_off", label: "Compensatory Off" },
  { value: "earned", label: "Earned Leave" },
  { value: "lwp", label: "Leave Without Pay" },
  { value: "maternity", label: "Maternity Leave" },
  { value: "paternity", label: "Paternity Leave" },
  { value: "sabbatical", label: "Sabbatical Leave" },
  { value: "sick", label: "Sick Leave" },
];

const LEAVE_TYPE_DRAWER_OPTIONS = LEAVE_TYPE_FILTER_OPTIONS.filter((o) => o.value);

const STATUS_OPTIONS = [
  { value: "", label: "Status" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const TABLE_COLUMNS = [
  "SR No.",
  "Employee",
  "Leave Type",
  "From",
  "To",
  "No Of Days",
  "Reason",
  "Attachment",
  "Created by",
  "Updated by",
  "Status",
  "Action",
];

function formatDisplayDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

function leaveTypeLabel(value) {
  if (!value) return "—";
  const match = LEAVE_TYPE_FILTER_OPTIONS.find((o) => o.value === value);
  if (match) return match.label;
  const byLabel = LEAVE_TYPE_FILTER_OPTIONS.find((o) => o.label.toLowerCase() === String(value).toLowerCase());
  return byLabel?.label || value;
}

function EmployeeFilterSelect({ value, onChange, employees }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const list = [{ value: "all", label: "All Employees" }];
    for (const emp of employees) {
      const id = emp.employee_id || emp.employee_code || String(emp.id);
      list.push({ value: id, label: emp.full_name || emp.name || "Employee" });
    }
    return list;
  }, [employees]);

  const selectedLabel = options.find((o) => o.value === value)?.label || "All Employees";

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
    <div ref={rootRef} className="relative">
      <button type="button" className="hr-leave-approvals__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-leave-approvals__select-menu">
          <div className="hr-leave-approvals__search-wrap">
            <SearchBar
              size="compact"
              value={query}
              onChange={setQuery}
              placeholder="Search Employee"
              inputRef={inputRef}
             
              aria-label="Search employees"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    className={`hr-leave-approvals__option ${active ? "hr-leave-approvals__option--employee-active" : ""}`}
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

function SimpleFilterSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabel = options.find((o) => o.value === value)?.label || options[0]?.label;

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
      <button type="button" className="hr-leave-approvals__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-leave-approvals__select-menu">
          <ul className="py-1">
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value || opt.label}>
                  <button
                    type="button"
                    className={`hr-leave-approvals__option ${active ? "hr-leave-approvals__option--filter-active" : ""}`}
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

function DrawerEmployeeSelect({ value, onChange, employees }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    return employees.map((emp) => ({
      value: emp.employee_id || emp.employee_code || String(emp.id),
      label: emp.full_name || emp.name || "Employee",
    }));
  }, [employees]);

  const selectedLabel = options.find((o) => o.value === value)?.label || "Select employee";

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
    <div ref={rootRef} className="relative">
      <button type="button" className="hr-leave-approvals__drawer-select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-leave-approvals__drawer-select-menu">
          <div className="hr-leave-approvals__search-wrap">
            <SearchBar
              size="compact"
              value={query}
              onChange={setQuery}
              placeholder="Search Employee"
              inputRef={inputRef}
             
              aria-label="Search employees"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  className={`hr-leave-approvals__drawer-select-option ${opt.value === value ? "hr-leave-approvals__drawer-select-option--active" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DrawerLeaveTypeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const label = LEAVE_TYPE_DRAWER_OPTIONS.find((o) => o.value === value)?.label || "Select leave type";

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
      <button type="button" className="hr-leave-approvals__drawer-select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{label}</span>
        <ChevronDown className="h-4 w-4 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-leave-approvals__drawer-select-menu">
          {LEAVE_TYPE_DRAWER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`hr-leave-approvals__drawer-select-option ${opt.value === value ? "hr-leave-approvals__drawer-select-option--active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div className="hr-leave-approvals__field">
      <label className="hr-leave-approvals__field-label">{label} <span>*</span></label>
      <div className="hr-leave-approvals__date-wrap">
        <span className={value ? "" : "is-placeholder"}>{value ? formatDisplayDate(value) : "dd-mmm-yyyy"}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-[#9ca3af]" />
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </div>
    </div>
  );
}

function LeaveRequestDrawer({ open, onClose, onSubmit, employees, defaultEmployeeId }) {
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId || employees[0]?.employee_id || employees[0]?.employee_code || String(employees[0]?.id || ""));
      setLeaveType("");
      setFromDate("");
      setToDate("");
      setReason("");
    }
  }, [open, defaultEmployeeId, employees]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const numDays = daysBetween(fromDate, toDate);

  const drawer = (
    <div className="hr-leave-approvals__overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Leave Request">
      <div className="hr-leave-approvals__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-leave-approvals__drawer-header">
          <svg className="hr-leave-approvals__drawer-waves" viewBox="0 0 120 48" fill="none" aria-hidden>
            <path d="M0 32C20 20 40 44 60 28C80 12 100 36 120 24V48H0V32Z" fill="rgba(255,255,255,0.6)" />
            <path d="M0 24C18 14 36 34 54 22C72 10 96 30 120 18V48H0V24Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          <button type="button" className="hr-leave-approvals__drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="hr-leave-approvals__drawer-body">
          <h2 className="hr-leave-approvals__drawer-title">Leave Request</h2>

          <div className="hr-leave-approvals__field">
            <label className="hr-leave-approvals__field-label">Employee Name <span>*</span></label>
            <DrawerEmployeeSelect value={employeeId} onChange={setEmployeeId} employees={employees} />
          </div>

          <div className="hr-leave-approvals__field">
            <label className="hr-leave-approvals__field-label">Leave Type <span>*</span></label>
            <DrawerLeaveTypeSelect value={leaveType} onChange={setLeaveType} />
          </div>

          <div className="hr-leave-approvals__two-col">
            <DateField label="From" value={fromDate} onChange={setFromDate} />
            <DateField label="To" value={toDate} onChange={setToDate} />
          </div>

          <div className="hr-leave-approvals__meta-row">
            <p>Number of days : {numDays}</p>
            <p>Remaining Leaves : 0</p>
          </div>

          <div className="hr-leave-approvals__field">
            <label className="hr-leave-approvals__field-label">Reason for taking leave <span>*</span></label>
            <textarea
              className="hr-leave-approvals__textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter Reason"
            />
          </div>

          <div className="hr-leave-approvals__field">
            <label className="hr-leave-approvals__field-label">Attachment</label>
            <label className="hr-leave-approvals__upload">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1d68d5] text-white text-lg leading-none">+</span>
              Upload Document
              <input type="file" className="hidden" />
            </label>
          </div>

          <button
            type="button"
            className="hr-leave-approvals__save-btn"
            onClick={() => onSubmit({ employeeId, leaveType, fromDate, toDate, reason, numDays })}
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

export default function LeaveApprovals() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState(DEMO_EMPLOYEES);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [pageSize, setPageSize] = useState(25);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [leaveTypeFilter, setLeaveTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [empRes, leaveRes] = await Promise.allSettled([getEmployeesEnriched(), getLeaveEnriched()]);
      const empList = empRes.status === "fulfilled" ? empRes.value?.data || [] : [];
      setEmployees(empList);
      const leaveData = leaveRes.status === "fulfilled" ? leaveRes.value?.data || [] : [];
      setRecords(mergeLeavesWithLocal(leaveData));
    } catch {
      setEmployees([]);
      setRecords(mergeLeavesWithLocal([]));
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  // Sync across tabs/pages when leave status is updated anywhere
  useEffect(() => {
    const handleLeaveUpdate = () => {
      setRecords((prev) => mergeLeavesWithLocal(prev));
    };
    window.addEventListener("leave-updated", handleLeaveUpdate);
    return () => window.removeEventListener("leave-updated", handleLeaveUpdate);
  }, []);

  const filteredRecords = useMemo(() => {
    return (records || []).filter((row) => {
      if (employeeFilter !== "all") {
        const id = row.employee_id || row.employee_code;
        const name = row.employee_name || row.employee;
        const matchEmp = employees.find(
          (e) => (e.employee_id || e.employee_code || String(e.id)) === employeeFilter
        );
        const matchName = matchEmp?.full_name || matchEmp?.name;
        if (id !== employeeFilter && name !== matchName) return false;
      }

      if (leaveTypeFilter) {
        const type = String(row.leave_type || row.type || "").toLowerCase();
        const label = leaveTypeLabel(leaveTypeFilter).toLowerCase();
        if (type !== leaveTypeFilter && type !== label) return false;
      }

      if (statusFilter) {
        const st = String(row.status || "").toLowerCase();
        if (st !== statusFilter) return false;
      }

      const start = row.start_date || row.from;
      if (start) {
        const d = new Date(start);
        if (!Number.isNaN(d.getTime()) && (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth)) {
          return false;
        }
      }

      return true;
    });
  }, [records, employeeFilter, leaveTypeFilter, statusFilter, viewYear, viewMonth, employees]);

  const shiftMonth = (delta) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const defaultDrawerEmployee = employeeFilter !== "all" ? employeeFilter : "";

  const handleApprove = async (row) => {
    const rowId = row.id;
    // 1. Immediately update local state
    setRecords((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, status: "approved", updated_by: "Admin" } : r))
    );
    // 2. Persist to shared localStorage so navigating or refreshing retains approved state
    updateLocalLeaveStatus(rowId, "approved", "Admin");

    // 3. Sync to backend API if applicable
    try {
      const numericId = parseInt(String(rowId).replace(/\D/g, ""), 10);
      if (numericId && !String(rowId).startsWith("sample-")) {
        await updateLeaveRequest(numericId, { status: "approved" });
      }
      addToast(`Leave request for ${row.employee_name || row.employee || "employee"} approved`, "success");
    } catch {
      addToast(`Leave request approved`, "success");
    }
  };

  const handleReject = async (row) => {
    const rowId = row.id;
    // 1. Immediately update local state
    setRecords((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, status: "rejected", updated_by: "Admin" } : r))
    );
    // 2. Persist to shared localStorage
    updateLocalLeaveStatus(rowId, "rejected", "Admin");

    // 3. Sync to backend API if applicable
    try {
      const numericId = parseInt(String(rowId).replace(/\D/g, ""), 10);
      if (numericId && !String(rowId).startsWith("sample-")) {
        await updateLeaveRequest(numericId, { status: "rejected" });
      }
      addToast(`Leave request for ${row.employee_name || row.employee || "employee"} rejected`, "info");
    } catch {
      addToast(`Leave request rejected`, "info");
    }
  };

  const handleSave = async (payload) => {
    if (!payload.employeeId || !payload.leaveType || !payload.fromDate || !payload.toDate || !payload.reason.trim()) {
      addToast("Please fill all required fields", "warning");
      return;
    }
    const matchedEmp = employees.find(
      (e) => (e.employee_id || e.employee_code || String(e.id)) === payload.employeeId
    );
    const newRecord = {
      id: `local_${Date.now()}`,
      employee_id: payload.employeeId,
      employee_name: matchedEmp?.full_name || matchedEmp?.name || payload.employeeId,
      leave_type: payload.leaveType,
      start_date: payload.fromDate,
      end_date: payload.toDate,
      days: payload.numDays,
      reason: payload.reason.trim(),
      status: "pending",
      created_by: "Admin",
      updated_by: "—",
      attachment: false,
    };
    saveLocalLeave(newRecord);
    setRecords((prev) => [newRecord, ...prev]);
    setRequestOpen(false);
    try {
      const numericId = parseInt(String(payload.employeeId).replace(/\D/g, ""), 10) || 1;
      await createLeaveRequest({
        employee_id: numericId,
        leave_type: payload.leaveType,
        start_date: payload.fromDate,
        end_date: payload.toDate,
        reason: payload.reason.trim(),
        status: "pending",
      });
      addToast("Leave request saved", "success");
      load(true);
    } catch {
      addToast("Leave request saved locally", "success");
    }
  };

  if (loading) return <Loader label="Loading leave approvals..." />;

  return (
    <>
      <ListPageShell>
        <div className="hr-leave-approvals min-w-0">
          <div className="hr-leave-approvals__header">
            <h1 className="hr-leave-approvals__title">Leave Approvals</h1>
            <div className="flex items-center justify-center gap-2">
              <button type="button" className="hr-leave-approvals__nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="hr-leave-approvals__period">{MONTHS[viewMonth]} {viewYear}</span>
              <button type="button" className="hr-leave-approvals__nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <span />
          </div>

          <div className="hr-leave-approvals__toolbar">
            <div className="hr-leave-approvals__filters">
              <EmployeeFilterSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} />
              <SimpleFilterSelect value={leaveTypeFilter} onChange={setLeaveTypeFilter} options={LEAVE_TYPE_FILTER_OPTIONS} />
              <SimpleFilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
            </div>
            <button type="button" className="hr-leave-approvals__request-btn" onClick={() => setRequestOpen(true)}>
              <Plus className="h-4 w-4" />
              Leave Request
            </button>
          </div>

          <div className="hr-leave-approvals__table-wrap">
            <div className="hr-leave-approvals__table-scroll">
              <table className="hr-leave-approvals__table">
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((col) => (
                      <th key={col}>
                        {col}
                        {col === "SR No." ? <ChevronDown className="ml-1 inline h-3 w-3" /> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={TABLE_COLUMNS.length} className="hr-leave-approvals__empty">No records found</td>
                    </tr>
                  ) : (
                    filteredRecords.map((row, index) => {
                      const status = String(row.status || "").toLowerCase();
                      return (
                        <tr key={row.id || index}>
                          <td>{index + 1}</td>
                          <td className="font-semibold text-[#1e293b]">{row.employee_name || row.employee || "—"}</td>
                          <td>{leaveTypeLabel(row.leave_type || row.type)}</td>
                          <td>{formatDisplayDate(row.start_date || row.from)}</td>
                          <td>{formatDisplayDate(row.end_date || row.to)}</td>
                          <td>{row.days || row.no_of_days || daysBetween(row.start_date, row.end_date)}</td>
                          <td>{row.reason || "—"}</td>
                          <td>{row.attachment ? "Yes" : "—"}</td>
                          <td>{row.created_by || "—"}</td>
                          <td>{row.updated_by || "—"}</td>
                          <td>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                status === "approved"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : status === "rejected"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {status ? status.charAt(0).toUpperCase() + status.slice(1) : "Pending"}
                            </span>
                          </td>
                          <td>
                            {status === "pending" || !status ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white transition hover:bg-emerald-700"
                                  onClick={() => handleApprove(row)}
                                  title="Approve"
                                  aria-label={`Approve leave for ${row.employee_name || "employee"}`}
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-600 text-white transition hover:bg-rose-700"
                                  onClick={() => handleReject(row)}
                                  title="Reject"
                                  aria-label={`Reject leave for ${row.employee_name || "employee"}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">Completed</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="hr-leave-approvals__footer">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border border-[#eff2f5] px-2 py-1 text-xs"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span>Entries</span>
              </div>
              <span>
                Showing {filteredRecords.length ? 1 : 0} to {filteredRecords.length} of {filteredRecords.length} entries
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className="hr-leave-approvals__page-btn" aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-leave-approvals__page-btn" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-leave-approvals__page-btn" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" className="hr-leave-approvals__page-btn" aria-label="Last page"><ChevronsRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </ListPageShell>

      <LeaveRequestDrawer
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onSubmit={handleSave}
        employees={employees}
        defaultEmployeeId={defaultDrawerEmployee}
      />
    </>
  );
}
