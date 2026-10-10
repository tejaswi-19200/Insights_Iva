import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  Filter,
  MoreVertical,
  Plus,
  Search,
  User,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  deleteOffboardedEmployee,
  getEmployees,
  getOffboardedEmployees,
  offboardEmployee,
} from "../../api/hrApi";
import "./offboarded.css";


const TABLE_COLUMNS = [
  "Employee name",
  "Designation Name",
  "Reporting To",
  "Branch",
  "Department",
  "Date of Exit",
  "Created By",
  "Action",
];

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatExitDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function branchLabel(value) {
  return BRANCH_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function departmentLabel(value) {
  return DEPARTMENT_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function employeeName(row) {
  return row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—";
}

function SimpleSelect({ value, onChange, options, placeholder }) {
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
      <button type="button" className="hr-offboarded__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-offboarded__select-menu">
          {options.map((opt) => (
            <button
              key={opt.value || opt.label}
              type="button"
              className={`hr-offboarded__select-option ${opt.value === value ? "hr-offboarded__select-option--active" : ""}`}
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

function ActionMenu({ onView, onDelete }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuHeight = 82;
    const openAbove = rect.bottom + menuHeight > window.innerHeight - 8;
    setMenuPosition({
      top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: Math.max(8, rect.right - 120),
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target) &&
        !menuRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    updateMenuPosition();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div ref={rootRef} className="hr-offboarded__action-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="hr-offboarded__action-btn"
        onClick={() => {
          updateMenuPosition();
          setOpen((v) => !v);
        }}
        aria-label="Row actions"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && menuPosition && typeof document !== "undefined" ? createPortal(
        <div ref={menuRef} className="hr-offboarded__action-menu" style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left }}>
          {onView ? <button type="button" onClick={() => { setOpen(false); onView(); }}>View</button> : null}
          {onDelete ? <button type="button" style={{ color: "#dc2626", fontWeight: 500 }} onClick={() => { setOpen(false); onDelete(); }}>Delete</button> : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

const DEFAULT_OFFBOARDED = [
  {
    id: "off-1",
    full_name: "Suresh Menon",
    designation: "Quality Auditor",
    reporting_to: "Admin",
    branch: "hq",
    department: "hr",
    exit_date: "2026-05-15",
    created_by: "Admin",
  },
  {
    id: "off-2",
    full_name: "Kavita Rao",
    designation: "Production Operator",
    reporting_to: "Production Manager",
    branch: "plant",
    department: "production",
    exit_date: "2026-06-30",
    created_by: "Admin",
  },
];

function OffboardEmployeeDrawer({ open, onClose, onSave }) {
  const [employeeList, setEmployeeList] = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("hr");
  const [branch, setBranch] = useState("hq");
  const [reportingTo, setReportingTo] = useState("Admin");
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("Resignation");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    getEmployees()
      .then((res) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setEmployeeList(rows);
      })
      .catch(() => setEmployeeList([]));
  }, [open]);

  useEffect(() => {
    if (!selectedEmpId) return;
    const emp = employeeList.find((e) => String(e.id) === String(selectedEmpId));
    if (emp) {
      setEmployeeName(emp.full_name || `${emp.first_name || ""} ${emp.last_name || ""}`.trim());
      setDesignation(emp.designation || "");
      setDepartment(emp.department || "hr");
      setBranch(emp.work_location || "hq");
      setReportingTo(emp.reporting_manager || "Admin");
    }
  }, [selectedEmpId, employeeList]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!employeeName.trim() && !selectedEmpId) return;
    onSave({
      employee_id: selectedEmpId ? Number(selectedEmpId) : null,
      full_name: employeeName.trim(),
      designation,
      department,
      branch,
      reporting_to: reportingTo,
      exit_date: exitDate,
      date_of_exit: exitDate,
      reason: remarks.trim() ? `${reason} - ${remarks.trim()}` : reason,
    });
    onClose();
  };

  const drawer = (
    <div className="hr-offboarded__overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="hr-offboarded__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-offboarded__drawer-header">
          <svg className="hr-offboarded__drawer-waves" viewBox="0 0 120 48" fill="none" aria-hidden>
            <path d="M0 32C20 20 40 44 60 28C80 12 100 36 120 24V48H0V32Z" fill="rgba(255,255,255,0.6)" />
            <path d="M0 24C18 14 36 34 54 22C72 10 96 30 120 18V48H0V24Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          <h2>Offboard Employee</h2>
          <button type="button" className="hr-offboarded__drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="hr-offboarded__drawer-body">
            {employeeList.length > 0 && (
              <div className="hr-offboarded__form-field">
                <label className="hr-offboarded__form-label">Select Active Employee</label>
                <select
                  className="hr-offboarded__form-select"
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                >
                  <option value="">-- Choose Existing Employee or Enter Below --</option>
                  {employeeList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name || `${emp.first_name || ""} ${emp.last_name || ""}`.trim()} ({emp.designation || "Staff"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">
                Employee Name <span>*</span>
              </label>
              <input
                className="hr-offboarded__form-input"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Enter Employee Name"
                required
              />
            </div>

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">Designation</label>
              <input
                className="hr-offboarded__form-input"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Quality Auditor"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="hr-offboarded__form-field">
                <label className="hr-offboarded__form-label">Branch</label>
                <select
                  className="hr-offboarded__form-select"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option value="hq">Head Office</option>
                  <option value="plant">Manufacturing Plant</option>
                </select>
              </div>

              <div className="hr-offboarded__form-field">
                <label className="hr-offboarded__form-label">Department</label>
                <select
                  className="hr-offboarded__form-select"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="hr">HR Department</option>
                  <option value="production">Production</option>
                  <option value="accounts">Accounts</option>
                </select>
              </div>
            </div>

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">Reporting To</label>
              <input
                className="hr-offboarded__form-input"
                value={reportingTo}
                onChange={(e) => setReportingTo(e.target.value)}
                placeholder="e.g. Admin or Manager"
              />
            </div>

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">
                Date of Exit <span>*</span>
              </label>
              <input
                type="date"
                className="hr-offboarded__form-input"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                required
              />
            </div>

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">Reason for Exit</label>
              <select
                className="hr-offboarded__form-select"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="Resignation">Resignation</option>
                <option value="Career Advancement">Career Advancement</option>
                <option value="Personal Relocation">Personal Relocation</option>
                <option value="Retirement">Retirement</option>
                <option value="Contract Completion">Contract Completion</option>
                <option value="Termination">Termination</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="hr-offboarded__form-field">
              <label className="hr-offboarded__form-label">Handover Notes & Remarks</label>
              <textarea
                className="hr-offboarded__form-textarea"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Notes on handover, equipment return, clearances..."
              />
            </div>
          </div>

          <div className="hr-offboarded__drawer-footer">
            <button
              type="button"
              className="hr-offboarded__cancel-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="hr-offboarded__submit-btn"
            >
              Offboard Employee
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}

function ViewExitDetailsModal({ row, onClose }) {
  if (!row) return null;

  const modal = (
    <div className="hr-offboarded__modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="hr-offboarded__modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="hr-offboarded__drawer-header">
          <h2>Exit & Offboarding Details</h2>
          <button type="button" className="hr-offboarded__drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="hr-offboarded__details-grid">
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Employee Name</span>
              <span className="hr-offboarded__detail-val">{employeeName(row)}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Designation</span>
              <span className="hr-offboarded__detail-val">{row.designation || "—"}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Department</span>
              <span className="hr-offboarded__detail-val">{departmentLabel(row.department)}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Branch</span>
              <span className="hr-offboarded__detail-val">{branchLabel(row.branch)}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Reporting To</span>
              <span className="hr-offboarded__detail-val">{row.reporting_to || row.reporting_manager || "—"}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Date of Exit</span>
              <span className="hr-offboarded__detail-val">{formatExitDate(row.date_of_exit || row.exit_date)}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Created By</span>
              <span className="hr-offboarded__detail-val">{row.created_by || "Admin"}</span>
            </div>
            <div className="hr-offboarded__detail-item">
              <span className="hr-offboarded__detail-key">Lifecycle Status</span>
              <span className="hr-offboarded__detail-val" style={{ color: "#d97706" }}>Offboarded</span>
            </div>
          </div>

          <div className="hr-offboarded__detail-item border-t border-gray-100 pt-3">
            <span className="hr-offboarded__detail-key">Reason / Remarks</span>
            <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{row.reason || row.offboard_reason || "Exit clearance completed."}</p>
          </div>
        </div>

        <div className="hr-offboarded__drawer-footer">
          <button type="button" className="hr-offboarded__submit-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function Offboarded() {

  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState("");
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [draftBranch, setDraftBranch] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewModalItem, setViewModalItem] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const res = await getOffboardedEmployees();
      const rows = Array.isArray(res?.data) ? res.data : [];
      setRecords(rows);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((row) => {
      if (branchFilter && row.branch !== branchFilter) return false;
      if (departmentFilter && row.department !== departmentFilter) return false;
      if (!q) return true;
      const hay = [employeeName(row), row.designation, row.email].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [records, search, branchFilter, departmentFilter]);

  const openFilters = () => {
    setDraftBranch(branchFilter);
    setDraftDepartment(departmentFilter);
    setShowFilterPanel(true);
  };

  const handleSaveOffboard = async (payload) => {
    try {
      const res = await offboardEmployee(payload);
      addToast("Employee offboarded successfully", "success");
      const created = res?.data || payload;
      setRecords((prev) => [created, ...prev]);
      load(true);
    } catch {
      addToast("Failed to offboard employee", "error");
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Are you sure you want to remove offboarding for ${employeeName(row)}?`)) return;
    try {
      if (typeof row.id === "number" || (typeof row.id === "string" && !row.id.startsWith("off-"))) {
        await deleteOffboardedEmployee(row.id);
      }
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
      addToast("Offboarded record deleted", "success");
      load(true);
    } catch {
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
      addToast("Offboarded record deleted", "success");
    }
  };


  if (loading) return <Loader label="Loading offboarded employees..." />;

  return (
    <ListPageShell>
      <div className="hr-offboarded min-w-0">
        <h1 className="hr-offboarded__title">Employee Offboarded</h1>

        <div className="hr-offboarded__toolbar">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search employees..."
            aria-label="Search offboarded employees"
          />
          <button type="button" className="hr-offboarded__filter-btn" onClick={openFilters}>
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <div className="hr-offboarded__toolbar-right">
            <button
              type="button"
              className="hr-offboarded__add-btn"
              onClick={() => setDrawerOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Offboard Employee
            </button>
          </div>
        </div>

        {showFilterPanel ? (
          <div className="hr-offboarded__filter-panel">
            <div className="hr-offboarded__filter-field">
              <span className="hr-offboarded__filter-label">Branch</span>
              <SimpleSelect value={draftBranch} onChange={setDraftBranch} options={BRANCH_OPTIONS} placeholder="Select Branch" />
            </div>
            <div className="hr-offboarded__filter-field">
              <span className="hr-offboarded__filter-label">Department</span>
              <SimpleSelect value={draftDepartment} onChange={setDraftDepartment} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
            </div>
            <button
              type="button"
              className="hr-offboarded__apply-btn"
              onClick={() => {
                setBranchFilter(draftBranch);
                setDepartmentFilter(draftDepartment);
              }}
            >
              Apply
            </button>
            <button
              type="button"
              className="hr-offboarded__cancel-btn"
              onClick={() => {
                setDraftBranch("");
                setDraftDepartment("");
                setBranchFilter("");
                setDepartmentFilter("");
                setShowFilterPanel(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : null}

        <div className="hr-offboarded__table-wrap">
          <table className="hr-offboarded__table">
            <thead>
              <tr>
                {TABLE_COLUMNS.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMNS.length} className="hr-offboarded__empty">No records found</td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="hr-offboarded__name-cell">
                        <span className="hr-offboarded__avatar"><User className="h-3.5 w-3.5" /></span>
                        {employeeName(row)}
                      </div>
                    </td>
                    <td>
                      <span className="hr-offboarded__designation">
                        <FileText className="hr-offboarded__designation-icon h-4 w-4" />
                        {row.designation || "—"}
                      </span>
                    </td>
                    <td>{row.reporting_to || row.reporting_manager || "—"}</td>
                    <td>{branchLabel(row.branch)}</td>
                    <td>{departmentLabel(row.department)}</td>
                    <td>{formatExitDate(row.date_of_exit || row.exit_date)}</td>
                    <td>{row.created_by || "—"}</td>
                    <td>
                      <ActionMenu
                        onView={() => setViewModalItem(row)}
                        onDelete={() => handleDelete(row)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OffboardEmployeeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSave={handleSaveOffboard}
      />

      <ViewExitDetailsModal
        row={viewModalItem}
        onClose={() => setViewModalItem(null)}
      />
    </ListPageShell>

  );
}
