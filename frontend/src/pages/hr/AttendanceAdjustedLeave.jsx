import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, FileSearch, Search } from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { getEmployeesEnriched } from "../../api/hrApi";
import "./attendanceAdjustedLeave.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEMO_EMPLOYEE = { id: "demo", employee_id: "G1234", full_name: "Satish Gogulothu", name: "Satish Gogulothu" };

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
    <div ref={rootRef} className="relative w-full min-w-[180px] max-w-[220px]">
      <button type="button" className="hr-adj-leave__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>

      {open ? (
        <div className="hr-adj-leave__select-menu">
          <div className="hr-adj-leave__search-wrap">
            <label className="hr-adj-leave__search-input">
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
                    className={`hr-adj-leave__option ${active ? "hr-adj-leave__option--active" : ""}`}
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

export default function AttendanceAdjustedLeave() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const empRes = await getEmployeesEnriched();
      const empList = empRes?.data || [];
      setEmployees(empList);

      const sampleAdj = empList.slice(0, 3).map((emp, idx) => {
        const empName = emp.full_name || emp.name || "Employee";
        const empId = emp.employee_id || emp.employee_code || `EMP-${idx + 1}`;
        return {
          id: `adj-${idx + 1}`,
          employee_id: empId,
          employee_name: empName,
          name: empName,
          date: `${String(idx + 2).padStart(2, "0")}-Sep-2026`,
          record_date: `${String(idx + 2).padStart(2, "0")}-Sep-2026`,
          leave_type: idx === 0 ? "Casual Leave (Half Day)" : idx === 1 ? "Compensatory Off" : "Earned Leave",
          status: "Adjusted",
        };
      });

      setRecords([]);
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
      if (employeeFilter === "all") return true;
      const id = row.employee_id || row.employee_code;
      return id === employeeFilter || row.employee_name === employeeFilter;
    });
  }, [records, employeeFilter]);

  const shiftMonth = (delta) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  if (loading) return <Loader label="Loading adjusted leave..." />;

  return (
    <ListPageShell>
      <div className="hr-adj-leave min-w-0">
        <h1 className="hr-adj-leave__title">Attendance - Adjusted Leave</h1>

        <div className="hr-adj-leave__toolbar">
          <EmployeeFilterSelect value={employeeFilter} onChange={setEmployeeFilter} employees={employees} />

          <div className="flex flex-1 items-center justify-center gap-2">
            <button type="button" className="hr-adj-leave__nav-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="hr-adj-leave__period-label">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" className="hr-adj-leave__nav-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="hidden w-[180px] sm:block" aria-hidden />
        </div>

        {filteredRecords.length === 0 ? (
          <div className="hr-adj-leave__content">
            <div className="hr-adj-leave__empty-icon">
              <FileSearch className="h-10 w-10" strokeWidth={1.5} />
            </div>
            <p className="hr-adj-leave__empty-text">No Data Found</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e5e7eb] bg-[#e8f2ff]">
                  <th className="px-4 py-3 font-semibold text-[#1e293b]">SR No.</th>
                  <th className="px-4 py-3 font-semibold text-[#1e293b]">Employee</th>
                  <th className="px-4 py-3 font-semibold text-[#1e293b]">Date</th>
                  <th className="px-4 py-3 font-semibold text-[#1e293b]">Leave Type</th>
                  <th className="px-4 py-3 font-semibold text-[#1e293b]">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((row, index) => (
                  <tr key={row.id} className="border-b border-[#e5e7eb] last:border-0">
                    <td className="px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3">{row.employee_name || row.name}</td>
                    <td className="px-4 py-3">{row.date || row.record_date}</td>
                    <td className="px-4 py-3">{row.leave_type || "—"}</td>
                    <td className="px-4 py-3">{row.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ListPageShell>
  );
}
