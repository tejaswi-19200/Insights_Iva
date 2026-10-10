import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { getEmployeesEnriched } from "../../api/hrApi";
import "./attendanceApproval.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_OPTIONS = [
  { value: "", label: "Status" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const DEMO_EMPLOYEE = { id: "demo", employee_id: "G1234", full_name: "Satish Gogulothu", name: "Satish Gogulothu" };

function formatDayLabel(year, month, day) {
  return `${String(day).padStart(2, "0")} ${MONTHS[month]}`;
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
    <div ref={rootRef} className="relative w-[180px] shrink-0">
      <button type="button" className="hr-approvals__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-approvals__select-menu">
          <div className="hr-approvals__search-wrap">
            <label className="hr-approvals__search-input">
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
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    className={`hr-approvals__option ${active ? "hr-approvals__option--employee-active" : ""}`}
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
    <div ref={rootRef} className="relative w-[130px] shrink-0">
      <button type="button" className="hr-approvals__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-approvals__select-menu">
          <ul className="py-1">
            {STATUS_OPTIONS.map((opt) => {
              const active = opt.value === value;
              return (
                <li key={opt.value || "all-status"}>
                  <button
                    type="button"
                    className={`hr-approvals__option ${active ? "hr-approvals__option--status-active" : ""}`}
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

export default function AttendanceApproval() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [periodView, setPeriodView] = useState("month");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const empRes = await getEmployeesEnriched();
      const empList = empRes?.data || [];
      setEmployees(empList);

      const sampleRecords = empList.slice(0, 5).map((emp, idx) => {
        const empName = emp.full_name || emp.name || "Employee";
        const empId = emp.employee_id || emp.employee_code || `EMP-${idx + 1}`;
        return {
          id: `appr-${idx + 1}`,
          employee_id: empId,
          employee_name: empName,
          name: empName,
          attendance_day: `${String(idx + 1).padStart(2, "0")}-Sep-2026`,
          check_in_old: "09:30 AM",
          check_in_new: "09:00 AM",
          check_out_old: "06:00 PM",
          check_out_new: "06:30 PM",
          hours_old: "8.50",
          hours_new: "9.50",
          status_old: "Late",
          status_new: "Present",
          reason: idx % 2 === 0 ? "Biometric machine delay" : "Official client visit",
          created_by: empName,
          approval_status: idx === 0 ? "Pending" : idx === 1 ? "Pending" : idx === 2 ? "Approved" : "Pending",
        };
      });

      setRecords([]);
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
        const st = String(row.approval_status || row.status || "").toLowerCase();
        if (st !== statusFilter) return false;
      }
      return true;
    });
  }, [records, employeeFilter, statusFilter]);

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
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map((r) => r.id));
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleApprove = () => {
    if (!selectedIds.length) {
      addToast("Select at least one record to approve", "warning");
      return;
    }
    const count = selectedIds.length;
    setRecords((prev) =>
      prev.map((r) => (selectedIds.includes(r.id) ? { ...r, approval_status: "Approved", status_old: r.status_new } : r))
    );
    addToast(`${count} attendance record${count === 1 ? "" : "s"} approved successfully`, "success");
    setSelectedIds([]);
  };

  if (loading) return <Loader label="Loading approvals..." />;

  return (
    <ListPageShell>
      <div className="hr-approvals min-w-0 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="hr-approvals__title">Approvals</h1>
          <button
            type="button"
            className="hr-approvals__approve-btn shrink-0"
            onClick={handleApprove}
            disabled={!selectedIds.length}
          >
            Click Here To Approve
          </button>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white px-5 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 shrink-0">
              <EmployeeFilterSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} />
              <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} />
            </div>

            <div className="flex items-center justify-center gap-2 shrink-0">
              <button type="button" className="hr-approvals__nav-btn" onClick={() => shiftPeriod(-1)} aria-label="Previous period">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="hr-approvals__period-label min-w-[85px] text-center font-bold text-slate-800 dark:text-slate-100">{periodLabel}</span>
              <button type="button" className="hr-approvals__nav-btn" onClick={() => shiftPeriod(1)} aria-label="Next period">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center justify-end shrink-0">
              <div className="hr-approvals__view-toggle">
                <button
                  type="button"
                  className={`hr-approvals__view-btn ${periodView === "week" ? "hr-approvals__view-btn--active" : ""}`}
                  onClick={() => setPeriodView("week")}
                >
                  <CalendarDays className="h-4 w-4" />
                  Week View
                </button>
                <button
                  type="button"
                  className={`hr-approvals__view-btn ${periodView === "month" ? "hr-approvals__view-btn--active" : ""}`}
                  onClick={() => setPeriodView("month")}
                >
                  <CalendarDays className="h-4 w-4" />
                  Month View
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hr-approvals__table-wrap">
          <table className="hr-approvals__table">
            <thead>
              <tr>
                <th rowSpan={2} className="w-10">
                  <input
                    type="checkbox"
                    className="hr-approvals__checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={!filteredRecords.length}
                    aria-label="Select all"
                  />
                </th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">SR No.</th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">Employee</th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">Attendance day</th>
                <th colSpan={2}>Check-in</th>
                <th colSpan={2}>Check-out</th>
                <th colSpan={2}>Hour(s)</th>
                <th colSpan={2}>Status</th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">Reason</th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">Created By</th>
                <th rowSpan={2} className="hr-approvals__th-left whitespace-nowrap">Approval Status</th>
              </tr>
              <tr>
                <th>Old</th>
                <th>New</th>
                <th>Old</th>
                <th>New</th>
                <th>Old</th>
                <th>New</th>
                <th>Old</th>
                <th>New</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={15} className="hr-approvals__empty">No records found</td>
                </tr>
              ) : (
                filteredRecords.map((row, index) => (
                  <tr key={row.id}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="hr-approvals__checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select row ${index + 1}`}
                      />
                    </td>
                    <td>{index + 1}</td>
                    <td>{row.employee_name || row.name || "—"}</td>
                    <td>{row.attendance_day || row.record_date || "—"}</td>
                    <td className="text-center">{row.check_in_old || "—"}</td>
                    <td className="text-center">{row.check_in_new || "—"}</td>
                    <td className="text-center">{row.check_out_old || "—"}</td>
                    <td className="text-center">{row.check_out_new || "—"}</td>
                    <td className="text-center">{row.hours_old || "—"}</td>
                    <td className="text-center">{row.hours_new || "—"}</td>
                    <td className="text-center">{row.status_old || "—"}</td>
                    <td className="text-center">{row.status_new || "—"}</td>
                    <td>{row.reason || "—"}</td>
                    <td>{row.created_by || "—"}</td>
                    <td>{row.approval_status || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ListPageShell>
  );
}
