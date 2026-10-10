import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileSearch, Info, Search } from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import { ListPageShell } from "../../components/common/ListPageShell";
import { useToast } from "../../context/ToastContext";
import usePageRefresh from "../../hooks/usePageRefresh";
import { getEmployeesEnriched } from "../../api/hrApi";
import "./attendanceSettings.css";

const TABS = [
  { id: "configure", label: "Configure Attendance" },
  { id: "exemption", label: "Attendance Exemption" },
  { id: "overtime", label: "Configure Overtime" },
];

const SHIFT_OPTIONS = ["Select Shift", "General", "Night Shift", "Morning Shift"];
const EMPLOYMENT_OPTIONS = ["Select Employment Type", "Full Time", "Part Time", "Contract"];
const LATE_OPTIONS = ["Absent-Half Day", "Absent-Full Day", "Late Mark"];

const DEMO_EMPLOYEE = { id: "demo", employee_id: "G1234", full_name: "Satish Gogulothu", name: "Satish Gogulothu" };

function EmptyPanel({ message }) {
  return (
    <div className="hr-att-settings__empty">
      <div className="hr-att-settings__empty-icon">
        <FileSearch className="h-10 w-10" strokeWidth={1.5} />
      </div>
      <p className="hr-att-settings__empty-text">{message}</p>
    </div>
  );
}

function DurationPair({ label, hours, minutes, onHoursChange, onMinutesChange }) {
  return (
    <div className="hr-att-settings__time-card">
      <p>{label}</p>
      <div className="hr-att-settings__duration-inputs">
        <input type="text" inputMode="numeric" maxLength={2} value={hours} onChange={(e) => onHoursChange(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="00" />
        <span>Hrs</span>
        <input type="text" inputMode="numeric" maxLength={2} value={minutes} onChange={(e) => onMinutesChange(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="00" />
        <span>Min</span>
      </div>
    </div>
  );
}

function ConfigureAttendanceTab({ onSave }) {
  const [setupOption, setSetupOption] = useState(1);
  const [shift, setShift] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [maxLateH, setMaxLateH] = useState("00");
  const [maxLateM, setMaxLateM] = useState("00");
  const [maxEarlyH, setMaxEarlyH] = useState("00");
  const [maxEarlyM, setMaxEarlyM] = useState("00");
  const [fullDayH, setFullDayH] = useState("00");
  const [fullDayM, setFullDayM] = useState("00");
  const [halfDayH, setHalfDayH] = useState("00");
  const [halfDayM, setHalfDayM] = useState("00");
  const [lateMode, setLateMode] = useState("each");
  const [lateRule, setLateRule] = useState("Absent-Half Day");
  const [monthOccurrence, setMonthOccurrence] = useState("00");
  const [recurringOccurrence, setRecurringOccurrence] = useState("00");
  const [considerShiftHours, setConsiderShiftHours] = useState(false);
  const [configured, setConfigured] = useState(false);

  const note =
    setupOption === 1
      ? "Note: these attendance settings are applicable only on working days and will not be applied on weekends, holidays and leave."
      : "Note: This option allow to set the maximum working hours that qualify an employee as present for a Half-day or Full-day. This setting will not be applied on weekend, holiday and leave.";

  const handleSave = () => {
    setConfigured(true);
    onSave("Attendance settings saved");
  };

  return (
    <div className="hr-att-settings__grid">
      <div className="hr-att-settings__panel">
        <div className="hr-att-settings__setup-toggle">
          <button
            type="button"
            className={`hr-att-settings__setup-btn ${setupOption === 1 ? "hr-att-settings__setup-btn--active" : ""}`}
            onClick={() => setSetupOption(1)}
          >
            Setup Option 1
          </button>
          <button
            type="button"
            className={`hr-att-settings__setup-btn ${setupOption === 2 ? "hr-att-settings__setup-btn--active" : ""}`}
            onClick={() => setSetupOption(2)}
          >
            Setup Option 2
          </button>
        </div>

        <h2 className="hr-att-settings__panel-title">Configure Settings for Attendance</h2>
        <p className="hr-att-settings__panel-note">{note}</p>

        <div className="hr-att-settings__two-col">
          <div className="hr-att-settings__field">
            <label className="hr-att-settings__label">Shift <span>*</span></label>
            <select className="hr-att-settings__select" value={shift} onChange={(e) => setShift(e.target.value)}>
              {SHIFT_OPTIONS.map((opt) => (
                <option key={opt} value={opt === "Select Shift" ? "" : opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="hr-att-settings__field">
            <label className="hr-att-settings__label">Employment type</label>
            <select className="hr-att-settings__select" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {EMPLOYMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt === "Select Employment Type" ? "" : opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {setupOption === 1 ? (
          <>
            <p className="hr-att-settings__section-title">Time Limits</p>
            <div className="hr-att-settings__time-box-wrap">
              <DurationPair label="Maximum late Check-in allowed" hours={maxLateH} minutes={maxLateM} onHoursChange={setMaxLateH} onMinutesChange={setMaxLateM} />
              <DurationPair label="Maximum early Check-out allowed" hours={maxEarlyH} minutes={maxEarlyM} onHoursChange={setMaxEarlyH} onMinutesChange={setMaxEarlyM} />
            </div>

            <p className="hr-att-settings__section-title" style={{ marginTop: 16 }}>Mark late attendance</p>
            <div className="hr-att-settings__radio-box">
              <label className="hr-att-settings__radio-row">
                <input type="radio" name="late-mode" checked={lateMode === "each"} onChange={() => setLateMode("each")} />
                <span>For each occurrence</span>
                <select value={lateRule} onChange={(e) => setLateRule(e.target.value)}>
                  {LATE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
              <label className="hr-att-settings__radio-row">
                <input type="radio" name="late-mode" checked={lateMode === "month"} onChange={() => setLateMode("month")} />
                <span>For</span>
                <input type="text" inputMode="numeric" maxLength={2} value={monthOccurrence} onChange={(e) => setMonthOccurrence(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                <span>allowed occurrence in a calendar month</span>
              </label>
              <label className="hr-att-settings__radio-row">
                <input type="radio" name="late-mode" checked={lateMode === "recurring"} onChange={() => setLateMode("recurring")} />
                <span>Mark late attendance after</span>
                <input type="text" inputMode="numeric" maxLength={2} value={recurringOccurrence} onChange={(e) => setRecurringOccurrence(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                <span>occurrence (Recurring Cycle)</span>
              </label>
            </div>

            <div className="hr-att-settings__field" style={{ marginTop: 16 }}>
              <label className="hr-att-settings__checkbox-row">
                <input type="checkbox" checked={considerShiftHours} onChange={(e) => setConsiderShiftHours(e.target.checked)} />
                <span>Consider completed shift hours</span>
              </label>
              <p className="hr-att-settings__checkbox-note">
                When this option is checked, late attendance will not be marked if the user fulfills the required shift duration.
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="hr-att-settings__section-title">Time Limits</p>
            <div className="hr-att-settings__time-box-wrap">
              <DurationPair label="Full-Day Attendance" hours={fullDayH} minutes={fullDayM} onHoursChange={setFullDayH} onMinutesChange={setFullDayM} />
              <DurationPair label="Half-Day Attendance" hours={halfDayH} minutes={halfDayM} onHoursChange={setHalfDayH} onMinutesChange={setHalfDayM} />
            </div>
          </>
        )}

        <div className="hr-att-settings__actions">
          <button
            type="button"
            className="hr-att-settings__btn-outline"
            onClick={() => {
              setShift("");
              setEmploymentType("");
              setMaxLateH("00");
              setMaxLateM("00");
              setMaxEarlyH("00");
              setMaxEarlyM("00");
              setFullDayH("00");
              setFullDayM("00");
              setHalfDayH("00");
              setHalfDayM("00");
              setConsiderShiftHours(false);
              onSave("Form reset to defaults");
            }}
          >
            Cancel
          </button>
          <button type="button" className="hr-att-settings__btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      <div className="hr-att-settings__panel p-0">
        {configured ? (
          <div className="p-6">
            <p className="text-sm font-semibold text-[#1e293b]">Configured Settings</p>
            <p className="mt-2 text-sm text-[#64748b]">Setup Option {setupOption}</p>
            {shift ? <p className="text-sm text-[#64748b]">Shift: {shift}</p> : null}
          </div>
        ) : (
          <EmptyPanel message="No attendance configured" />
        )}
      </div>
    </div>
  );
}

function ExemptionTab({ employees, onSave }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({});
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = employees.map((emp) => ({
      id: emp.employee_id || emp.employee_code || String(emp.id),
      name: emp.full_name || emp.name || "Employee",
    }));
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, search]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selected[e.id]);

  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const next = {};
      filtered.forEach((e) => { next[e.id] = true; });
      setSelected(next);
    }
  };

  return (
    <div className="hr-att-settings__exemption">
      <h2 className="hr-att-settings__panel-title">Attendance Exemption</h2>
      <p className="hr-att-settings__panel-note" style={{ color: "#64748b", fontSize: "13px" }}>
        Select employees whose attendance records will be excluded and considered as present
      </p>

      <div className="hr-att-settings__exemption-toolbar">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search employees..."
          aria-label="Search employees for attendance exemption"
        />
        <label className="flex items-center gap-2 text-sm text-[#374151]">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-[#2563eb]" />
          Select all employees on this page
        </label>
      </div>

      <div className="hr-att-settings__list-box">
        {filtered.map((emp) => (
          <label key={emp.id} className="hr-att-settings__list-item cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(selected[emp.id])}
              onChange={() => setSelected((prev) => ({ ...prev, [emp.id]: !prev[emp.id] }))}
              className="accent-[#2563eb]"
            />
            {emp.name}
          </label>
        ))}

        <div className="hr-att-settings__list-footer">
          <div className="flex items-center gap-2">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded border border-[#e5e7eb] px-2 py-1 text-xs"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>Entries</span>
          </div>
          <span>
            Showing {filtered.length ? 1 : 0} to {filtered.length} of {filtered.length} entries
          </span>
          <div className="flex items-center gap-1">
            <button type="button" className="hr-att-settings__page-btn" aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" className="hr-att-settings__page-btn hr-att-settings__page-btn--active">1</button>
            <button type="button" className="hr-att-settings__page-btn" aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="hr-att-settings__footer-actions" style={{ paddingLeft: 0, paddingRight: 0, borderTop: 0 }}>
        <button
          type="button"
          className="hr-att-settings__btn-outline"
          onClick={() => {
            setSelected({});
            onSave("Exemption selections cleared");
          }}
        >
          Cancel
        </button>
        <button type="button" className="hr-att-settings__btn-primary" onClick={() => onSave("Exemption settings saved")}>Save</button>
      </div>
    </div>
  );
}

function ConfigureOvertimeTab({ onSave }) {
  const [otHours, setOtHours] = useState("00");
  const [otMinutes, setOtMinutes] = useState("00");
  const [weekOff, setWeekOff] = useState(false);
  const [holidays, setHolidays] = useState(false);
  const [workingDays, setWorkingDays] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [configured, setConfigured] = useState(false);

  const handleSave = () => {
    setConfigured(true);
    onSave("Overtime settings saved");
  };

  return (
    <div className="hr-att-settings__grid">
      <div className="hr-att-settings__panel">
        <h2 className="hr-att-settings__panel-title">Configure Overtime</h2>
        <p className="hr-att-settings__panel-note" style={{ color: "#64748b", fontSize: "13px" }}>
          Set Overtime for your Organization
        </p>

        <p className="hr-att-settings__section-title">Set the minimum overtime hours for capture</p>
        <div className="hr-att-settings__duration-inputs mb-2">
          <input type="text" inputMode="numeric" maxLength={2} value={otHours} onChange={(e) => setOtHours(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="00" className="w-12 rounded border border-[#e5e7eb] px-2 py-1.5 text-center text-sm" />
          <span>Hrs</span>
          <input type="text" inputMode="numeric" maxLength={2} value={otMinutes} onChange={(e) => setOtMinutes(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="00" className="w-12 rounded border border-[#e5e7eb] px-2 py-1.5 text-center text-sm" />
          <span>Min</span>
        </div>
        <p className="hr-att-settings__info mb-4">
          <Info className="h-3.5 w-3.5" />
          Any overtime within the minimum limit set or more than that will be considered.
        </p>

        <p className="hr-att-settings__section-title">Choose when overtime applies</p>
        <div className="hr-att-settings__checkbox-list">
          <label>
            <input type="checkbox" checked={weekOff} onChange={(e) => setWeekOff(e.target.checked)} />
            <span>Week-Off</span>
          </label>
          <label>
            <input type="checkbox" checked={holidays} onChange={(e) => setHolidays(e.target.checked)} />
            <span>Holidays</span>
          </label>
          <label>
            <input type="checkbox" checked={workingDays} onChange={(e) => setWorkingDays(e.target.checked)} />
            <span className="flex flex-wrap items-center gap-1">
              Working Days
              <span className="hr-att-settings__info">
                <Info className="h-3.5 w-3.5" />
                After shift hours, overtime will be considered.
              </span>
            </span>
          </label>
          <label>
            <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
            <span>Enable auto-approval for overtime requests by selecting this checkbox.</span>
          </label>
        </div>

        <div className="hr-att-settings__actions">
          <button type="button" className="hr-att-settings__btn-primary" onClick={handleSave}>Save</button>
          <button
            type="button"
            className="hr-att-settings__btn-outline"
            onClick={() => {
              setOtHours("00");
              setOtMinutes("00");
              setWeekOff(false);
              setHolidays(false);
              setWorkingDays(false);
              setAutoApprove(false);
              onSave("Overtime settings reset to defaults");
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="hr-att-settings__panel p-0">
        {configured ? (
          <div className="p-6">
            <p className="text-sm font-semibold text-[#1e293b]">Overtime Configured</p>
            <p className="mt-2 text-sm text-[#64748b]">Minimum: {otHours}h {otMinutes}m</p>
          </div>
        ) : (
          <EmptyPanel message="No overtime configured" />
        )}
      </div>
    </div>
  );
}

export default function AttendanceSettings() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("configure");
  const [employees, setEmployees] = useState([]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const empRes = await getEmployeesEnriched();
      const empList = empRes?.data || [];
      setEmployees(empList);
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const handleSave = (message) => {
    addToast(message, "success");
  };

  if (loading) return <Loader label="Loading attendance settings..." />;

  return (
    <ListPageShell>
      <div className="hr-att-settings min-w-0">
        <div className="rounded-t-[10px] border border-b-0 border-[#e5e7eb] bg-white">
          <div className="hr-att-settings__tabs px-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`hr-att-settings__tab ${activeTab === tab.id ? "hr-att-settings__tab--active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hr-att-settings__shell">
          {activeTab === "configure" ? <ConfigureAttendanceTab onSave={handleSave} /> : null}
          {activeTab === "exemption" ? <ExemptionTab employees={employees} onSave={handleSave} /> : null}
          {activeTab === "overtime" ? <ConfigureOvertimeTab onSave={handleSave} /> : null}
        </div>
      </div>
    </ListPageShell>
  );
}
