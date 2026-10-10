import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Info,
  Pencil,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  deletePayrollSchedule,
  generateTallyApiKey,
  getPayrollSettings,
  getTallyConfig,
  savePayrollSchedule,
  saveTallyConfig,
} from "../../api/hrApi";
import "./payrollSettings.css";

const TABS = [
  { key: "payroll", label: "Payroll Settings" },
  { key: "tally", label: "Tally Configuration" },
];

const EMPLOYMENT_OPTIONS = [
  { value: "all", label: "All Employment Type" },
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
];

const DEMO_EMPLOYEES = [
  { id: "demo-satish", name: "Satish Gogulothu" },
];

const DEFAULT_SCHEDULES = [
  {
    id: "schedule-default",
    employment_type: "all",
    employment_type_label: "All Employment Type",
    schedule_mode: "last_working_day",
    from_date: 20,
    to_date: 19,
    employee_count: 1,
    employees: DEMO_EMPLOYEES,
  },
];

const DEFAULT_TALLY = {
  serial_number: "",
  mobile_number: "",
  api_key: "",
};

function scheduleLabel(schedule) {
  if (schedule.schedule_mode === "customize") {
    return `From ${schedule.from_date} to ${schedule.to_date}`;
  }
  return "Last working day of the month";
}

function calcToDate(fromDate) {
  const n = Number(fromDate) || 1;
  return n === 1 ? 31 : n - 1;
}

function ViewEmployeesDrawer({ open, onClose, employees }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length ? (currentPage - 1) * pageSize + 1 : 0;
  const to = Math.min(currentPage * pageSize, filtered.length);

  if (!open) return null;

  const drawer = (
    <div className="hr-payroll-settings__overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="View Employees">
      <div className="hr-payroll-settings__employee-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-payroll-settings__employee-header">
          <h2>View Employees</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="hr-payroll-settings__employee-search-wrap">
          <Search className="h-4 w-4" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search for employee"
          />
        </div>
        <div className="hr-payroll-settings__employee-list">
          {paged.length === 0 ? (
            <p className="hr-payroll-settings__employee-empty">No employees found</p>
          ) : (
            paged.map((emp) => (
              <div key={emp.id} className="hr-payroll-settings__employee-row">
                <div className="hr-payroll-settings__employee-avatar">
                  <User className="h-4 w-4" />
                </div>
                <span>{emp.name}</span>
              </div>
            ))
          )}
        </div>
        <div className="hr-payroll-settings__employee-footer">
          <span>{from}-{to} of {filtered.length}</span>
          <div className="hr-payroll-settings__employee-pager">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="hr-payroll-settings__employee-page-num">{currentPage}</span>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}

export default function PayrollSettings() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("payroll");
  const [schedules, setSchedules] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [employeeDrawer, setEmployeeDrawer] = useState(null);

  const [scheduleMode, setScheduleMode] = useState("last_working_day");
  const [fromDate, setFromDate] = useState(20);
  const [employmentType, setEmploymentType] = useState("all");

  const [tallyForm, setTallyForm] = useState(DEFAULT_TALLY);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [settingsRes, tallyRes] = await Promise.all([
        getPayrollSettings(),
        getTallyConfig(),
      ]);
      const rows = settingsRes?.data?.schedules || settingsRes?.data || [];
      setSchedules(Array.isArray(rows) ? rows : []);
      setTallyForm(
        tallyRes?.data && typeof tallyRes.data === "object" && Object.keys(tallyRes.data).length
          ? { ...DEFAULT_TALLY, ...tallyRes.data }
          : DEFAULT_TALLY
      );
    } catch {
      setSchedules([]);
      setTallyForm(DEFAULT_TALLY);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setScheduleMode("last_working_day");
    setFromDate(20);
    setEmploymentType("all");
  };

  const startEdit = (schedule) => {
    setEditingId(schedule.id);
    setScheduleMode(schedule.schedule_mode);
    setFromDate(schedule.from_date || 20);
    setEmploymentType(schedule.employment_type);
  };

  const handleSaveSchedule = async () => {
    const empLabel = EMPLOYMENT_OPTIONS.find((o) => o.value === employmentType)?.label || "All Employment Type";
    const payload = {
      id: editingId || `schedule-${Date.now()}`,
      employment_type: employmentType,
      employment_type_label: empLabel,
      schedule_mode: scheduleMode,
      from_date: fromDate,
      to_date: calcToDate(fromDate),
      employee_count: DEMO_EMPLOYEES.length,
      employees: DEMO_EMPLOYEES,
    };

    try {
      await savePayrollSchedule(payload);
      addToast(editingId ? "Pay schedule updated" : "Pay schedule saved", "success");
      resetForm();
      await load(true);
    } catch {
      addToast("Failed to save pay schedule", "error");
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await deletePayrollSchedule(id);
      addToast("Pay schedule deleted", "success");
      if (editingId === id) resetForm();
      await load(true);
    } catch {
      addToast("Failed to delete pay schedule", "error");
    }
  };

  const handleSaveTally = async () => {
    const payload = { ...tallyForm };
    try {
      await saveTallyConfig(payload);
      addToast("Tally configuration saved", "success");
      await load(true);
    } catch {
      addToast("Failed to save Tally configuration", "error");
    }
  };

  const handleGenerateKey = async () => {
    try {
      const res = await generateTallyApiKey();
      const apiKey = res?.data?.api_key;
      if (apiKey) {
        setTallyForm((p) => ({ ...p, api_key: apiKey }));
      }
      addToast("API key generated", "success");
      await load(true);
    } catch {
      addToast("Failed to generate API key", "error");
    }
  };

  if (loading) return <Loader label="Loading settings..." />;

  const toDate = calcToDate(fromDate);
  const saveLabel = editingId ? "Update" : "Save";

  return (
    <ListPageShell>
      <div className="hr-payroll-settings min-w-0">
        <h1 className="hr-payroll-settings__title">Settings</h1>

        <div className="hr-payroll-settings__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`hr-payroll-settings__tab ${tab === t.key ? "hr-payroll-settings__tab--active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "payroll" ? (
          <div className="hr-payroll-settings__payroll-layout">
            <div className="hr-payroll-settings__form-card">
              <h2>Set Monthly Pay Schedule</h2>
              <p>Choose a monthly pay schedule to standardize salary disbursement and streamline processing.</p>

              <div className="hr-payroll-settings__schedule-box">
                <label className="hr-payroll-settings__radio">
                  <input
                    type="radio"
                    name="scheduleMode"
                    checked={scheduleMode === "last_working_day"}
                    onChange={() => setScheduleMode("last_working_day")}
                  />
                  <span>Last working day of the month</span>
                  <Info className="h-3.5 w-3.5 hr-payroll-settings__info" />
                </label>
                <label className="hr-payroll-settings__radio">
                  <input
                    type="radio"
                    name="scheduleMode"
                    checked={scheduleMode === "customize"}
                    onChange={() => setScheduleMode("customize")}
                  />
                  <span>Customize pay cycle</span>
                  <Info className="h-3.5 w-3.5 hr-payroll-settings__info" />
                </label>
                {scheduleMode === "customize" ? (
                  <div className="hr-payroll-settings__custom-dates">
                    <div className="hr-payroll-settings__field">
                      <label>From Date</label>
                      <select value={fromDate} onChange={(e) => setFromDate(Number(e.target.value))}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="hr-payroll-settings__field">
                      <label>To Date</label>
                      <input value={toDate} disabled readOnly />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="hr-payroll-settings__field hr-payroll-settings__field--full">
                <label>Employment Type</label>
                <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                  {EMPLOYMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="hr-payroll-settings__form-actions">
                <button type="button" className="hr-payroll-settings__cancel-btn" onClick={resetForm}>Cancel</button>
                <button type="button" className="hr-payroll-settings__save-btn" onClick={handleSaveSchedule}>{saveLabel}</button>
              </div>
            </div>

            <div className="hr-payroll-settings__cards">
              {schedules.map((schedule) => {
                const isCollapsed = collapsed[schedule.id];
                return (
                  <div key={schedule.id} className="hr-payroll-settings__summary-card">
                    <button
                      type="button"
                      className="hr-payroll-settings__summary-head"
                      onClick={() => setCollapsed((p) => ({ ...p, [schedule.id]: !p[schedule.id] }))}
                    >
                      <span>{schedule.employment_type_label}</span>
                      {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </button>
                    {!isCollapsed ? (
                      <div className="hr-payroll-settings__summary-body">
                        <div className="hr-payroll-settings__summary-row">
                          <span className="label">Monthly Pay Schedule</span>
                          <span className="value">{scheduleLabel(schedule)}</span>
                        </div>
                        <div className="hr-payroll-settings__summary-row">
                          <span className="label">No. of Employees</span>
                          <span className="value">
                            {schedule.employee_count} Employees for {schedule.employment_type_label}
                            <button
                              type="button"
                              className="hr-payroll-settings__show-list"
                              onClick={() => setEmployeeDrawer(schedule)}
                            >
                              Show List
                            </button>
                          </span>
                        </div>
                        <div className="hr-payroll-settings__summary-actions">
                          <button type="button" aria-label="Edit" onClick={() => startEdit(schedule)}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" aria-label="Delete" onClick={() => handleDeleteSchedule(schedule.id)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="hr-payroll-settings__tally-card">
            <div className="hr-payroll-settings__tally-row">
              <div className="hr-payroll-settings__field">
                <label>Tally Serial Number <span>*</span></label>
                <input
                  value={tallyForm.serial_number}
                  onChange={(e) => setTallyForm((p) => ({ ...p, serial_number: e.target.value }))}
                  placeholder="Enter Tally Serial Number"
                />
              </div>
              <div className="hr-payroll-settings__field hr-payroll-settings__field--mobile">
                <label>Mobile Number <span>*</span></label>
                <div className="hr-payroll-settings__mobile-wrap">
                  <span className="hr-payroll-settings__mobile-prefix">+91</span>
                  <input
                    value={tallyForm.mobile_number}
                    onChange={(e) => setTallyForm((p) => ({ ...p, mobile_number: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                    placeholder="Enter Mobile Number"
                  />
                  <button type="button" className="hr-payroll-settings__save-btn" onClick={handleSaveTally}>Save</button>
                </div>
              </div>
            </div>

            <div className="hr-payroll-settings__api-section">
              <label className="hr-payroll-settings__api-label">
                Organization Authentication Key (generate API key)
                {tallyForm.api_key ? (
                  <button
                    type="button"
                    className="hr-payroll-settings__copy-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(tallyForm.api_key);
                      addToast("API key copied", "success");
                    }}
                    aria-label="Copy API key"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>
              {tallyForm.api_key ? (
                <p className="hr-payroll-settings__api-key">{tallyForm.api_key}</p>
              ) : null}
              <button type="button" className="hr-payroll-settings__generate-btn" onClick={handleGenerateKey}>
                Generate
              </button>
            </div>
          </div>
        )}

        <ViewEmployeesDrawer
          open={Boolean(employeeDrawer)}
          onClose={() => setEmployeeDrawer(null)}
          employees={employeeDrawer?.employees || DEMO_EMPLOYEES}
        />
      </div>
    </ListPageShell>
  );
}
