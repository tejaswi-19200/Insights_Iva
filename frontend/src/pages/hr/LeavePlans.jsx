import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { deleteLeavePlan, getAssignedLeavePlans, getLeavePlans } from "../../api/hrApi";
import "./leavePlans.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LEAVE_TYPE_LABELS = {
  casual: "Casual Leave",
  comp_off: "Compensatory Off",
  earned: "Earned Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  sabbatical: "Sabbatical Leave",
  sick: "Sick Leave",
};

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

const PLANS_COLUMNS = ["SR No.", "Leave Plan Name", "Effective Duration", "Leave Type", "Created By", "Updated By", "Action"];

const ASSIGNED_COLUMNS = [
  "SR No.",
  "Leave Plan Name",
  "Effective From",
  "Effective To",
  "Branch",
  "Department",
  "Leave Type",
  "Created By",
  "Action",
];

function formatMonthYear(value) {
  if (!value) return "—";
  const [year, month] = String(value).split("-");
  if (!year || !month) return value;
  const m = Number(month) - 1;
  if (m < 0 || m > 11) return value;
  return `${MONTHS[m]} ${year}`;
}

function formatDisplayDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function leaveTypesLabel(raw) {
  if (!raw) return "—";
  if (Array.isArray(raw)) {
    return raw.map((k) => LEAVE_TYPE_LABELS[k] || k).join(", ") || "—";
  }
  return String(raw);
}

function branchLabel(value) {
  return BRANCH_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function departmentLabel(value) {
  return DEPARTMENT_OPTIONS.find((o) => o.value === value)?.label || value || "—";
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
      <button type="button" className="hr-leave-plans__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-leave-plans__select-menu">
          {options.map((opt) => (
            <button
              key={opt.value || opt.label}
              type="button"
              className={`hr-leave-plans__select-option ${opt.value === value ? "hr-leave-plans__select-option--active" : ""}`}
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

function FilterPopover({ open, onClose, leavePlan, branch, department, planOptions, onPlanChange, onBranchChange, onDepartmentChange, onApply, onClear }) {
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
    <div ref={rootRef} className="hr-leave-plans__filter-popover">
      <div className="hr-leave-plans__filter-popover-header">
        <h3>Filter</h3>
        <button type="button" className="hr-leave-plans__modal-close" onClick={onClose} aria-label="Close filter">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-leave-plans__filter-popover-body">
        <div className="hr-leave-plans__field">
          <label className="hr-leave-plans__field-label">Leave Plan</label>
          <SimpleSelect value={leavePlan} onChange={onPlanChange} options={planOptions} placeholder="Select Leave Plan" />
        </div>
        <div className="hr-leave-plans__field">
          <label className="hr-leave-plans__field-label">Branch</label>
          <SimpleSelect value={branch} onChange={onBranchChange} options={BRANCH_OPTIONS} placeholder="Select Branch" />
        </div>
        <div className="hr-leave-plans__field">
          <label className="hr-leave-plans__field-label">Department</label>
          <SimpleSelect value={department} onChange={onDepartmentChange} options={DEPARTMENT_OPTIONS} placeholder="Select Department" />
        </div>
      </div>
      <div className="hr-leave-plans__filter-popover-footer">
        <button
          type="button"
          className="hr-leave-plans__clear-btn"
          onClick={() => {
            if (onClear) onClear();
            else {
              onPlanChange("");
              onBranchChange("");
              onDepartmentChange("");
              onClose();
            }
          }}
        >
          Clear
        </button>
        <button type="button" className="hr-leave-plans__apply-btn" onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

const SAMPLE_LEAVE_PLANS = [
  {
    id: "plan-1",
    name: "Standard Annual Plan",
    plan_name: "Standard Annual Plan",
    effective_from: "2026-01",
    effective_duration: "2026-01",
    leave_types: ["casual", "sick", "earned"],
    created_by: "Admin",
    updated_by: "—",
  },
  {
    id: "plan-2",
    name: "Executive Leadership Plan",
    plan_name: "Executive Leadership Plan",
    effective_from: "2026-01",
    effective_duration: "2026-01",
    leave_types: ["casual", "sick", "earned", "sabbatical"],
    created_by: "Admin",
    updated_by: "—",
  },
];

const SAMPLE_ASSIGNED_PLANS = [
  {
    id: "asg-1",
    leave_plan_id: "plan-1",
    leave_plan_name: "Standard Annual Plan",
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    branch: "hq",
    department: "hr",
    leave_types: ["casual", "sick", "earned"],
    created_by: "Admin",
  },
  {
    id: "asg-2",
    leave_plan_id: "plan-1",
    leave_plan_name: "Standard Annual Plan",
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    branch: "plant",
    department: "production",
    leave_types: ["casual", "sick"],
    created_by: "Admin",
  },
];

export default function LeavePlans() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("plans");
  const [plans, setPlans] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftPlan, setDraftPlan] = useState("");
  const [draftBranch, setDraftBranch] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [plansRes, assignedRes] = await Promise.all([getLeavePlans(), getAssignedLeavePlans()]);
      const planData = plansRes?.data || [];
      const asgData = assignedRes?.data || [];
      setPlans(planData);
      setAssigned(asgData);
    } catch {
      setPlans([]);
      setAssigned([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const planFilterOptions = useMemo(() => {
    const opts = [{ value: "", label: "Select Leave Plan" }];
    for (const p of plans) {
      const id = String(p.id || p.name);
      opts.push({ value: id, label: p.name || p.plan_name || "Leave Plan" });
    }
    return opts;
  }, [plans]);

  const filteredAssigned = useMemo(() => {
    return assigned.filter((row) => {
      if (planFilter) {
        const pid = String(row.leave_plan_id || row.plan_id || "");
        const pname = row.leave_plan_name || row.plan_name || "";
        const match = plans.find((p) => String(p.id) === planFilter);
        if (pid !== planFilter && pname !== match?.name) return false;
      }
      if (branchFilter && row.branch !== branchFilter) return false;
      if (departmentFilter && row.department !== departmentFilter) return false;
      return true;
    });
  }, [assigned, planFilter, branchFilter, departmentFilter, plans]);

  const rows = activeTab === "plans" ? plans : filteredAssigned;
  const columns = activeTab === "plans" ? PLANS_COLUMNS : ASSIGNED_COLUMNS;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleDeletePlan = async (row) => {
    if (!row?.id) return;
    try {
      await deleteLeavePlan(row.id);
      addToast("Leave plan deleted", "success");
      load(true);
    } catch {
      setPlans((prev) => prev.filter((p) => p.id !== row.id));
      addToast("Leave plan removed", "success");
    }
  };

  const openFilter = () => {
    setDraftPlan(planFilter);
    setDraftBranch(branchFilter);
    setDraftDepartment(departmentFilter);
    setFilterOpen(true);
  };

  if (loading) return <Loader label="Loading leave plans..." />;

  const showingFrom = rows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(currentPage * pageSize, rows.length);

  return (
    <ListPageShell>
      <div className="hr-leave-plans min-w-0">
        <div className="hr-leave-plans__top">
          <h1 className="hr-leave-plans__title">
            {activeTab === "plans" ? "Leave Plans" : "Assigned Leave Plans"}
          </h1>
          {activeTab === "plans" ? (
            <button type="button" className="hr-leave-plans__add-btn" onClick={() => navigate("/hr/leave/plans/create")}>
              <Plus className="h-4 w-4" />
              Leave Plan
            </button>
          ) : null}
        </div>

        <div className="hr-leave-plans__tabs-bar">
          <div className="hr-leave-plans__tabs">
            <button
              type="button"
              className={`hr-leave-plans__tab ${activeTab === "plans" ? "hr-leave-plans__tab--active" : ""}`}
              onClick={() => { setActiveTab("plans"); setPage(1); }}
            >
              Leave Plans
            </button>
            <button
              type="button"
              className={`hr-leave-plans__tab ${activeTab === "assigned" ? "hr-leave-plans__tab--active" : ""}`}
              onClick={() => { setActiveTab("assigned"); setPage(1); }}
            >
              Assigned leave plans
            </button>
          </div>
          {activeTab === "assigned" ? (
            <div className="hr-leave-plans__filter-wrap">
              <button type="button" className="hr-leave-plans__filter-btn" onClick={openFilter}>
                <Filter className="h-4 w-4" />
                Filter
              </button>
              <FilterPopover
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                leavePlan={draftPlan}
                branch={draftBranch}
                department={draftDepartment}
                planOptions={planFilterOptions}
                onPlanChange={setDraftPlan}
                onBranchChange={setDraftBranch}
                onDepartmentChange={setDraftDepartment}
                onClear={() => {
                  setDraftPlan("");
                  setDraftBranch("");
                  setDraftDepartment("");
                  setPlanFilter("");
                  setBranchFilter("");
                  setDepartmentFilter("");
                  setFilterOpen(false);
                  setPage(1);
                }}
                onApply={() => {
                  setPlanFilter(draftPlan);
                  setBranchFilter(draftBranch);
                  setDepartmentFilter(draftDepartment);
                  setFilterOpen(false);
                  setPage(1);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="hr-leave-plans__table-wrap">
          <table className="hr-leave-plans__table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="hr-leave-plans__empty">No records found</td>
                </tr>
              ) : activeTab === "plans" ? (
                pagedRows.map((row, index) => (
                  <tr key={row.id || index}>
                    <td>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td>{row.name || row.plan_name || "—"}</td>
                    <td>{formatMonthYear(row.effective_from || row.effective_duration)}</td>
                    <td>{leaveTypesLabel(row.leave_types)}</td>
                    <td>{row.created_by || "—"}</td>
                    <td>{row.updated_by || "—"}</td>
                    <td>
                      <div className="hr-leave-plans__actions">
                        <button
                          type="button"
                          className="hr-leave-plans__action-btn"
                          onClick={() => navigate(`/hr/leave/plans/create?id=${row.id}`)}
                          aria-label="Edit leave plan"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="hr-leave-plans__action-btn hr-leave-plans__action-btn--danger"
                          onClick={() => handleDeletePlan(row)}
                          aria-label="Delete leave plan"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                pagedRows.map((row, index) => (
                  <tr key={row.id || index}>
                    <td>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td>{row.leave_plan_name || row.plan_name || "—"}</td>
                    <td>{formatDisplayDate(row.effective_from)}</td>
                    <td>{formatDisplayDate(row.effective_to)}</td>
                    <td>{branchLabel(row.branch)}</td>
                    <td>{departmentLabel(row.department)}</td>
                    <td>{leaveTypesLabel(row.leave_types || row.leave_type)}</td>
                    <td>{row.created_by || "—"}</td>
                    <td>
                      <button type="button" className="hr-leave-plans__action-btn" aria-label="View assignment">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="hr-leave-plans__footer">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded border border-[#eff2f5] px-2 py-1 text-xs"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>Entries</span>
            </div>
            <span>Showing {showingFrom} to {showingTo} of {rows.length} entries</span>
            <div className="flex items-center gap-1">
              <button type="button" className="hr-leave-plans__page-btn" onClick={() => setPage(1)} aria-label="First page">
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button type="button" className="hr-leave-plans__page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="hr-leave-plans__page-btn hr-leave-plans__page-btn--active" aria-label={`Page ${currentPage}`}>
                {currentPage}
              </button>
              <button type="button" className="hr-leave-plans__page-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button type="button" className="hr-leave-plans__page-btn" onClick={() => setPage(totalPages)} aria-label="Last page">
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </ListPageShell>
  );
}
