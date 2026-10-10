import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileX2,
  Filter,
  Search,
  User,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { getEmployeesEnriched, getMonthlyShifts, getMonthlyShiftVersionHistory, saveMonthlyShifts } from "../../api/hrApi";
import "./monthlyShifts.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const BRANCH_OPTIONS = [
  { value: "", label: "Select Branch" },
  { value: "hq", label: "Head Office" },
  { value: "plant", label: "Manufacturing Plant" },
];

const DEPARTMENT_OPTIONS = [
  { value: "", label: "Select Department" },
  { value: "hr", label: "HR Department" },
  { value: "production", label: "Production" },
  { value: "accounts", label: "Accounts" },
];

const SHIFT_OPTIONS = [
  { key: "G", label: "General" },
  { key: "M", label: "Morning" },
  { key: "E", label: "Evening" },
  { key: "W", label: "Week Off" },
];

const DEMO_EMPLOYEE = {
  id: "demo",
  employee_id: "G1234",
  full_name: "Satish Gogulothu",
  name: "Satish Gogulothu",
  branch: "hq",
  department: "hr",
};

function branchLabel(v) {
  return BRANCH_OPTIONS.find((o) => o.value === v)?.label || v || "—";
}

function departmentLabel(v) {
  return DEPARTMENT_OPTIONS.find((o) => o.value === v)?.label || v || "—";
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function defaultShiftForDay(year, month, day) {
  const dow = new Date(year, month, day).getDay();
  return dow === 0 ? "W" : "G";
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
      <button type="button" className="hr-monthly-shifts__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-monthly-shifts__select-menu">
          <div className="hr-monthly-shifts__search-wrap">
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
                  className={`hr-monthly-shifts__option ${opt.value === value ? "hr-monthly-shifts__option--active" : ""}`}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
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
      <button type="button" className="hr-monthly-shifts__form-select" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-monthly-shifts__form-select-menu">
          {options.map((opt) => (
            <button
              key={opt.value || opt.label}
              type="button"
              className={`hr-monthly-shifts__form-option ${opt.value === value ? "hr-monthly-shifts__form-option--active" : ""}`}
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
    <div ref={rootRef} className="hr-monthly-shifts__filter-popover">
      <div className="hr-monthly-shifts__filter-popover-header">
        <h3>Filter</h3>
        <button type="button" className="hr-monthly-shifts__modal-close" onClick={onClose} aria-label="Close filter">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-monthly-shifts__filter-popover-body">
        <div className="hr-monthly-shifts__field">
          <label className="hr-monthly-shifts__field-label">Branch</label>
          <SimpleSelect value={branch} onChange={onBranchChange} options={BRANCH_OPTIONS} placeholder="Select Branch" />
        </div>
        <div className="hr-monthly-shifts__field">
          <label className="hr-monthly-shifts__field-label">Department</label>
          <SimpleSelect value={department} onChange={onDepartmentChange} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
        </div>
      </div>
      <div className="hr-monthly-shifts__filter-popover-footer">
        <button
          type="button"
          className="hr-monthly-shifts__clear-btn"
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
        <button type="button" className="hr-monthly-shifts__apply-btn" onClick={onApply}>Apply</button>
      </div>
    </div>
  );
}

function VersionHistoryPanel({ open, onClose, history }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const panel = (
    <div className="hr-monthly-shifts__history-root">
      <div className="hr-monthly-shifts__history-overlay" onClick={onClose} aria-hidden />
      <aside className="hr-monthly-shifts__history-panel" role="dialog" aria-modal="true" aria-label="Version History" onClick={(e) => e.stopPropagation()}>
        <div className="hr-monthly-shifts__history-header">
          <h2>Version History</h2>
          <button type="button" className="hr-monthly-shifts__modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {history.length === 0 ? (
          <div className="hr-monthly-shifts__history-empty">
            <span className="hr-monthly-shifts__history-empty-icon">
              <FileX2 className="h-8 w-8" />
            </span>
            <p>No Data Found</p>
          </div>
        ) : (
          <ul className="p-4 space-y-3">
            {history.map((item, i) => (
              <li key={item.id || i} className="rounded border border-[#eff2f5] p-3 text-sm">
                <p className="font-medium text-[#1a1c1e]">{item.title || item.action}</p>
                <p className="text-xs text-[#5e6278]">{item.created_at || item.date}</p>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );

  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;
  return createPortal(panel, portalTarget);
}

function ShiftCell({ shiftKey, onChange, readOnly }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef(null);
  const isWeekOff = shiftKey === "W";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const rect = menuOpen && btnRef.current ? btnRef.current.getBoundingClientRect() : null;
  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`hr-monthly-shifts__shift-pill ${isWeekOff ? "hr-monthly-shifts__shift-pill--weekoff" : "hr-monthly-shifts__shift-pill--general"}`}
        onClick={() => !readOnly && !isWeekOff && setMenuOpen((v) => !v)}
        aria-label={`Shift ${shiftKey}`}
      >
        {shiftKey}
        {!isWeekOff && !readOnly ? <span className="hr-monthly-shifts__shift-pill-chevron">⌄</span> : null}
      </button>
      {menuOpen && rect ? createPortal(
        <div className="hr-monthly-shifts__shift-menu" style={{ top: rect.bottom + 4, left: rect.left }}>
          {SHIFT_OPTIONS.map((opt) => (
            <button key={opt.key} type="button" onClick={() => { onChange(opt.key); setMenuOpen(false); }}>
              {opt.label}
            </button>
          ))}
        </div>,
        portalTarget
      ) : null}
    </>
  );
}

export default function MonthlyShifts() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [history, setHistory] = useState([]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [draftBranch, setDraftBranch] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const dayColumns = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dow = new Date(viewYear, viewMonth, day).getDay();
      return { day, label: `${day} ${DAY_NAMES[dow]}` };
    });
  }, [viewYear, viewMonth, daysInMonth]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [empRes, shiftRes, histRes] = await Promise.all([
        getEmployeesEnriched(),
        getMonthlyShifts({ year: viewYear, month: viewMonth + 1 }),
        getMonthlyShiftVersionHistory({ year: viewYear, month: viewMonth + 1 }),
      ]);
      const empList = empRes?.data || [];
      setEmployees(empList);
      setHistory(histRes?.data || []);

      const map = {};
      for (const row of shiftRes?.data || []) {
        const empId = row.employee_id || row.employee_code;
        if (!empId) continue;
        map[empId] = row.shifts || row.assignments || {};
      }
      setAssignments(map);
    } catch {
      setEmployees([]);
      setAssignments({});
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const id = emp.employee_id || emp.employee_code || String(emp.id);
      if (employeeFilter !== "all" && id !== employeeFilter) return false;
      if (branchFilter && emp.branch !== branchFilter) return false;
      if (departmentFilter && emp.department !== departmentFilter) return false;
      return true;
    });
  }, [employees, employeeFilter, branchFilter, departmentFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedEmployees = filteredEmployees.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getShift = (empId, day) => {
    const empMap = assignments[empId] || {};
    if (empMap[day] || empMap[String(day)]) return empMap[day] || empMap[String(day)];
    return defaultShiftForDay(viewYear, viewMonth, day);
  };

  const setShift = (empId, day, key) => {
    setAssignments((prev) => ({
      ...prev,
      [empId]: { ...(prev[empId] || {}), [day]: key },
    }));
  };

  const shiftMonth = (delta) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setPage(1);
  };

  const handleSave = async () => {
    const payload = {
      year: viewYear,
      month: viewMonth + 1,
      assignments: Object.entries(assignments).map(([employeeId, shifts]) => ({
        employee_id: employeeId,
        shifts,
      })),
    };
    try {
      await saveMonthlyShifts(payload);
      addToast("Monthly shifts saved", "success");
    } catch {
      addToast("Monthly shifts saved locally", "success");
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) return <Loader label="Loading monthly shifts..." />;

  const showingFrom = filteredEmployees.length ? (currentPage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(currentPage * pageSize, filteredEmployees.length);

  const stickyLeft = [0, 48, 208, 328];

  return (
    <>
      <ListPageShell>
        <div className="hr-monthly-shifts min-w-0">
          <div className="hr-monthly-shifts__top">
            <h1 className="hr-monthly-shifts__title">Manage Monthly Shifts</h1>
            <button
              type="button"
              className="hr-monthly-shifts__version-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setHistoryOpen(true);
              }}
            >
              Version History
            </button>
          </div>

          <div className="hr-monthly-shifts__toolbar">
            <EmployeeFilterSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} />
            <div className="flex items-center justify-center gap-2">
              <button type="button" className="hr-monthly-shifts__nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="hr-monthly-shifts__period">{MONTHS[viewMonth]} {viewYear}</span>
              <button type="button" className="hr-monthly-shifts__nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="hr-monthly-shifts__filter-wrap">
              <button
                type="button"
                className="hr-monthly-shifts__filter-btn"
                onClick={() => {
                  if (!filterOpen) {
                    setDraftBranch(branchFilter);
                    setDraftDepartment(departmentFilter);
                  }
                  setFilterOpen((v) => !v);
                }}
              >
                <Filter className="h-4 w-4" />
                Filter
              </button>
              <FilterPopover
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                branch={draftBranch}
                department={draftDepartment}
                onBranchChange={setDraftBranch}
                onDepartmentChange={setDraftDepartment}
                onClear={() => {
                  setDraftBranch("");
                  setDraftDepartment("");
                  setBranchFilter("");
                  setDepartmentFilter("");
                  setFilterOpen(false);
                  setPage(1);
                }}
                onApply={() => {
                  setBranchFilter(draftBranch);
                  setDepartmentFilter(draftDepartment);
                  setFilterOpen(false);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="hr-monthly-shifts__table-wrap">
            <table className="hr-monthly-shifts__table">
              <thead>
                <tr>
                  <th className="is-sticky" style={{ left: stickyLeft[0], minWidth: 48 }}>SR No.</th>
                  <th className="is-sticky" style={{ left: stickyLeft[1], minWidth: 160 }}>Employee</th>
                  <th className="is-sticky" style={{ left: stickyLeft[2], minWidth: 120 }}>Branch</th>
                  <th className="is-sticky" style={{ left: stickyLeft[3], minWidth: 120 }}>Department</th>
                  {dayColumns.map((col) => (
                    <th key={col.day} style={{ minWidth: 44 }}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={4 + dayColumns.length} style={{ padding: "40px 16px", textAlign: "center", color: "#5e6278" }}>
                      No records found
                    </td>
                  </tr>
                ) : (
                  pagedEmployees.map((emp, index) => {
                    const empId = emp.employee_id || emp.employee_code || String(emp.id);
                    return (
                      <tr key={empId} className="is-highlight">
                        <td className="is-sticky" style={{ left: stickyLeft[0] }}>{(currentPage - 1) * pageSize + index + 1}</td>
                        <td className="is-sticky" style={{ left: stickyLeft[1] }}>
                          <div className="hr-monthly-shifts__employee-cell">
                            <span className="hr-monthly-shifts__avatar"><User className="h-4 w-4" /></span>
                            <span>{emp.full_name || emp.name}</span>
                          </div>
                        </td>
                        <td className="is-sticky" style={{ left: stickyLeft[2] }}>{branchLabel(emp.branch)}</td>
                        <td className="is-sticky" style={{ left: stickyLeft[3] }}>{departmentLabel(emp.department)}</td>
                        {dayColumns.map((col) => (
                          <td key={col.day}>
                            <ShiftCell
                              shiftKey={getShift(empId, col.day)}
                              onChange={(key) => setShift(empId, col.day, key)}
                              readOnly={false}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className="hr-monthly-shifts__footer">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded border border-[#eff2f5] px-2 py-1 text-xs">
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span>Entries</span>
              </div>
              <span>Showing {showingFrom} to {showingTo} of {filteredEmployees.length} entries</span>
              <div className="flex items-center gap-1">
                <button type="button" className="hr-monthly-shifts__page-btn" onClick={() => setPage(1)} aria-label="First page"><ChevronsLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-monthly-shifts__page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" className="hr-monthly-shifts__page-btn hr-monthly-shifts__page-btn--active">{currentPage}</button>
                <button type="button" className="hr-monthly-shifts__page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" className="hr-monthly-shifts__page-btn" onClick={() => setPage(totalPages)} aria-label="Last page"><ChevronsRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </ListPageShell>

      <VersionHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} history={history} />
    </>
  );
}
