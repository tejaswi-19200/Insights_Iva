import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bike,
  Briefcase,
  Building2,
  Bus,
  Calculator,
  CalendarDays,
  Car,
  ChevronDown,
  ClipboardList,
  Cross,
  FileSearch,
  FileText,
  Fuel,
  Gift,
  Globe,
  Home,
  IndianRupee,
  Laptop,
  LayoutGrid,
  MapPin,
  Maximize2,
  Network,
  Palmtree,
  Pencil,
  PersonStanding,
  Phone,
  PiggyBank,
  Plane,
  Plus,
  Search,
  Smartphone,
  Tag,
  Trash2,
  UserRound,
  Utensils,
  Wrench,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { DocumentEmptyIcon } from "../../components/common/EmptyState";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { isGoogleMapsConfigured, loadGoogleMaps } from "../../utils/googleMapsLoader";
import {
  createLeaveType,
  createOrgBranch,
  createOrgDepartment,
  createOrgDesignation,
  createOrgEmploymentType,
  createOrgExpenseCategory,
  createOrgGeoFence,
  deleteOrgBranch,
  deleteOrgGeoFence,
  getLeaveTypes,
  getOrgBranches,
  getOrgDepartments,
  getOrgDesignations,
  getOrgEmploymentTypes,
  getOrgExpenseCategories,
  getOrgGeoFencing,
  updateLeaveType,
  updateOrgBranch,
  updateOrgDepartment,
  updateOrgDesignation,
  updateOrgEmploymentType,
  updateOrgExpenseCategory,
  updateOrgGeoFence,
} from "../../api/hrApi";
import "./organizationSetup.css";

const HYDERABAD_CENTER = { lat: 17.385, lng: 78.4867 };
const CREATED_BY = { name: "Satish Gogulothu", date: "05 Sep 2026" };

const SETUP_TABS = [
  { key: "leave-types", label: "Leave Types", icon: CalendarDays },
  { key: "designations", label: "Designations", icon: Pencil },
  { key: "departments", label: "Departments", icon: Network },
  { key: "employment-types", label: "Employment Types", icon: UserRound },
  { key: "expense-settings", label: "Expense Settings", icon: IndianRupee },
  { key: "branches", label: "Branches", icon: Building2 },
  { key: "geo-fencing", label: "Geo Fencing", icon: MapPin },
];

const PAID_OPTIONS = [
  { value: "", label: "Select Leave Type" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
];

const DEFAULT_LEAVE_TYPES = [
  { id: "lt-casual", name: "Casual Leave", is_paid: "paid", is_active: true },
  { id: "lt-comp", name: "Compensatory Off", is_paid: "paid", is_active: true },
  { id: "lt-earned", name: "Earned Leave", is_paid: "paid", is_active: true },
  { id: "lt-lwp", name: "Leave Without Pay", is_paid: "unpaid", is_active: true },
  { id: "lt-maternity", name: "Maternity Leave", is_paid: "paid", is_active: true },
  { id: "lt-paternity", name: "Paternity Leave", is_paid: "paid", is_active: true },
  { id: "lt-sabbatical", name: "Sabbatical Leave", is_paid: "paid", is_active: true },
  { id: "lt-sick", name: "Sick Leave", is_paid: "paid", is_active: true },
].map((row) => ({
  ...row,
  created_by_name: CREATED_BY.name,
  created_by_date: CREATED_BY.date,
  updated_by_name: null,
  updated_by_date: null,
}));

const DEFAULT_DESIGNATIONS = [
  { id: "des-hr-head", name: "HR Head", created_by_name: null, created_by_date: null, updated_by_name: null, updated_by_date: null },
];

const DEFAULT_DEPARTMENTS = [
  { id: "dept-hr", name: "HR Department", created_by_name: null, created_by_date: null, updated_by_name: null, updated_by_date: null },
];

const DEFAULT_EMPLOYMENT_TYPES = [
  { id: "emp-permanent", name: "Permanent", created_by_name: null, created_by_date: null, updated_by_name: null, updated_by_date: null },
];

const DEFAULT_BRANCHES = [
  {
    id: "branch-ho",
    name: "Head Office",
    state: "Telangana",
    district: "Hyderabad",
    address: "",
    device_type: "",
    created_by_name: null,
    created_by_date: null,
    updated_by_name: null,
    updated_by_date: null,
  },
];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry",
];

const DISTRICTS_BY_STATE = {
  Telangana: ["Hyderabad", "Rangareddy", "Warangal", "Karimnagar", "Nizamabad"],
  Karnataka: ["Bengaluru Urban", "Mysuru", "Mangaluru"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai"],
  Delhi: ["New Delhi", "South Delhi", "North Delhi"],
};

const DEVICE_TYPE_OPTIONS = [
  { value: "", label: "Select Device Type" },
  { value: "app", label: "App" },
  { value: "biometric", label: "Biometric" },
  { value: "app_biometric", label: "App & Biometric" },
];

const EXPENSE_ICON_OPTIONS = [
  { id: "travel", icon: Plane, bg: "#dbeafe", color: "#2563eb" },
  { id: "business", icon: BarChart3, bg: "#fce7f3", color: "#db2777" },
  { id: "meals", icon: Utensils, bg: "#ffedd5", color: "#ea580c" },
  { id: "commute", icon: Bus, bg: "#e0e7ff", color: "#4f46e5" },
  { id: "savings", icon: PiggyBank, bg: "#fef3c7", color: "#d97706" },
  { id: "misc", icon: LayoutGrid, bg: "#f3e8ff", color: "#9333ea" },
  { id: "fuel", icon: Fuel, bg: "#fee2e2", color: "#dc2626" },
  { id: "maintenance", icon: Wrench, bg: "#ecfccb", color: "#65a30d" },
  { id: "office", icon: Briefcase, bg: "#cffafe", color: "#0891b2" },
  { id: "admin", icon: ClipboardList, bg: "#e2e8f0", color: "#475569" },
  { id: "lodging", icon: Home, bg: "#fef9c3", color: "#ca8a04" },
  { id: "global", icon: Globe, bg: "#d1fae5", color: "#059669" },
  { id: "medical", icon: Cross, bg: "#ffe4e6", color: "#e11d48" },
  { id: "gift", icon: Gift, bg: "#ede9fe", color: "#7c3aed" },
  { id: "document", icon: FileText, bg: "#f1f5f9", color: "#64748b" },
  { id: "tag", icon: Tag, bg: "#ffedd5", color: "#c2410c" },
  { id: "building", icon: Building2, bg: "#e0f2fe", color: "#0284c7" },
  { id: "laptop", icon: Laptop, bg: "#f5f5f4", color: "#57534e" },
  { id: "tax", icon: Calculator, bg: "#fef3c7", color: "#b45309" },
  { id: "wellness", icon: PersonStanding, bg: "#dcfce7", color: "#16a34a" },
  { id: "car", icon: Car, bg: "#dbeafe", color: "#1d4ed8" },
  { id: "scooter", icon: Bike, bg: "#fce7f3", color: "#be185d" },
  { id: "phone", icon: Phone, bg: "#e0e7ff", color: "#4338ca" },
  { id: "mobile", icon: Smartphone, bg: "#f3f4f6", color: "#374151" },
  { id: "vacation", icon: Palmtree, bg: "#ccfbf1", color: "#0d9488" },
];

function expenseIconMeta(iconId) {
  return EXPENSE_ICON_OPTIONS.find((o) => o.id === iconId) || EXPENSE_ICON_OPTIONS[0];
}

function deviceTypeLabel(value) {
  return DEVICE_TYPE_OPTIONS.find((o) => o.value === value)?.label || value || "";
}

function districtsForState(state) {
  return DISTRICTS_BY_STATE[state] || [];
}

function withDefaults(rows, fallback) {
  if (!Array.isArray(rows) || rows.length === 0) return fallback;
  return rows;
}

function MetaCell({ name, date }) {
  if (!name) return <span className="hr-org-setup__dash">--</span>;
  return (
    <>
      <span className="hr-org-setup__meta-name">{name}</span>
      {date ? <span className="hr-org-setup__meta-date">{date}</span> : null}
    </>
  );
}

function SetupEmptyState() {
  return (
    <div className="hr-org-setup__empty">
      <div className="hr-org-setup__empty-illustration" aria-hidden>
        <div className="hr-org-setup__empty-blob" />
        <div className="hr-org-setup__empty-doc">
          <DocumentEmptyIcon className="h-16 w-16" />
        </div>
        <div className="hr-org-setup__empty-search">
          <FileSearch className="h-14 w-14" strokeWidth={1.5} />
        </div>
      </div>
      <p className="hr-org-setup__empty-text">No Data Found</p>
    </div>
  );
}

function ExpenseIconBadge({ iconId, size = 30 }) {
  const meta = expenseIconMeta(iconId);
  const Icon = meta.icon;
  return (
    <span
      className="hr-org-setup__icon-dot"
      style={{ background: meta.bg, width: size, height: size }}
    >
      <Icon className="h-4 w-4" style={{ color: meta.color }} strokeWidth={2} />
    </span>
  );
}

function ExpenseIconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = expenseIconMeta(value);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="hr-org-setup__icon-picker">
      <button
        type="button"
        className={`hr-org-setup__icon-trigger ${value ? "" : "hr-org-setup__icon-trigger--placeholder"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {value ? (
          <span className="hr-org-setup__icon-trigger-preview">
            <ExpenseIconBadge iconId={value} />
            <span>{selected.id}</span>
          </span>
        ) : (
          <span>Select Icon</span>
        )}
        <ChevronDown className="h-4 w-4 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-org-setup__icon-grid">
          {EXPENSE_ICON_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                className={`hr-org-setup__icon-option ${value === opt.id ? "hr-org-setup__icon-option--active" : ""}`}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                aria-label={opt.id}
              >
                <span className="hr-org-setup__icon-option-inner" style={{ background: opt.bg }}>
                  <Icon className="h-4 w-4" style={{ color: opt.color }} strokeWidth={2} />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExpenseCategoryPanel({ mode, initial, onClose, onSave }) {
  const [icon, setIcon] = useState(initial.icon || "");
  const [name, setName] = useState(initial.name || "");
  const [limit, setLimit] = useState(initial.limit || "");
  const [approvalChain, setApprovalChain] = useState(Boolean(initial.approval_chain));

  useEffect(() => {
    setIcon(initial.icon || "");
    setName(initial.name || "");
    setLimit(initial.limit || "");
    setApprovalChain(Boolean(initial.approval_chain));
  }, [initial, mode]);

  const title = mode === "edit" ? "Edit Expense Category" : "Add Expense Category";
  const valid = icon && name.trim() && String(limit).trim();

  return (
    <div className="hr-org-setup__panel">
      <div className="hr-org-setup__panel-header">
        <h2>{title}</h2>
        <button type="button" className="hr-org-setup__panel-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-org-setup__form-row">
        <div className="hr-org-setup__field">
          <label>Select Icon <span className="hr-org-setup__required">*</span></label>
          <ExpenseIconPicker value={icon} onChange={setIcon} />
        </div>
        <div className="hr-org-setup__field">
          <label>Expense Name <span className="hr-org-setup__required">*</span></label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter Expense Name"
          />
        </div>
        <div className="hr-org-setup__field">
          <label>Set Expense Limit <span className="hr-org-setup__required">*</span></label>
          <input
            type="text"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Enter Expense limit"
          />
        </div>
      </div>
      <label className="hr-org-setup__checkbox">
        <input
          type="checkbox"
          checked={approvalChain}
          onChange={(e) => setApprovalChain(e.target.checked)}
        />
        Configure approval chain
      </label>
      <div className="hr-org-setup__panel-actions">
        <button
          type="button"
          className="hr-org-setup__save-btn"
          disabled={!valid}
          onClick={() => onSave({ icon, name: name.trim(), limit: String(limit).trim(), approval_chain: approvalChain })}
        >
          Save
        </button>
        <button type="button" className="hr-org-setup__cancel-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ExpenseSettingsTab({ rows, setRows }) {
  const { addToast } = useToast();
  const [panelMode, setPanelMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState({});

  const openAdd = () => {
    setEditingId(null);
    setEditRow({});
    setPanelMode("add");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setEditRow(row);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setEditingId(null);
  };

  const persist = (next) => {
    setRows(next);
  };

  const handleSave = async (payload) => {
    if (panelMode === "edit" && editingId) {
      const next = rows.map((row) => (
        row.id === editingId
          ? {
              ...row,
              ...payload,
              updated_by_name: CREATED_BY.name,
              updated_by_date: CREATED_BY.date,
            }
          : row
      ));
      try {
        await updateOrgExpenseCategory(editingId, payload);
        persist(next);
        addToast("Expense category updated", "success");
      } catch {
        addToast("Failed to update expense category", "error");
      }
    } else {
      try {
        const res = await createOrgExpenseCategory(payload);
        const row = res?.data || {
          id: `exp-${Date.now()}`,
          ...payload,
          created_by_name: null,
          created_by_date: null,
          updated_by_name: null,
          updated_by_date: null,
        };
        persist([row, ...rows]);
        addToast("Expense category added", "success");
      } catch {
        addToast("Failed to add expense category", "error");
      }
    }
    closePanel();
  };

  return (
    <div className="hr-org-setup__content-card">
      <div className="hr-org-setup__toolbar">
        <button type="button" className="hr-org-setup__add-btn" onClick={openAdd} aria-label="Add expense category">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {panelMode && (
        <ExpenseCategoryPanel
          mode={panelMode}
          initial={editRow}
          onClose={closePanel}
          onSave={handleSave}
        />
      )}

      {rows.length === 0 && !panelMode ? (
        <SetupEmptyState />
      ) : rows.length > 0 ? (
        <div className="hr-org-setup__table-wrap">
          <table className="hr-org-setup__table">
            <thead>
              <tr>
                <th>Sr. No</th>
                <th>Expense Name</th>
                <th>Expense Limit</th>
                <th>Created By</th>
                <th>Updated By</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="hr-org-setup__sr">{index + 1}.</td>
                  <td>
                    <span className="hr-org-setup__expense-name">
                      <ExpenseIconBadge iconId={row.icon} />
                      {row.name}
                    </span>
                  </td>
                  <td>{row.limit}</td>
                  <td><MetaCell name={row.created_by_name} date={row.created_by_date} /></td>
                  <td><MetaCell name={row.updated_by_name} date={row.updated_by_date} /></td>
                  <td>
                    <button type="button" className="hr-org-setup__edit-btn" onClick={() => openEdit(row)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function BranchPanel({ mode, initial, onClose, onSave }) {
  const [name, setName] = useState(initial.name || "");
  const [state, setState] = useState(initial.state || "");
  const [district, setDistrict] = useState(initial.district || "");
  const [deviceType, setDeviceType] = useState(initial.device_type || "");
  const [address, setAddress] = useState(initial.address || "");

  useEffect(() => {
    setName(initial.name || "");
    setState(initial.state || "");
    setDistrict(initial.district || "");
    setDeviceType(initial.device_type || "");
    setAddress(initial.address || "");
  }, [initial, mode]);

  const districts = districtsForState(state);
  const title = mode === "edit" ? "Edit Branch" : "Add Branch";
  const valid = name.trim() && state && district;

  const handleStateChange = (value) => {
    setState(value);
    const nextDistricts = districtsForState(value);
    setDistrict(nextDistricts.includes(district) ? district : "");
  };

  return (
    <div className="hr-org-setup__panel">
      <div className="hr-org-setup__panel-header">
        <h2>{title}</h2>
        <button type="button" className="hr-org-setup__panel-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-org-setup__form-row hr-org-setup__form-row--4">
        <div className="hr-org-setup__field">
          <label>Branch</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your branch" />
        </div>
        <div className="hr-org-setup__field">
          <label>State</label>
          <select value={state} onChange={(e) => handleStateChange(e.target.value)}>
            <option value="">Select State</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="hr-org-setup__field">
          <label>District</label>
          <select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!state}>
            <option value="">Select District</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="hr-org-setup__field">
          <label>Device Type</label>
          <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
            {DEVICE_TYPE_OPTIONS.map((o) => <option key={o.value || o.label} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="hr-org-setup__form-row hr-org-setup__form-row--address">
        <div className="hr-org-setup__field">
          <label>Address</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter Address" />
        </div>
      </div>
      <div className="hr-org-setup__panel-actions">
        <button
          type="button"
          className="hr-org-setup__save-btn"
          disabled={!valid}
          onClick={() => onSave({
            name: name.trim(),
            state,
            district,
            device_type: deviceType,
            address: address.trim(),
          })}
        >
          Save
        </button>
        <button type="button" className="hr-org-setup__cancel-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function BranchesTab({ rows, setRows }) {
  const { addToast } = useToast();
  const [panelMode, setPanelMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState({});

  const openAdd = () => {
    setEditingId(null);
    setEditRow({});
    setPanelMode("add");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setEditRow(row);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setEditingId(null);
  };

  const persist = (next) => {
    setRows(next);
  };

  const handleSave = async (payload) => {
    if (panelMode === "edit" && editingId) {
      const next = rows.map((row) => (
        row.id === editingId
          ? {
              ...row,
              ...payload,
              updated_by_name: CREATED_BY.name,
              updated_by_date: CREATED_BY.date,
            }
          : row
      ));
      try {
        await updateOrgBranch(editingId, payload);
        persist(next);
        addToast("Branch updated", "success");
      } catch {
        addToast("Failed to update branch", "error");
      }
    } else {
      try {
        const res = await createOrgBranch(payload);
        const row = res?.data || {
          id: `branch-${Date.now()}`,
          ...payload,
          created_by_name: null,
          created_by_date: null,
          updated_by_name: null,
          updated_by_date: null,
        };
        persist([row, ...rows]);
        addToast("Branch added", "success");
      } catch {
        addToast("Failed to add branch", "error");
      }
    }
    closePanel();
  };

  const handleDelete = async (id) => {
    try {
      await deleteOrgBranch(id);
      persist(rows.filter((row) => row.id !== id));
      addToast("Branch deleted", "success");
    } catch {
      addToast("Failed to delete branch", "error");
    }
  };

  return (
    <>
      <div className="hr-org-setup__toolbar">
        <button type="button" className="hr-org-setup__add-btn" onClick={openAdd} aria-label="Add branch">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {panelMode && (
        <BranchPanel
          mode={panelMode}
          initial={editRow}
          onClose={closePanel}
          onSave={handleSave}
        />
      )}

      <div className="hr-org-setup__table-wrap">
        <table className="hr-org-setup__table">
          <thead>
            <tr>
              <th>
                <span className="hr-org-setup__sortable">
                  Branch
                  <ChevronDown className="rotate-180" />
                  <ChevronDown />
                </span>
              </th>
              <th>State</th>
              <th>District</th>
              <th>Address</th>
              <th>Device Type</th>
              <th>Created By</th>
              <th>Updated By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.state}</td>
                <td>{row.district}</td>
                <td>{row.address || ""}</td>
                <td>{deviceTypeLabel(row.device_type)}</td>
                <td><MetaCell name={row.created_by_name} date={row.created_by_date} /></td>
                <td><MetaCell name={row.updated_by_name} date={row.updated_by_date} /></td>
                <td>
                  <div className="hr-org-setup__actions">
                    <button type="button" className="hr-org-setup__edit-btn" onClick={() => openEdit(row)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" className="hr-org-setup__delete-btn" onClick={() => handleDelete(row.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MockGeoFenceMap({ mapType }) {
  return (
    <div className="hr-org-setup__map-wrap">
      <div className="hr-org-setup__map-controls">
        <span className={`hr-org-setup__map-type--active`}>Map</span>
        <span className={mapType === "satellite" ? "hr-org-setup__map-type--active" : ""}>Satellite</span>
      </div>
      <button type="button" className="hr-org-setup__map-fs" aria-label="Fullscreen" disabled>
        <Maximize2 className="h-4 w-4" />
      </button>
      <svg className="hr-org-setup__map" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect width="100%" height="100%" fill="#e8ede8" />
        <path d="M0 200 Q200 120 400 180 T800 140 T1200 200" stroke="#d4ddd4" strokeWidth="24" fill="none" />
        <path d="M100 320 Q350 260 600 300 T1000 280" stroke="#c8d4c8" strokeWidth="16" fill="none" />
      </svg>
      <div className="hr-org-setup__geofence-circle" />
    </div>
  );
}

function GoogleGeoFenceMapInner({ address, mapType, onMapTypeChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: HYDERABAD_CENTER,
            zoom: 14,
            mapTypeControl: false,
            streetViewControl: true,
            fullscreenControl: false,
            zoomControl: true,
          });
          circleRef.current = new maps.Circle({
            strokeColor: "#dc2626",
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: "#ef4444",
            fillOpacity: 0.25,
            map: mapRef.current,
            center: HYDERABAD_CENTER,
            radius: 500,
          });
        }
        setReady(true);
      })
      .catch(() => setReady(false));

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    mapRef.current.setMapTypeId(
      mapType === "satellite"
        ? window.google.maps.MapTypeId.SATELLITE
        : window.google.maps.MapTypeId.ROADMAP
    );
  }, [mapType]);

  useEffect(() => {
    if (!mapRef.current || !circleRef.current || !address?.trim() || !window.google?.maps) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        mapRef.current.panTo(loc);
        circleRef.current.setCenter(loc);
      }
    });
  }, [address]);

  return (
    <div className="hr-org-setup__map-wrap">
      <div ref={containerRef} className="hr-org-setup__map" aria-label="Geo fencing map" />
      <div className="hr-org-setup__map-controls">
        <button
          type="button"
          className={mapType === "roadmap" ? "hr-org-setup__map-type--active" : ""}
          onClick={() => onMapTypeChange("roadmap")}
        >
          Map
        </button>
        <button
          type="button"
          className={mapType === "satellite" ? "hr-org-setup__map-type--active" : ""}
          onClick={() => onMapTypeChange("satellite")}
        >
          Satellite
        </button>
      </div>
      <button
        type="button"
        className="hr-org-setup__map-fs"
        onClick={() => containerRef.current?.parentElement?.requestFullscreen?.()}
        aria-label="Fullscreen"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      {!ready ? <div className="hr-org-setup__map-loading">Loading map…</div> : null}
    </div>
  );
}

function GoogleGeoFenceMap(props) {
  if (!isGoogleMapsConfigured()) {
    return <MockGeoFenceMap mapType={props.mapType} />;
  }
  return <GoogleGeoFenceMapInner {...props} />;
}

function GeoFencePanel({ mode, initial, branchOptions, onClose, onSave }) {
  const [branchId, setBranchId] = useState(initial.branch_id || "");
  const [address, setAddress] = useState(initial.address || "");
  const [searchAddress, setSearchAddress] = useState(initial.address || "");
  const [mapType, setMapType] = useState("roadmap");

  useEffect(() => {
    setBranchId(initial.branch_id || "");
    setAddress(initial.address || "");
    setSearchAddress(initial.address || "");
  }, [initial, mode]);

  const title = mode === "edit" ? "Edit Geo fencing" : "Add Geo fencing";
  const valid = branchId && address.trim();

  return (
    <div className="hr-org-setup__panel">
      <div className="hr-org-setup__panel-header">
        <h2>{title}</h2>
        <button type="button" className="hr-org-setup__panel-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-org-setup__form-row">
        <div className="hr-org-setup__field">
          <label>Branch</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Select Branch</option>
            {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="hr-org-setup__field" style={{ gridColumn: "span 2" }}>
          <label>Address</label>
          <div className="hr-org-setup__address-row">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter address"
            />
            <button
              type="button"
              className="hr-org-setup__address-search"
              onClick={() => setSearchAddress(address.trim())}
              aria-label="Search address"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <GoogleGeoFenceMap address={searchAddress} mapType={mapType} onMapTypeChange={setMapType} />
      <div className="hr-org-setup__panel-actions">
        <button
          type="button"
          className="hr-org-setup__save-btn"
          disabled={!valid}
          onClick={() => onSave({ branch_id: branchId, address: address.trim() })}
        >
          Save
        </button>
        <button type="button" className="hr-org-setup__cancel-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function GeoFencingTab({ rows, setRows, branches }) {
  const { addToast } = useToast();
  const [panelMode, setPanelMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState({});

  const openAdd = () => {
    setEditingId(null);
    setEditRow({});
    setPanelMode("add");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setEditRow(row);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setEditingId(null);
  };

  const persist = (next) => {
    setRows(next);
  };

  const branchName = (id) => branches.find((b) => b.id === id)?.name || "—";

  const handleSave = async (payload) => {
    if (panelMode === "edit" && editingId) {
      const next = rows.map((row) => (
        row.id === editingId
          ? {
              ...row,
              ...payload,
              updated_by_name: CREATED_BY.name,
              updated_by_date: CREATED_BY.date,
            }
          : row
      ));
      try {
        await updateOrgGeoFence(editingId, payload);
        persist(next);
        addToast("Geo fence updated", "success");
      } catch {
        addToast("Failed to update geo fence", "error");
      }
    } else {
      try {
        const res = await createOrgGeoFence(payload);
        const row = res?.data || {
          id: `geo-${Date.now()}`,
          ...payload,
          created_by_name: null,
          created_by_date: null,
          updated_by_name: null,
          updated_by_date: null,
        };
        persist([row, ...rows]);
        addToast("Geo fence added", "success");
      } catch {
        addToast("Failed to add geo fence", "error");
      }
    }
    closePanel();
  };

  const handleDelete = async (id) => {
    try {
      await deleteOrgGeoFence(id);
      persist(rows.filter((row) => row.id !== id));
      addToast("Geo fence deleted", "success");
    } catch {
      addToast("Failed to delete geo fence", "error");
    }
  };

  return (
    <div className="hr-org-setup__content-card">
      <div className="hr-org-setup__toolbar">
        <button type="button" className="hr-org-setup__add-btn" onClick={openAdd} aria-label="Add geo fencing">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {panelMode && (
        <GeoFencePanel
          mode={panelMode}
          initial={editRow}
          branchOptions={branches}
          onClose={closePanel}
          onSave={handleSave}
        />
      )}

      {rows.length === 0 && !panelMode ? (
        <SetupEmptyState />
      ) : rows.length > 0 ? (
        <div className="hr-org-setup__table-wrap">
          <table className="hr-org-setup__table">
            <thead>
              <tr>
                <th>Sr. No</th>
                <th>Branch</th>
                <th>Address</th>
                <th>Created By</th>
                <th>Updated By</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="hr-org-setup__sr">{index + 1}.</td>
                  <td>{branchName(row.branch_id)}</td>
                  <td>{row.address}</td>
                  <td><MetaCell name={row.created_by_name} date={row.created_by_date} /></td>
                  <td><MetaCell name={row.updated_by_name} date={row.updated_by_date} /></td>
                  <td>
                    <div className="hr-org-setup__actions">
                      <button type="button" className="hr-org-setup__edit-btn" onClick={() => openEdit(row)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" className="hr-org-setup__delete-btn" onClick={() => handleDelete(row.id)} aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function StatusToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      className={`hr-org-setup__toggle ${checked ? "hr-org-setup__toggle--on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-label={checked ? "Active" : "Inactive"}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

function LeaveTypesPanel({ mode, initialName, initialPaid, onClose, onSave }) {
  const [name, setName] = useState(initialName);
  const [isPaid, setIsPaid] = useState(initialPaid);

  useEffect(() => {
    setName(initialName);
    setIsPaid(initialPaid);
  }, [initialName, initialPaid, mode]);

  const title = mode === "edit" ? "Edit Leave Type" : "Add Leave Type";

  return (
    <div className="hr-org-setup__panel">
      <div className="hr-org-setup__panel-header">
        <h2>{title}</h2>
        <button type="button" className="hr-org-setup__panel-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-org-setup__form-grid">
        <div className="hr-org-setup__field">
          <label>Leave Type</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter leave name"
          />
        </div>
        <div className="hr-org-setup__field">
          <label>Is Paid</label>
          <select value={isPaid} onChange={(e) => setIsPaid(e.target.value)}>
            {PAID_OPTIONS.map((o) => <option key={o.value || o.label} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="hr-org-setup__panel-actions">
        <button
          type="button"
          className="hr-org-setup__save-btn"
          disabled={!name.trim() || !isPaid}
          onClick={() => onSave({ name: name.trim(), is_paid: isPaid })}
        >
          Save
        </button>
        <button type="button" className="hr-org-setup__cancel-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function LeaveTypesTab({ rows, setRows }) {
  const { addToast } = useToast();
  const [panelMode, setPanelMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPaid, setEditPaid] = useState("");

  const openAdd = () => {
    setEditingId(null);
    setEditName("");
    setEditPaid("");
    setPanelMode("add");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditPaid(row.is_paid);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setEditingId(null);
  };

  const persist = (next) => {
    setRows(next);
  };

  const handleSave = async ({ name, is_paid }) => {
    if (panelMode === "edit" && editingId) {
      const next = rows.map((row) => (
        row.id === editingId
          ? {
              ...row,
              name,
              is_paid,
              updated_by_name: CREATED_BY.name,
              updated_by_date: CREATED_BY.date,
            }
          : row
      ));
      try {
        await updateLeaveType(editingId, { name, is_paid });
        persist(next);
        addToast("Leave type updated", "success");
      } catch {
        addToast("Failed to update leave type", "error");
      }
    } else {
      try {
        const res = await createLeaveType({ name, is_paid });
        const row = res?.data || {
          id: `lt-${Date.now()}`,
          name,
          is_paid,
          is_active: true,
          created_by_name: CREATED_BY.name,
          created_by_date: CREATED_BY.date,
          updated_by_name: null,
          updated_by_date: null,
        };
        persist([row, ...rows]);
        addToast("Leave type added", "success");
      } catch {
        addToast("Failed to add leave type", "error");
      }
    }
    closePanel();
  };

  const toggleStatus = async (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const next = rows.map((r) => (r.id === id ? { ...r, is_active: !r.is_active } : r));
    try {
      await updateLeaveType(id, { is_active: !row.is_active });
      persist(next);
    } catch {
      addToast("Failed to update leave type status", "error");
    }
  };

  return (
    <>
      <div className="hr-org-setup__toolbar">
        <button type="button" className="hr-org-setup__add-btn" onClick={openAdd} aria-label="Add leave type">
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {panelMode && (
        <LeaveTypesPanel
          mode={panelMode}
          initialName={editName}
          initialPaid={editPaid}
          onClose={closePanel}
          onSave={handleSave}
        />
      )}

      <div className="hr-org-setup__table-wrap">
        <table className="hr-org-setup__table">
          <thead>
            <tr>
              <th>Sr. No</th>
              <th>Leave Type</th>
              <th>Is Paid</th>
              <th>Created By</th>
              <th>Updated By</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="hr-org-setup__sr">{index + 1}.</td>
                <td>{row.name}</td>
                <td>
                  <span className="hr-org-setup__paid">
                    {row.is_paid === "unpaid" ? "UNPAID" : "PAID"}
                  </span>
                </td>
                <td>
                  <MetaCell name={row.created_by_name} date={row.created_by_date} />
                </td>
                <td>
                  <MetaCell name={row.updated_by_name} date={row.updated_by_date} />
                </td>
                <td>
                  <StatusToggle checked={row.is_active} onChange={() => toggleStatus(row.id)} />
                </td>
                <td>
                  <button type="button" className="hr-org-setup__edit-btn" onClick={() => openEdit(row)} aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SimpleSetupPanel({ mode, title, fieldLabel, placeholder, initialName, onClose, onSave }) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName, mode]);

  return (
    <div className="hr-org-setup__panel">
      <div className="hr-org-setup__panel-header">
        <h2>{title}</h2>
        <button type="button" className="hr-org-setup__panel-close" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="hr-org-setup__form-inline">
        <div className="hr-org-setup__field">
          <label>{fieldLabel}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <div className="hr-org-setup__panel-actions">
          <button
            type="button"
            className="hr-org-setup__save-btn"
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
          >
            Save
          </button>
          <button type="button" className="hr-org-setup__cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SimpleSetupTab({
  rows,
  setRows,
  storageKey,
  columnHeader,
  fieldLabel,
  placeholder,
  addTitle,
  editTitle,
  idPrefix,
  createFn,
  updateFn,
  addSuccess,
  updateSuccess,
  localSuccess,
}) {
  const { addToast } = useToast();
  const [panelMode, setPanelMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const openAdd = () => {
    setEditingId(null);
    setEditName("");
    setPanelMode("add");
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setEditName(row.name);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setEditingId(null);
  };

  const persist = (next) => {
    setRows(next);
  };

  const handleSave = async (name) => {
    if (panelMode === "edit" && editingId) {
      const next = rows.map((row) => (
        row.id === editingId
          ? {
              ...row,
              name,
              updated_by_name: CREATED_BY.name,
              updated_by_date: CREATED_BY.date,
            }
          : row
      ));
      try {
        await updateFn(editingId, { name });
        persist(next);
        addToast(updateSuccess, "success");
      } catch {
        addToast(updateSuccess.replace("updated", "update failed").replace("Updated", "Update failed"), "error");
      }
    } else {
      try {
        const res = await createFn({ name });
        const row = res?.data || {
          id: `${idPrefix}-${Date.now()}`,
          name,
          created_by_name: null,
          created_by_date: null,
          updated_by_name: null,
          updated_by_date: null,
        };
        persist([row, ...rows]);
        addToast(addSuccess, "success");
      } catch {
        addToast(addSuccess.replace("added", "add failed").replace("Added", "Add failed"), "error");
      }
    }
    closePanel();
  };

  return (
    <>
      <div className="hr-org-setup__toolbar">
        <button type="button" className="hr-org-setup__add-btn" onClick={openAdd} aria-label={`Add ${columnHeader.toLowerCase()}`}>
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {panelMode && (
        <SimpleSetupPanel
          mode={panelMode}
          title={panelMode === "edit" ? editTitle : addTitle}
          fieldLabel={fieldLabel}
          placeholder={placeholder}
          initialName={editName}
          onClose={closePanel}
          onSave={handleSave}
        />
      )}

      <div className="hr-org-setup__table-wrap">
        <table className="hr-org-setup__table">
          <thead>
            <tr>
              <th>Sr. No</th>
              <th>{columnHeader}</th>
              <th>Created By</th>
              <th>Updated By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="hr-org-setup__sr">{index + 1}.</td>
                <td>{row.name}</td>
                <td><MetaCell name={row.created_by_name} date={row.created_by_date} /></td>
                <td><MetaCell name={row.updated_by_name} date={row.updated_by_date} /></td>
                <td>
                  <button type="button" className="hr-org-setup__edit-btn" onClick={() => openEdit(row)} aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function OrganizationSetup() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("leave-types");
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [branches, setBranches] = useState([]);
  const [geoFencing, setGeoFencing] = useState([]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [
        leaveRes,
        desRes,
        deptRes,
        empRes,
        expRes,
        branchRes,
        geoRes,
      ] = await Promise.all([
        getLeaveTypes(),
        getOrgDesignations(),
        getOrgDepartments(),
        getOrgEmploymentTypes(),
        getOrgExpenseCategories(),
        getOrgBranches(),
        getOrgGeoFencing(),
      ]);
      const leaveRows = leaveRes?.data?.items || leaveRes?.data || [];
      const desRows = desRes?.data?.items || desRes?.data || [];
      const deptRows = deptRes?.data?.items || deptRes?.data || [];
      const empRows = empRes?.data?.items || empRes?.data || [];
      const expRows = expRes?.data?.items || expRes?.data || [];
      const branchRows = branchRes?.data?.items || branchRes?.data || [];
      const geoRows = geoRes?.data?.items || geoRes?.data || [];
      setLeaveTypes(Array.isArray(leaveRows) ? leaveRows : []);
      setDesignations(Array.isArray(desRows) ? desRows : []);
      setDepartments(Array.isArray(deptRows) ? deptRows : []);
      setEmploymentTypes(Array.isArray(empRows) ? empRows : []);
      setExpenseCategories(Array.isArray(expRows) ? expRows : []);
      setBranches(Array.isArray(branchRows) ? branchRows : []);
      setGeoFencing(Array.isArray(geoRows) ? geoRows : []);
    } catch {
      setLeaveTypes([]);
      setDesignations([]);
      setDepartments([]);
      setEmploymentTypes([]);
      setExpenseCategories([]);
      setBranches([]);
      setGeoFencing([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader label="Loading organization setup..." />;

  return (
    <ListPageShell>
      <div className="hr-org-setup min-w-0">
        <h1 className="hr-org-setup__title">Organization Setup</h1>

        <div className="hr-org-setup__tabs">
          {SETUP_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`hr-org-setup__tab ${active ? "hr-org-setup__tab--active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === "leave-types" && (
          <LeaveTypesTab rows={leaveTypes} setRows={setLeaveTypes} />
        )}
        {activeTab === "designations" && (
          <SimpleSetupTab
            rows={designations}
            setRows={setDesignations}
            storageKey={DESIGNATIONS_KEY}
            columnHeader="Designation"
            fieldLabel="Designation"
            placeholder="Enter designation"
            addTitle="Add Designation"
            editTitle="Edit Designation"
            idPrefix="des"
            createFn={createOrgDesignation}
            updateFn={updateOrgDesignation}
            addSuccess="Designation added"
            updateSuccess="Designation updated"
            localSuccess="Designation saved locally"
          />
        )}
        {activeTab === "departments" && (
          <SimpleSetupTab
            rows={departments}
            setRows={setDepartments}
            storageKey={DEPARTMENTS_KEY}
            columnHeader="Department"
            fieldLabel="Department Name"
            placeholder="Enter your department"
            addTitle="Add Department"
            editTitle="Edit Department"
            idPrefix="dept"
            createFn={createOrgDepartment}
            updateFn={updateOrgDepartment}
            addSuccess="Department added"
            updateSuccess="Department updated"
            localSuccess="Department saved locally"
          />
        )}
        {activeTab === "employment-types" && (
          <SimpleSetupTab
            rows={employmentTypes}
            setRows={setEmploymentTypes}
            storageKey={EMPLOYMENT_TYPES_KEY}
            columnHeader="Employment Type"
            fieldLabel="Employment Type"
            placeholder="Enter employment type"
            addTitle="Add Employment Type"
            editTitle="Edit Employment Type"
            idPrefix="emp"
            createFn={createOrgEmploymentType}
            updateFn={updateOrgEmploymentType}
            addSuccess="Employment type added"
            updateSuccess="Employment type updated"
            localSuccess="Employment type saved locally"
          />
        )}
        {activeTab === "expense-settings" && (
          <ExpenseSettingsTab rows={expenseCategories} setRows={setExpenseCategories} />
        )}
        {activeTab === "branches" && (
          <BranchesTab rows={branches} setRows={setBranches} />
        )}
        {activeTab === "geo-fencing" && (
          <GeoFencingTab rows={geoFencing} setRows={setGeoFencing} branches={branches} />
        )}
      </div>
    </ListPageShell>
  );
}
