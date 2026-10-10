import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Baby,
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  Palmtree,
  Plane,
  Sparkles,
  Umbrella,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import Loader from "../../components/common/Loader";
import DashboardReportExport from "../../components/common/DashboardReportExport";
import DashboardWelcomeBanner from "../../components/dashboard/DashboardWelcomeBanner";
import { metricExportRows } from "../../utils/dashboardExportRows";
import useAuth from "../../hooks/useAuth";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  clockIn,
  clockOut,
  getAttendanceEnriched,
  getEmployeeSummary,
  getEmployeesEnriched,
  getHRHub,
  getLeaveEnriched,
  getLeaveSummary,
  getPayrollEnriched,
  getShifts,
} from "../../api/hrApi";
import { EMPTY_HR_DASHBOARD, mergeHrDashboard } from "../../data/hrMasterData";
import {
  getCheckInSession,
  saveCheckInSession,
  saveLiveAttendanceRecord,
} from "../../utils/attendanceStorage";
import "./hrDashboard.css";

const LEAVE_TONES = {
  green: { text: "#16a34a", bg: "#dcfce7", icon: Palmtree },
  orange: { text: "#d97706", bg: "#ffedd5", icon: Sparkles },
  blue: { text: "#1d4ed8", bg: "#dbeafe", icon: CalendarDays },
  sky: { text: "#0284c7", bg: "#e0f2fe", icon: Baby },
  red: { text: "#dc2626", bg: "#fee2e2", icon: Users },
  yellow: { text: "#ca8a04", bg: "#fef9c3", icon: Plane },
};

const STAT_TONES = {
  teal: { text: "#0ca678", bg: "#e6fcf5" },
  blue: { text: "#2563eb", bg: "#edf5ff" },
  gray: { text: "#94a3b8", bg: "#f1f5f9" },
  green: { text: "#10b981", bg: "#ecfdf5" },
  pink: { text: "#f43f5e", bg: "#ffeef0" },
  sky: { text: "#0284c7", bg: "#e0f2fe" },
  success: { text: "#0ca678", bg: "#e6fcf5" },
  info: { text: "#2563eb", bg: "#edf5ff" },
  muted: { text: "#94a3b8", bg: "#f1f5f9" },
  danger: { text: "#f43f5e", bg: "#ffeef0" },
};

function DashCard({ title, action, children, bodyClassName = "", className = "" }) {
  return (
    <section className={`hr-dash-card ${className}`.trim()}>
      {title || action ? (
        <div className="hr-dash-card__header">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={`hr-dash-card__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

function MonthBadge({ children }) {
  return <span className="hr-dash-badge">{children}</span>;
}

function StatMini({ icon: Icon, label, value, tone = "info" }) {
  const colors = STAT_TONES[tone] || STAT_TONES.info;
  return (
    <div className="hr-dash-stat">
      <div className="hr-dash-stat__icon" style={{ background: colors.bg, color: colors.text }}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="hr-dash-stat__value">{value}</p>
      <p className="hr-dash-stat__label">{label}</p>
    </div>
  );
}

function formatLongDate(date = new Date()) {
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTimer(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(" : ");
}

function CheckInPanel({ user, onAttendanceChange }) {
  const { addToast } = useToast();
  const [checkedIn, setCheckedIn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startTs, setStartTs] = useState(null);
  const [isOvertime, setIsOvertime] = useState(false);

  // Restore existing check-in session for today from storage and sync with navbar
  useEffect(() => {
    const syncSession = () => {
      const session = getCheckInSession(user);
      if (session) {
        if (session.checkedIn && session.startTs) {
          setCheckedIn(true);
          setStartTs(session.startTs);
          setElapsed(Math.max(0, Math.floor((Date.now() - session.startTs) / 1000)));
          setIsOvertime(Boolean(session.isOvertime));
        } else {
          setCheckedIn(false);
          setStartTs(null);
          setElapsed(session.finalElapsed ?? 0);
          setIsOvertime(false);
        }
      } else {
        setCheckedIn(false);
        setStartTs(null);
        setElapsed(0);
        setIsOvertime(false);
      }
    };
    syncSession();
    window.addEventListener("attendance-updated", syncSession);
    return () => window.removeEventListener("attendance-updated", syncSession);
  }, [user]);

  const handleCheckIn = async () => {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const checkInTime = new Date(now).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    setCheckedIn(true);
    setStartTs(now);
    setElapsed(0);

    const empId =
      user?.employee_id ||
      user?.employee_code ||
      (user?.id ? `EMP-${String(user.id).padStart(3, "0")}` : user?.username === "admin" ? "EMP-001" : "EMP-001");
    const empName = user?.full_name || user?.name || (user?.username === "admin" ? "Admin" : "User");
    const userCompany = user?.company_name || user?.tenant_name || user?.company_id || user?.tenant_id || "";

    saveCheckInSession(
      {
        checkedIn: true,
        startTs: now,
        date: today,
        checkInTime,
        isOvertime: false,
      },
      user
    );

    const empEmail =
      user?.email ||
      user?.mail ||
      (user?.username ? `${user.username.toLowerCase()}@iva.com` : `${empName.toLowerCase().replace(/\s+/g, ".")}@iva.com`);
    const empRole =
      user?.username === "admin" || user?.role === "Admin" || user?.role_name === "Admin"
        ? "Admin"
        : user?.role_name || user?.role || "HR Manager";

    saveLiveAttendanceRecord({
      employee_id: empId,
      name: empName,
      email: empEmail,
      role: empRole,
      department: user?.department || "General",
      company: userCompany,
      record_date: today,
      check_in: checkInTime,
      check_out: null,
      working_hours: "00 hrs 00 min",
      status: "present",
    });

    try {
      await clockIn({
        employee_id: user?.employee_id || user?.id || null,
        record_date: today,
      });
    } catch {
      // Handled via local storage
    }

    addToast("Checked in successfully", "success");
    if (onAttendanceChange) onAttendanceChange();
  };

  const autoCheckedOutRef = useRef(false);

  useEffect(() => {
    autoCheckedOutRef.current = false;
  }, [startTs]);

  const handleCheckOut = useCallback(async (customElapsed) => {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const checkOutTime = new Date(now).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const finalSecs = customElapsed !== undefined ? customElapsed : elapsed;
    const SHIFT_LIMIT_SECS = 9 * 3600; // 9 hours limit

    let regularSecs = finalSecs;
    let overtimeSecs = 0;
    if (finalSecs > SHIFT_LIMIT_SECS) {
      regularSecs = SHIFT_LIMIT_SECS;
      overtimeSecs = finalSecs - SHIFT_LIMIT_SECS;
    }

    const regH = Math.floor(regularSecs / 3600);
    const regM = Math.floor((regularSecs % 3600) / 60);
    const otH = Math.floor(overtimeSecs / 3600);
    const otM = Math.floor((overtimeSecs % 3600) / 60);

    const regStr = `${String(regH).padStart(2, "0")} hrs ${String(regM).padStart(2, "0")} min`;
    const otStr = overtimeSecs > 0 ? `${String(otH).padStart(2, "0")} hrs ${String(otM).padStart(2, "0")} min` : "00 hrs 00 min";
    const formattedDuration = overtimeSecs > 0 ? `${regStr} (+ ${otStr} OT)` : regStr;

    setCheckedIn(false);
    setStartTs(null);
    setIsOvertime(false);

    const session = getCheckInSession(user);
    const checkInTime = session?.checkInTime || checkOutTime;
    const empId =
      user?.employee_id ||
      user?.employee_code ||
      (user?.id ? `EMP-${String(user.id).padStart(3, "0")}` : user?.username === "admin" ? "EMP-001" : "EMP-001");
    const empName = user?.full_name || user?.name || (user?.username === "admin" ? "Admin" : "User");
    const empEmail =
      user?.email ||
      user?.mail ||
      (user?.username ? `${user.username.toLowerCase()}@iva.com` : `${empName.toLowerCase().replace(/\s+/g, ".")}@iva.com`);
    const empRole =
      user?.username === "admin" || user?.role === "Admin" || user?.role_name === "Admin"
        ? "Admin"
        : user?.role_name || user?.role || "HR Manager";
    const userCompany = user?.company_name || user?.tenant_name || user?.company_id || user?.tenant_id || "";

    saveCheckInSession(
      {
        checkedIn: false,
        checkedOut: true,
        finalElapsed: finalSecs,
        regularSecs,
        overtimeSecs,
        date: today,
        checkInTime,
        checkOutTime,
      },
      user
    );

    saveLiveAttendanceRecord({
      employee_id: empId,
      name: empName,
      email: empEmail,
      role: empRole,
      department: user?.department || "General",
      company: userCompany,
      record_date: today,
      check_in: checkInTime,
      check_out: checkOutTime,
      working_hours: formattedDuration,
      overtime_hours: otStr,
      status: "present",
    });

    try {
      await clockOut({
        employee_id: user?.employee_id || user?.id || null,
        record_date: today,
      });
    } catch {
      // Handled via local storage
    }

    const toastMsg = overtimeSecs > 0
      ? `Shift completed (9 hrs standard shift + ${otStr} Overtime calculated)`
      : `Checked out successfully`;
    addToast(toastMsg, "success");
    if (onAttendanceChange) onAttendanceChange();
  }, [elapsed, user, addToast, onAttendanceChange]);

  // Timer tick
  useEffect(() => {
    if (!checkedIn || !startTs) return undefined;
    const id = window.setInterval(() => {
      const diff = Math.max(0, Math.floor((Date.now() - startTs) / 1000));
      setElapsed(diff);
      if (diff >= 32400 && !autoCheckedOutRef.current) {
        autoCheckedOutRef.current = true;
        handleCheckOut(diff);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [checkedIn, startTs, handleCheckOut]);

  const handleToggleOvertime = () => {
    const next = !isOvertime;
    setIsOvertime(next);
    const session = getCheckInSession() || {};
    saveCheckInSession({ ...session, isOvertime: next });
    addToast(next ? "Overtime tracking started" : "Overtime tracking ended", "info");
  };

  return (
    <DashCard
      className="h-full flex flex-col justify-between"
      action={
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#ecfeff] text-[#06b6d4] shadow-xs">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M9 9a3 3 0 0 1 6 0v2" />
            <path d="M12 14v3" />
            <path d="M8 15a4 4 0 0 0 8 0" />
          </svg>
        </div>
      }
    >
      <div className="-mt-1">
        <h3 className="hr-dash-checkin-title">Let&apos;s Get To Work</h3>
        <p className="hr-dash-checkin-date">{formatLongDate()}</p>
        <p className="hr-dash-timer">{formatTimer(elapsed)}</p>
        <div className="hr-dash-timer-bar">
          <div className={`hr-dash-timer-bar__fill ${checkedIn ? "animate-pulse" : ""}`} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            className={`hr-dash-action-btn ${checkedIn ? "hr-dash-action-btn--checkout" : "hr-dash-action-btn--checkin"}`}
            onClick={checkedIn ? handleCheckOut : handleCheckIn}
          >
            {checkedIn ? "Check Out" : "Check In"}
          </button>
          <button
            type="button"
            className={`hr-dash-action-btn hr-dash-action-btn--overtime ${isOvertime ? "hr-dash-action-btn--active-ot" : ""}`}
            onClick={handleToggleOvertime}
          >
            {isOvertime ? "Stop Over Time" : "Start Over Time"}
          </button>
        </div>
      </div>
    </DashCard>
  );
}

function DonutChart({ data, centerValue, emptyColor = "#173e73", innerRadius = 60, outerRadius = 82 }) {
  const chartData = data?.length ? data : [{ name: "Empty", value: 1, color: emptyColor }];
  return (
    <div className="relative mx-auto flex h-52 w-full max-w-[220px] items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={0}
            stroke="none"
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerValue != null ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-[#1e293b]">{centerValue}</span>
        </div>
      ) : null}
    </div>
  );
}

function CelebrationItem({ item }) {
  return (
    <li className="flex items-center gap-3 border-b border-[#e8ecf3] px-[18px] py-3 last:border-0">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e8f1ff] text-[#2563eb]">
        <Users className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#2563eb]">{item.name}</p>
        <p className="text-xs text-[#64748b]">{item.date_label}</p>
      </div>
    </li>
  );
}

function LeaveRow({ leave }) {
  const tone = LEAVE_TONES[leave.tone] || LEAVE_TONES.blue;
  const Icon = tone.icon;
  return (
    <li className="hr-dash-leave-row">
      <div className="hr-dash-leave-icon" style={{ background: tone.bg, color: tone.text }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1e293b]">{leave.label}</p>
        <p className="text-xs text-[#64748b]">Available {leave.available} Days</p>
      </div>
      <span className="hr-dash-leave-count" style={{ color: tone.text }}>
        {leave.available}
      </span>
    </li>
  );
}

function EmptyIllustration({ type }) {
  if (type === "holidays") {
    return (
      <div className="mb-3 text-5xl" aria-hidden>🏝️</div>
    );
  }
  if (type === "celebrations") {
    return (
      <div className="mb-2 flex items-center justify-center" aria-hidden>
        <svg viewBox="0 0 100 100" className="h-24 w-24">
          <circle cx="50" cy="50" r="38" fill="#5892fe" />
          <path d="M30 68 L50 42 L66 64 Z" fill="#ef4444" />
          <path d="M35 62 L43 51 L46 54 L39 65 Z" fill="#ffffff" />
          <path d="M44 67 L53 55 L56 58 L48 68 Z" fill="#ffffff" />
          <path d="M56 36 Q64 30 60 22" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M62 42 Q74 38 72 28" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M64 48 Q76 46 76 36" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="56" y1="40" x2="62" y2="30" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="64" y1="44" x2="74" y2="38" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="70" cy="30" r="2.5" fill="#f43f5e" />
          <circle cx="56" cy="20" r="2.5" fill="#fbbf24" />
          <circle cx="74" cy="42" r="2.5" fill="#38bdf8" />
          <circle cx="48" cy="26" r="2" fill="#a855f7" />
          <circle cx="70" cy="54" r="2" fill="#fbbf24" />
        </svg>
      </div>
    );
  }
  if (type === "approvals") {
    return (
      <div className="mb-3 grid h-16 w-16 place-items-center rounded-lg border border-[#e8ecf3] bg-[#f8fafc] text-[#94a3b8]" aria-hidden>
        <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none">
          <rect x="8" y="10" width="32" height="24" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 18h20M14 24h14" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="34" cy="14" r="6" fill="#ef4444" />
          <path d="M31.5 14h5M34 11.5v5" stroke="#fff" strokeWidth="1.2" />
        </svg>
      </div>
    );
  }
  if (type === "announcements") {
    return (
      <div className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#e0f2fe] text-[#0284c7]" aria-hidden>
        <svg viewBox="0 0 32 32" className="h-9 w-9" fill="currentColor">
          <path d="M6 12v8h3l5 4V8l-5 4H6zm14.5 2c0 2.1-1.2 3.9-3 4.8V22c3.3-.9 5.5-3.7 5.5-7s-2.2-6.1-5.5-7v3.2c1.8.9 3 2.7 3 4.8z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#dbeafe] text-[#2563eb]" aria-hidden>
      <svg viewBox="0 0 40 40" className="h-9 w-9" fill="none">
        <rect x="10" y="8" width="20" height="26" rx="2" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="14" width="12" height="2" fill="currentColor" />
        <rect x="14" y="19" width="8" height="2" fill="currentColor" />
        <circle cx="28" cy="12" r="5" fill="#ef4444" />
        <path d="M26 12h4M28 10v4" stroke="#fff" strokeWidth="1.2" />
      </svg>
    </div>
  );
}

export default function HRDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(EMPTY_HR_DASHBOARD);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setLoading(true);
    try {
      const results = await Promise.allSettled([
        getHRHub(),
        getEmployeeSummary(),
        getLeaveSummary(),
        getLeaveEnriched(),
        getShifts(),
        getPayrollEnriched(),
        getEmployeesEnriched(),
        getAttendanceEnriched(),
      ]);
      const pick = (idx) => (results[idx].status === "fulfilled" ? results[idx].value.data : null);
      setData(
        mergeHrDashboard({
          hub: pick(0) || {},
          empSummary: pick(1) || {},
          leaveSummary: pick(2) || {},
          leaves: pick(3) || [],
          shifts: pick(4) || [],
          payrollRows: pick(5) || [],
          employees: pick(6) || [],
          attendanceRows: pick(7) || [],
        })
      );
    } catch (err) {
      if (isRefresh) throw err;
      setData(EMPTY_HR_DASHBOARD);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const userName = user?.full_name || user?.name || "Satish Gogulothu";

  const overallChart = useMemo(() => {
    const hired = data.hired_total || 0;
    const exits = data.exits_total || 0;
    if (!hired && !exits) return [{ name: "Employees", value: 1, color: "#164e96" }];
    const items = [];
    if (hired > 0) items.push({ name: "Hired", value: hired, color: "#164e96" });
    if (exits > 0) items.push({ name: "Exits", value: exits, color: "#93c5fd" });
    return items.length ? items : [{ name: "Employees", value: 1, color: "#164e96" }];
  }, [data.hired_total, data.exits_total]);

  const expenseChart = useMemo(
    () => (data.expense_categories || []).filter((c) => c.value > 0),
    [data.expense_categories]
  );

  const hrExportRows = metricExportRows([
    { label: "Active employees", value: data.active_employees },
    { label: "Hired this month", value: data.hired_month },
    { label: "Exits this month", value: data.exits_month },
    { label: "On leave today", value: data.on_leave_today },
    { label: "Pending leave requests", value: data.pending_leave_requests },
    { label: "Open positions", value: data.open_positions },
  ]);

  return (
    <div className="hr-dashboard ui-page ui-stack min-w-0 space-y-4">
      <div className="flex justify-end">
        <DashboardReportExport
          title="HR Dashboard"
          filename="hr-dashboard"
          rows={hrExportRows}
          module="hr"
        />
      </div>
      {/* Row 1: Welcome Banner (2 cols) & Check In / Let's Get To Work (1 col) */}
      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        <div className="lg:col-span-2 flex flex-col">
          <DashboardWelcomeBanner name={userName} className="h-full" />
        </div>
        <div className="lg:col-span-1 flex flex-col">
          <CheckInPanel user={user} onAttendanceChange={() => load(true)} />
        </div>
      </div>

      {/* Row 2: 3 Columns matching reference screenshot */}
      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        {/* Column 1: Employee Analytics & Today */}
        <div className="flex flex-col gap-4">
          <DashCard title="Employee Analytics" action={<MonthBadge>{data.analytics_month_label || "Sep – 2026"}</MonthBadge>}>
            <div className="grid grid-cols-3 gap-2.5">
              <StatMini icon={Users} label="Active" value={data.active_employees ?? 1} tone="teal" />
              <StatMini icon={UserCheck} label="Hired" value={data.hired_month ?? 1} tone="blue" />
              <StatMini icon={UserMinus} label="Exits" value={data.exits_month ?? 0} tone="gray" />
            </div>
          </DashCard>

          <DashCard action={<MonthBadge>Today</MonthBadge>}>
            <div className="grid grid-cols-3 gap-2.5">
              <StatMini icon={UserCheck} label="Present" value={data.present_today ?? 1} tone="green" />
              <StatMini icon={Users} label="Absent" value={data.absent_today ?? 0} tone="pink" />
              <StatMini icon={Umbrella} label="On leave" value={data.on_leave_today ?? 0} tone="sky" />
            </div>
          </DashCard>
        </div>

        {/* Column 2: Celebration Corner */}
        <DashCard
          title="Celebration Corner"
          className="flex flex-col h-full"
          bodyClassName="flex-1 flex flex-col justify-center items-center p-6 min-h-[260px]"
        >
          {(data.celebrations || []).length ? (
            <ul className="w-full max-h-[320px] overflow-y-auto">
              {data.celebrations.map((item) => (
                <CelebrationItem key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <div className="hr-dash-empty my-auto flex flex-col items-center justify-center text-center">
              <EmptyIllustration type="celebrations" />
              <p className="mt-1 text-sm font-medium text-[#64748b]">No Celebrations Found</p>
            </div>
          )}
        </DashCard>

        {/* Column 3: Overall Employees */}
        <DashCard
          title="Overall Employees"
          className="flex flex-col h-full"
          bodyClassName="flex-1 flex flex-col justify-center items-center p-6 min-h-[260px]"
        >
          <DonutChart
            data={overallChart}
            centerValue={data.overall_employees ?? 1}
            emptyColor="#173e73"
            outerRadius={82}
            innerRadius={60}
          />
        </DashCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DashCard title="Upcoming Holidays">
          {(data.upcoming_holidays || []).length ? (
            <ul className="space-y-2">
              {data.upcoming_holidays.map((h) => (
                <li key={h.id} className="text-sm text-[#64748b]">{h.name} — {h.date}</li>
              ))}
            </ul>
          ) : (
            <div className="hr-dash-empty py-8">
              <EmptyIllustration type="holidays" />
              <p>No Holidays Found</p>
            </div>
          )}
        </DashCard>

        <DashCard title="Shift Schedule">
          {data.shift_schedule ? (
            <div className="flex gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#dbeafe] text-sm font-bold text-[#2563eb]">
                {data.shift_schedule.initial}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[#1e293b]">{data.shift_schedule.name}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-[#64748b]">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  {data.shift_schedule.date_range}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#64748b]">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  {data.shift_schedule.time_range}
                </p>
              </div>
            </div>
          ) : (
            <p className="hr-dash-empty py-6">No shift assigned</p>
          )}
        </DashCard>

        <DashCard title="Total Expenses" bodyClassName="md:col-span-2 xl:col-span-1">
          <DonutChart
            data={expenseChart}
            centerValue={`₹ ${Number(data.expense_total).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            emptyColor="#c7d2fe"
          />
        </DashCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashCard title="My Leaves" bodyClassName="hr-dash-card__body--flush p-0">
          <ul className="hr-dash-leaves-scroll">
            {(data.my_leaves || []).map((leave) => (
              <LeaveRow key={leave.key} leave={leave} />
            ))}
          </ul>
        </DashCard>

        <DashCard title="Approval Requests">
          {(data.approval_requests || []).length ? (
            <ul className="divide-y divide-[#e8ecf3]">
              {data.approval_requests.map((req) => (
                <li key={req.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e8f1ff] text-xs font-semibold text-[#2563eb]">
                    {(req.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1e293b]">{req.name}</p>
                    <p className="text-xs text-[#64748b]">{req.date_label}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="hr-dash-empty py-10">
              <EmptyIllustration type="approvals" />
              <p>No Approval Requests</p>
            </div>
          )}
        </DashCard>

        <DashCard title="Announcements">
          {(data.announcements || []).length ? (
            <ul className="divide-y divide-[#e8ecf3]">
              {data.announcements.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-[#2563eb]">{item.title}</p>
                  <p className="text-xs text-[#64748b]">{item.date}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="hr-dash-empty py-10">
              <EmptyIllustration type="announcements" />
              <p>No Announcements Found</p>
            </div>
          )}
        </DashCard>
      </div>

      <DashCard title="Payslips" bodyClassName="max-w-md">
        {(data.payslips || []).length ? (
          <ul className="space-y-2">
            {data.payslips.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-[#64748b]">{p.period}</span>
                <span className="font-semibold tabular-nums text-[#1e293b]">
                  ₹ {Number(p.amount).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="hr-dash-empty py-10">
            <EmptyIllustration type="payslips" />
            <p>No Payslips Found</p>
          </div>
        )}
      </DashCard>
    </div>
  );
}
