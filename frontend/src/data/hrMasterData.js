/** HR helpers and empty dashboard shells. */

export const HR_FLOW = [
  "Employee Joining", "Department Allocation", "Shift Assignment", "Attendance",
  "Production Allocation", "Performance", "Leave", "Payroll", "Exit Process",
];

export const LEAVE_TYPES = ["casual", "sick", "earned", "comp_off", "maternity", "paternity", "lop"];
export const SHIFTS = ["Morning", "General", "Evening", "Night", "Rotational"];
export const EMPLOYMENT_TYPES = ["permanent", "contract", "temporary", "intern"];
export const DEPARTMENT_COLORS = {
  Production: "bg-blue-100 text-blue-800",
  Quality: "bg-purple-100 text-purple-800",
  Maintenance: "bg-orange-100 text-orange-800",
  Stores: "bg-teal-100 text-[var(--color-success)]",
  HR: "bg-pink-100 text-pink-800",
  Finance: "bg-indigo-100 text-indigo-800",
};

export const DEMO_EMP_SUMMARY = {
  total_employees: 0, present_today: 0, absent: 0, on_leave: 0,
  overtime: 0, departments: 0, contract_employees: 0, new_joiners: 0,
};

export const DEMO_EMP_LIST = [];

export const DEMO_ATT_SUMMARY = { present: 0, absent: 0, late: 0, half_day: 0, overtime: 0, night_shift: 0, total_working_hours: 0 };
export const DEMO_ATT_LIST = [];

export const ATTENDANCE_STATUS_COLORS = {
  present: { fill: "#22c55e", label: "Present", badge: "bg-emerald-50 text-emerald-700" },
  late: { fill: "#f97316", label: "Late", badge: "bg-orange-50 text-orange-700" },
  absent: { fill: "#ef4444", label: "Absent", badge: "bg-red-50 text-red-700" },
  on_leave: { fill: "#3b82f6", label: "On Leave", badge: "bg-blue-50 text-blue-700" },
  leave: { fill: "#3b82f6", label: "On Leave", badge: "bg-blue-50 text-blue-700" },
  holiday: { fill: "#94a3b8", label: "Holiday", badge: "bg-slate-100 text-slate-600" },
};

export const EMPTY_ATTENDANCE_DASHBOARD = {total_employees: 0, present_today: 0, on_leave: 0, late_today: 0, absent_today: 0,
  kpi_trends: {}, summary_slices: [], attendance_pct: 0, today_overview: [], records: [], calendar_marks: {},};
export const DEMO_ATTENDANCE_DASHBOARD = EMPTY_ATTENDANCE_DASHBOARD;

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

function formatWorkingHours(hours) {
  if (hours == null || hours === "") return "—";
  const n = Number(hours);
  if (Number.isNaN(n)) return String(hours);
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function mapApiAttendanceRow(row, index) {
  const status = String(row.status || "present").toLowerCase().replace(/\s+/g, "_");
  const employeeName = row.employee_name || row.name || row.full_name || "—";
  return {
    id: row.id ?? index + 1,
    employee_id: row.employee_code || row.employee_id || `EMP${String(index + 1).padStart(3, "0")}`,
    name: employeeName,
    email: row.email || row.mail || "",
    role: row.role || row.role_name || "",
    company: row.company || "",
    department: row.department || row.shift || "—",
    check_in: row.check_in || null,
    check_out: row.check_out || null,
    working_hours: formatWorkingHours(row.working_hours),
    status: status === "half_day" ? "on_leave" : status,
    remarks: row.remarks || row.reason || "—",
    avatar: row.initials || initials(employeeName),
    record_date: row.record_date || row.date || new Date().toISOString().slice(0, 10),
  };
}

/** Merge live attendance API data with dashboard preview sections. */
export function mergeAttendanceDashboard({ summary = {}, rows = [], employeeCount = 0 } = {}) {
  const mappedRows = (rows || []).map(mapApiAttendanceRow);
  const present = Number(summary.present) || 0;
  const absent = Number(summary.absent) || 0;
  const late = Number(summary.late) || 0;
  const onLeave = Number(summary.on_leave ?? summary.half_day) || 0;
  const total =
    Number(employeeCount) ||
    present + absent + late + onLeave ||
    mappedRows.length ||
    0;

  if (total <= 0 && mappedRows.length === 0) return { ...EMPTY_ATTENDANCE_DASHBOARD };

  const slices = [
    { key: "present", count: present, pct: total ? +((present / total) * 100).toFixed(2) : 0 },
    { key: "late", count: late, pct: total ? +((late / total) * 100).toFixed(2) : 0 },
    { key: "absent", count: absent, pct: total ? +((absent / total) * 100).toFixed(2) : 0 },
    { key: "on_leave", count: onLeave, pct: total ? +((onLeave / total) * 100).toFixed(2) : 0 },
  ].filter((s) => s.count > 0);

  const attendancePct = total ? +(((present / total) * 100).toFixed(2)) : 0;

  return {
    ...EMPTY_ATTENDANCE_DASHBOARD,
    total_employees: total,
    present_today: present,
    on_leave: onLeave,
    late_today: late,
    absent_today: absent,
    summary_slices: slices,
    attendance_pct: attendancePct  || 0,
    today_overview: mappedRows.length
      ? mappedRows.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.name,
          department: r.department,
          status: r.status,
          check_in: r.check_in,
          avatar: r.avatar,
        }))
      : [],
    records: mappedRows.length ? mappedRows : [],
  };
}

export function attendanceStatusBadgeClass(status) {
  const key = String(status || "").toLowerCase().replace(/\s+/g, "_");
  return ATTENDANCE_STATUS_COLORS[key]?.badge || "bg-slate-100 text-slate-700";
}

export function attendanceStatusLabel(status) {
  const key = String(status || "").toLowerCase().replace(/\s+/g, "_");
  if (key === "on_leave") return "On Leave";
  return ATTENDANCE_STATUS_COLORS[key]?.label || status || "—";
}

export const DEMO_LEAVE_SUMMARY = { pending_leave: 0, approved: 0, rejected: 0, available_leave: 0, sick_leave: 0, casual_leave: 0, earned_leave: 0 };
export const DEMO_LEAVE_LIST = [];

export const LEAVE_TYPE_BADGES = {
  casual: "bg-sky-50 text-sky-700",
  earned: "bg-emerald-50 text-emerald-700",
  sick: "bg-rose-50 text-rose-700",
  annual: "bg-emerald-50 text-emerald-700",
  maternity: "bg-violet-50 text-violet-700",
  paternity: "bg-indigo-50 text-indigo-700",
  comp_off: "bg-teal-50 text-teal-700",
  lop: "bg-slate-100 text-slate-600",
  unpaid: "bg-slate-100 text-slate-600",
};

export const LEAVE_STATUS_BADGES = {
  pending: "bg-orange-50 text-orange-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const LEAVE_TYPE_LABELS = {
  casual: "Casual Leave",
  earned: "Earned Leave",
  sick: "Sick Leave",
  annual: "Annual Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  comp_off: "Comp Off",
  lop: "Loss of Pay",
  unpaid: "Unpaid Leave",
};

export const EMPTY_LEAVE_DASHBOARD = {total_employees: 0, leaves_taken: 0, on_leave_today: 0, pending_requests: 0, rejected_requests: 0,
  date_range_label: "", kpi_trends: {}, status_slices: [], leave_balances: [], upcoming_holidays: [],
  total_holidays: 0, total_requests: 0, requests: [],};
export const DEMO_LEAVE_DASHBOARD = EMPTY_LEAVE_DASHBOARD;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function leaveTypeLabel(type) {
  const key = String(type || "").toLowerCase();
  return LEAVE_TYPE_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function leaveTypeBadgeClass(type) {
  const key = String(type || "").toLowerCase();
  return LEAVE_TYPE_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function leaveStatusBadgeClass(status) {
  const key = String(status || "pending").toLowerCase();
  return LEAVE_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function formatLeaveDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return iso;
  return `${d} ${MONTH_NAMES[dt.getMonth()]} ${y} (${DAY_NAMES[dt.getDay()]})`;
}

function leaveInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function mapLeaveRow(row, index, deptByName = {}) {
  const name = row.employee_name || "—";
  return {
    id: row.id ?? index + 1,
    employee_name: name,
    department: row.department || deptByName[name] || "—",
    leave_type: String(row.leave_type || "casual").toLowerCase(),
    start_date: row.start_date,
    end_date: row.end_date,
    days: row.days,
    status: String(row.status || "pending").toLowerCase(),
    applied_on: row.applied_on || row.start_date,
    reason: row.reason,
    avatar: leaveInitials(name),
  };
}

export function mergeLeaveDashboard({ summary = {}, rows = [], employeeCount = 0, deptByName = {} } = {}) {
  const mapped = (rows || []).map((r, i) => mapLeaveRow(r, i, deptByName));
  const pending = Number(summary.pending_leave) || 0;
  const approved = Number(summary.approved) || 0;
  const rejected = Number(summary.rejected) || 0;

  if (mapped.length === 0 && pending === 0 && approved === 0) {
    return { ...EMPTY_LEAVE_DASHBOARD };
  }

  const cancelled = mapped.filter((r) => r.status === "cancelled").length;
  const approvedCount = mapped.filter((r) => r.status === "approved").length;
  const leavesTaken = approvedCount || approved  || 0;
  const onLeaveToday = mapped.filter((r) => {
    if (r.status !== "approved") return false;
    const today = new Date().toISOString().slice(0, 10);
    return r.start_date <= today && r.end_date >= today;
  }).length;

  const statusCounts = {
    approved: mapped.filter((r) => r.status === "approved").length || approved,
    pending: mapped.filter((r) => r.status === "pending").length || pending,
    rejected: mapped.filter((r) => r.status === "rejected").length || rejected,
    cancelled,
    others: mapped.filter((r) => !["approved", "pending", "rejected", "cancelled"].includes(r.status)).length,
  };
  const totalStatus = Object.values(statusCounts).reduce((a, b) => a + b, 0) || leavesTaken || 1;
  const sliceColors = { approved: "#22c55e", pending: "#f97316", rejected: "#ef4444", cancelled: "#94a3b8", others: "#3b82f6" };
  const sliceLabels = { approved: "Approved", pending: "Pending", rejected: "Rejected", cancelled: "Cancelled", others: "Others" };

  return {
    ...EMPTY_LEAVE_DASHBOARD,
    total_employees: employeeCount  || 0,
    leaves_taken: leavesTaken,
    on_leave_today: onLeaveToday  || 0,
    pending_requests: statusCounts.pending  || 0,
    rejected_requests: statusCounts.rejected  || 0,
    requests: mapped,
    total_requests: mapped.length  || 0,
    status_slices: Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        key,
        label: sliceLabels[key],
        count,
        pct: +((count / totalStatus) * 100).toFixed(2),
        color: sliceColors[key],
      })),
    leave_balances: [
      { key: "earned", label: "Earned Leave", used: Number(summary.earned_leave) || 0, total: 24, color: "#22c55e" },
      { key: "casual", label: "Casual Leave", used: Number(summary.casual_leave) || 0, total: 12, color: "#3b82f6" },
      { key: "sick", label: "Sick Leave", used: Number(summary.sick_leave) || 0, total: 12, color: "#f472b6" },
    ],
  };
}

export const PERFORMANCE_STATUS_BADGES = {
  completed: "bg-emerald-50 text-emerald-700",
  in_progress: "bg-blue-50 text-blue-700",
  pending: "bg-orange-50 text-orange-700",
};

export const EMPTY_PERFORMANCE_DASHBOARD = {total_employees: 0, reviews_completed: 0, reviews_in_progress: 0, average_rating: 0, goals_achieved_pct: 0,
  quarter_label: "", date_range_label: "", trend_badge: {}, performance_trend: [], rating_total: 0,
  kpi_trends: {}, rating_slices: [], top_performers: [], performance_insights: [], upcoming_reviews: [],
  recent_feedback: [], overview_rows: [], total_overview: 0, total_reviews: 0, recent_reviews: [],};
export const DEMO_PERFORMANCE_DASHBOARD = EMPTY_PERFORMANCE_DASHBOARD;

function perfInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function mapPerformanceRow(review, empById, index) {
  const emp = empById[review.employee_id] || {};
  const goalsTotal = Number(review.goals_total) || 0;
  const goalsAchieved = Number(review.goals_achieved) || 0;
  const goalsPct = goalsTotal ? Math.round((goalsAchieved / goalsTotal) * 100) : Number(review.productivity_score) || 0;
  const ratingNum = Number(review.rating) || 0;
  const name = emp.full_name || `Employee #${review.employee_id}`;
  const reviewStatus = ratingNum > 0 && goalsTotal > 0 ? "completed" : "in_progress";
  return {
    id: review.id ?? index + 1,
    employee_id: review.employee_id,
    employee_name: name,
    department: emp.department || "—",
    designation: emp.designation || "—",
    review_status: reviewStatus,
    rating: ratingNum || null,
    goals_pct: goalsPct,
    last_review: review.review_period || "—",
    avatar: perfInitials(name),
    notes: review.notes,
  };
}

export function performanceStatusBadgeClass(status) {
  const key = String(status || "in_progress").toLowerCase();
  return PERFORMANCE_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function performanceStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "completed") return "Completed";
  if (key === "in_progress") return "In Progress";
  if (key === "pending") return "Pending";
  return status || "—";
}

function mapRecentReviewRow(row) {
  const status = row.review_status === "completed" ? "completed" : row.review_status === "pending" ? "pending" : row.review_status === "in_progress" ? "pending" : "completed";
  return {
    id: row.id,
    employee_name: row.employee_name,
    department: row.department,
    review_type: row.review_type || "Quarterly Review",
    rating: row.rating,
    review_date: row.review_date || row.last_review || "—",
    status,
    avatar: row.avatar,
  };
}

export function mergePerformanceDashboard({ reviews = [], employees = [], employeeCount = 0 } = {}) {
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const mapped = (reviews || []).map((r, i) => mapPerformanceRow(r, empById, i));

  if (mapped.length === 0) {
    return { ...EMPTY_PERFORMANCE_DASHBOARD };
  }

  const completed = mapped.filter((r) => r.review_status === "completed").length;
  const inProgress = mapped.filter((r) => r.review_status === "in_progress").length;
  const ratings = mapped.filter((r) => r.rating).map((r) => r.rating);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const goalsPct = mapped.length
    ? Math.round(mapped.reduce((a, r) => a + r.goals_pct, 0) / mapped.length)
    : 0;

  const starCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  ratings.forEach((r) => {
    const bucket = Math.min(5, Math.max(1, Math.round(r)));
    starCounts[bucket] += 1;
  });
  const starTotal = Object.values(starCounts).reduce((a, b) => a + b, 0) || employeeCount || 0;
  const starColors = { 5: "#22c55e", 4: "#3b82f6", 3: "#eab308", 2: "#f97316", 1: "#ef4444" };

  const topPerformers = [...mapped]
    .filter((r) => r.rating)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3)
    .map((r, i) => ({
      id: r.id,
      name: r.employee_name,
      department: r.department,
      rating: r.rating,
      avatar: r.avatar,
      icon: i === 0 ? "trophy" : "user",
      bar_color: ["#8b5cf6", "#3b82f6", "#22c55e"][i] || "#8b5cf6",
    }));

  const recentReviews = mapped.slice(0, 10).map((r) =>
    mapRecentReviewRow({
      ...r,
      review_type: "Quarterly Review",
      review_date: r.last_review !== "—" ? r.last_review : "Aug 2026",
    })
  );

  const highCount = mapped.filter((r) => r.rating >= 4.5).length;
  const attentionCount = mapped.filter((r) => r.rating && r.rating < 3.5).length;
  const trackCount = Math.max(0, mapped.length - highCount - attentionCount);
  const insightTotal = mapped.length || 1;

  const recentFeedback = mapped
    .filter((r) => r.notes)
    .slice(0, 4)
    .map((r, i) => ({
      id: r.id ?? i + 1,
      text: r.notes,
      date: r.last_review !== "—" ? r.last_review : "Aug 2026",
    }));

  return {
    ...EMPTY_PERFORMANCE_DASHBOARD,
    total_employees: employeeCount  || 0,
    reviews_completed: completed  || 0,
    reviews_in_progress: inProgress  || 0,
    average_rating: +avgRating.toFixed(2),
    goals_achieved_pct: goalsPct,
    overview_rows: mapped,
    total_overview: employeeCount || mapped.length  || 0,
    total_reviews: employeeCount || mapped.length  || 0,
    rating_total: starTotal  || 0,
    recent_reviews: recentReviews,
    rating_slices: [5, 4, 3, 2, 1]
      .filter((k) => starCounts[k] > 0)
      .map((k) => ({
        key: String(k),
        label: `${k} Star`,
        count: starCounts[k],
        pct: +((starCounts[k] / starTotal) * 100).toFixed(0),
        color: starColors[k],
      })),
    top_performers: topPerformers,
    performance_insights: mapped.length
      ? [
          { key: "high", label: "High Performers", count: highCount, pct: Math.round((highCount / insightTotal) * 100), color: "#8b5cf6" },
          { key: "attention", label: "Needs Attention", count: attentionCount, pct: Math.round((attentionCount / insightTotal) * 100), color: "#f97316" },
          { key: "track", label: "On Track", count: trackCount, pct: Math.round((trackCount / insightTotal) * 100), color: "#22c55e" },
        ]
      : [],
    recent_feedback: recentFeedback,
  };
}

export const RECRUITMENT_JOB_STATUS_BADGES = {
  open: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
  on_hold: "bg-amber-50 text-amber-700",
};

export const RECRUITMENT_APPLICANT_STATUS_BADGES = {
  in_progress: "bg-blue-50 text-blue-700",
  new: "bg-violet-50 text-violet-700",
  hired: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
};

export const EMPTY_RECRUITMENT_DASHBOARD = {
  total_openings: 0,
  active_candidates: 0,
  hired_this_month: 0,
  offer_in_progress: 0,
  rejected_this_month: 0,
  total_applicants: 0,
  kpi_trends: {},
  funnel_stages: [],
  job_openings: [],
  recent_applicants: [],
  source_slices: [],
  source_total: 0,
};
export const DEMO_RECRUITMENT_DASHBOARD = EMPTY_RECRUITMENT_DASHBOARD;

export function recruitmentJobStatusBadgeClass(status) {
  const key = String(status || "open").toLowerCase();
  return RECRUITMENT_JOB_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function recruitmentApplicantStatusBadgeClass(status) {
  const key = String(status || "new").toLowerCase();
  return RECRUITMENT_APPLICANT_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function recruitmentApplicantStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "in_progress") return "In Progress";
  if (key === "new") return "New";
  if (key === "hired") return "Hired";
  if (key === "rejected") return "Rejected";
  return status || "—";
}

export function mergeRecruitmentDashboard(api = {}) {
  if (!api || Object.keys(api).length === 0) {
    return { ...EMPTY_RECRUITMENT_DASHBOARD };
  }
  return { ...EMPTY_RECRUITMENT_DASHBOARD, ...api };
}

export const TRAINING_STATUS_BADGES = {
  in_progress: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  not_started: "bg-orange-50 text-orange-700",
  upcoming: "bg-violet-50 text-violet-700",
};

export const EMPTY_TRAINING_DASHBOARD = {total_programs: 0, in_progress: 0, completed: 0, not_started: 0, certifications_earned: 0,
  kpi_trends: {}, overview_slices: [], overview_total: 0, completion_trend: [], top_categories: [],
  ongoing_programs: [], total_ongoing: 0, upcoming_programs: [], my_summary: [], recent_certifications: [],};
export const DEMO_TRAINING_DASHBOARD = EMPTY_TRAINING_DASHBOARD;

export function trainingStatusBadgeClass(status) {
  const key = String(status || "in_progress").toLowerCase();
  return TRAINING_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

export function trainingStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "in_progress") return "In Progress";
  if (key === "not_started") return "Not Started";
  if (key === "completed") return "Completed";
  if (key === "upcoming") return "Upcoming";
  return status || "—";
}

export function mergeTrainingDashboard(api = {}) {
  if (!api || Object.keys(api).length === 0) {
    return { ...EMPTY_TRAINING_DASHBOARD };
  }
  return { ...EMPTY_TRAINING_DASHBOARD, ...api };
}

export const DEMO_PAY_SUMMARY = { monthly_payroll: 0, pending_salary: 0, processed_salary: 0, overtime_cost: 0, pf: 0, esi: 0, professional_tax: 0 };

export function formatPayrollInr(value) {
  const n = Number(value) || 0;
  return `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PAYROLL_STATUS_BADGES = {
  draft: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  processed: "bg-emerald-50 text-emerald-700",
  paid: "bg-emerald-50 text-emerald-700",
};

export const DEFAULT_PAYROLL_QUICK_LINKS = [
  { label: "Salary Components", to: "/hr/payroll/salary-components" },
  { label: "Statutory Components", to: "/hr/payroll/statutory-components" },
  { label: "Salary Breakup", to: "/hr/payroll/salary-breakup" },
  { label: "Run Payroll", to: "/hr/payroll/create" },
  { label: "Salary On Hold", to: "/hr/payroll/on-hold" },
  { label: "My Payslips", to: "/hr/payroll/my-payslips" },
  { label: "Payroll Settings", to: "/hr/payroll/settings" },
];

export const DEFAULT_PAYROLL_IMPORTANT_DATES = [
  { label: "Cut-off Date", value: "25th of every month", icon: "calendar" },
  { label: "Disbursement Date", value: "1st of every month", icon: "wallet" },
  { label: "PF & ESIC Filing", value: "15th of every month", icon: "clock" },
];

export const EMPTY_PAYROLL_DASHBOARD = {
  total_employees: 0,
  total_payroll: 0,
  net_pay: 0,
  deductions: 0,
  pending_approval: 0,
  period_label: "",
  kpi_trends: {},
  summary_slices: [],
  payroll_runs: [],
  recent_payslips: [],
  important_dates: DEFAULT_PAYROLL_IMPORTANT_DATES,
  quick_links: DEFAULT_PAYROLL_QUICK_LINKS,
};
export const DEMO_PAYROLL_DASHBOARD = EMPTY_PAYROLL_DASHBOARD;

function mapPayslipRow(row, index) {
  return {
    id: row.id ?? index + 1,
    name: row.employee_name || "—",
    department: row.department || "—",
    net_pay: Number(row.net_salary || row.net_pay) || 0,
    period: row.period_start ? String(row.period_start).slice(0, 7) : "—",
    status: String(row.status || "draft").toLowerCase(),
    avatar: String(row.employee_name || "?")
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  };
}

export function mergePayrollDashboard({ summary = {}, rows = [], employeeCount = 0 } = {}) {
  const mappedPayslips = (rows || []).map(mapPayslipRow);
  const monthly = Number(summary.monthly_payroll) || 0;
  const pending = Number(summary.pending_salary) || 0;
  const processed = Number(summary.processed_salary) || 0;
  const deductions =
    (Number(summary.pf) || 0) + (Number(summary.esi) || 0) + (Number(summary.professional_tax) || 0);

  const netPay = processed || monthly;
  const totalPayroll = monthly + deductions * 0.5 || monthly;
  const basic = totalPayroll * 0.6;
  const allowances = totalPayroll * 0.224;
  const dedAmount = deductions || totalPayroll * 0.219;

  const runs = mappedPayslips.length ? [
    {
      id: 1,
      name: summary.name || "Monthly Payroll Run",
      period: summary.period || new Date().toISOString().slice(0, 7),
      employees: mappedPayslips.length || employeeCount,
      total_payroll: monthly || totalPayroll,
      net_pay: netPay,
      status: "processed",
    }
  ] : [];

  return {
    ...EMPTY_PAYROLL_DASHBOARD,
    total_employees: employeeCount || mappedPayslips.length || 0,
    total_payroll: monthly || 0,
    net_pay: netPay || 0,
    deductions: dedAmount || 0,
    pending_approval: pending > 0 ? Math.min(99, Math.ceil(pending / 50000)) : 0,
    recent_payslips: mappedPayslips.slice(0, 8),
    payroll_runs: runs,
    summary_slices: [
      { key: "basic", label: "Basic Pay", amount: basic, pct: 59.9, color: "#8b5cf6" },
      { key: "allowances", label: "Allowances", amount: allowances, pct: 22.4, color: "#3b82f6" },
      { key: "deductions", label: "Deductions", amount: dedAmount, pct: 21.9, color: "#22c55e" },
    ],
    important_dates: DEFAULT_PAYROLL_IMPORTANT_DATES,
    quick_links: DEFAULT_PAYROLL_QUICK_LINKS,
  };
}

export function payrollStatusBadgeClass(status) {
  const key = String(status || "draft").toLowerCase();
  return PAYROLL_STATUS_BADGES[key] || "bg-slate-100 text-slate-700";
}

const DEPT_CHART_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316", "#94a3b8", "#06b6d4", "#ec4899"];

const EXPENSE_CHART_COLORS = [
  "#a78bfa", "#f472b6", "#fb923c", "#14b8a6", "#facc15", "#3b82f6", "#38bdf8", "#86efac",
  "#fdba74", "#60a5fa", "#93c5fd", "#a16207", "#f97316", "#2dd4bf", "#f9a8d4", "#7dd3fc",
  "#bef264", "#ef4444", "#22c55e", "#7c3aed", "#818cf8", "#ec4899", "#ea580c", "#0d9488", "#eab308",
];

function formatShortDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1]}`;
}

function formatTime12h(value) {
  if (!value) return "—";
  const raw = String(value);
  const [hPart, mPart = "00"] = raw.split(":");
  let h = Number(hPart);
  const m = mPart.slice(0, 2);
  if (Number.isNaN(h)) return raw;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

function monthYearLabel(date = new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} - ${date.getFullYear()}`;
}

function buildCelebrationsFromEmployees(employees = []) {
  const today = new Date();
  const items = [];

  for (const emp of employees) {
    const name = emp.full_name || emp.name || "Employee";
    const join = emp.joining_date || emp.hire_date;
    if (join) {
      const [, m, d] = String(join).slice(0, 10).split("-");
      const thisYearJoin = `${today.getFullYear()}-${m}-${d}`;
      const joinDate = new Date(thisYearJoin);
      const diffDays = Math.round((joinDate - today) / 86400000);
      if (diffDays >= 0 && diffDays <= 30) {
        const years = today.getFullYear() - Number(String(join).slice(0, 4));
        if (years > 0) {
          items.push({
            id: `ann-${emp.id}`,
            name,
            date_label: diffDays === 0 ? "Today" : formatShortDate(thisYearJoin),
            type: "anniversary",
            years,
          });
        }
      }
    }
  }

  return items.slice(0, 12);
}

export const EMPTY_HR_DASHBOARD = {
  pending_requests: 0,
  analytics_month_label: "",
  active_employees: 0,
  hired_month: 0,
  exits_month: 0,
  present_today: 0,
  absent_today: 0,
  on_leave_today: 0,
  celebrations: [],
  overall_employees: 0,
  hired_total: 0,
  exits_total: 0,
  upcoming_holidays: [],
  shift_schedule: null,
  expense_total: 0,
  expense_categories: [],
  my_leaves: [],
  approval_counts: { attendance: 0, expenses: 0, overtime: 0 },
  approval_requests: [],
  announcements: [],
  payslips: [],
  total_employees: 0,
  leave_requests: 0,
  departments: [],
};

export const DEMO_HR_DASHBOARD = EMPTY_HR_DASHBOARD;

/** @deprecated use EMPTY_HR_DASHBOARD */
export const EMPTY_HR_HUB = EMPTY_HR_DASHBOARD;
/** @deprecated use DEMO_HR_DASHBOARD */
export const DEMO_HR_HUB = DEMO_HR_DASHBOARD;

/** Merge live HR APIs with dashboard preview sections when data is partial or empty. */
export function mergeHrDashboard({
  hub = {},
  empSummary = {},
  attSummary = {},
  leaveSummary = {},
  leaves = [],
  shifts = [],
  payrollRows = [],
  employees = [],
  attendanceRows = [],
} = {}) {
  const demo = EMPTY_HR_DASHBOARD;
  const activeEmployees = Number(empSummary.total_employees ?? hub.total_employees) || 0;
  const hasLive = activeEmployees > 0;

  const presentToday = Number(empSummary.present_today ?? hub.present_today) || 0;
  const absentToday = Number(empSummary.absent ?? attSummary.absent) || 0;
  const onLeaveToday = Number(empSummary.on_leave) || 0;
  const pendingLeave = Number(leaveSummary.pending_leave ?? hub.pending_leave) || 0;
  const newJoiners = Number(empSummary.new_joiners ?? hub.new_joiners) || 0;
  const attritionRate = Number(hub.attrition_rate) || 0;
  const inactiveEstimate = attritionRate > 0 && activeEmployees > 0
    ? Math.round((activeEmployees * attritionRate) / (100 - attritionRate))
    : 0;
  const exitsTotal = inactiveEstimate;
  const overallEmployees = hasLive ? activeEmployees + exitsTotal : 0;

  const pendingAttendance = (attendanceRows || []).filter((r) =>
    ["pending", "late", "half_day"].includes(String(r.status || "").toLowerCase())
  ).length;
  const pendingLeaves = (leaves || []).filter((l) => String(l.status || "").toLowerCase() === "pending");

  const approvalRequests = pendingLeaves.length
    ? pendingLeaves.slice(0, 12).map((l, i) => ({
        id: l.id ?? i + 1,
        name: l.employee_name || "—",
        date_label: formatShortDate(l.start_date),
        type: "attendance",
      }))
    : pendingAttendance > 0
      ? (attendanceRows || [])
          .filter((r) => ["pending", "late", "half_day"].includes(String(r.status || "").toLowerCase()))
          .slice(0, 12)
          .map((r, i) => ({
            id: r.id ?? i + 1,
            name: r.name || r.employee_name || "—",
            date_label: formatShortDate(r.record_date),
            type: "attendance",
          }))
      : [];

  const celebrations = buildCelebrationsFromEmployees(employees);
  const celebrationsFinal = celebrations;

  const firstShift = (shifts || [])[0];
  const shiftSchedule = firstShift
    ? {
        name: firstShift.name || "General",
        initial: String(firstShift.name || "G").charAt(0).toUpperCase(),
        date_range: `${formatShortDate(new Date().toISOString().slice(0, 10))} - ${formatShortDate(
          new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10)
        )} ${new Date().getFullYear()}`,
        time_range: `${formatTime12h(firstShift.start_time)} to ${formatTime12h(firstShift.end_time)}`,
      }
    : null;

  const myLeaves = demo.my_leaves.map((row) => ({
    ...row,
    available: row.key === "casual"
      ? Math.max(0, 12 - Number(leaveSummary.casual_leave || 0))
      : row.available,
  }));

  const payslips = (payrollRows || [])
    .filter((p) => ["processed", "paid"].includes(String(p.status || "").toLowerCase()))
    .slice(0, 5)
    .map((p, i) => ({
      id: p.id ?? i + 1,
      period: p.period_start ? String(p.period_start).slice(0, 7) : "—",
      amount: Number(p.net_salary || p.net_pay) || 0,
    }));

  const announcements = (hub.alerts || []).length
    ? hub.alerts.map((a, i) => ({
        id: i + 1,
        title: a.message || a.title || "HR Notice",
        date: formatShortDate(new Date().toISOString().slice(0, 10)),
      }))
    : [];

  const departments = (hub.department_strength || []).map((d, i) => ({
    name: d.name,
    count: Number(d.count) || 0,
    color: DEPT_CHART_COLORS[i % DEPT_CHART_COLORS.length],
  }));

  if (!hasLive) {
    return { ...EMPTY_HR_DASHBOARD };
  }

  return {
    ...demo,
    pending_requests: pendingLeave + pendingAttendance || demo.pending_requests,
    analytics_month_label: monthYearLabel(),
    active_employees: activeEmployees,
    hired_month: newJoiners,
    exits_month: 0,
    present_today: presentToday,
    absent_today: absentToday || Math.max(0, activeEmployees - presentToday - onLeaveToday),
    on_leave_today: onLeaveToday,
    celebrations: celebrationsFinal,
    overall_employees: overallEmployees,
    hired_total: activeEmployees,
    exits_total: exitsTotal,
    upcoming_holidays: [],
    shift_schedule: shiftSchedule,
    expense_total: hasLive ? 0 : demo.expense_total,
    expense_categories: hasLive ? [] : demo.expense_categories,
    my_leaves: myLeaves,
    approval_counts: {
      attendance: pendingAttendance || pendingLeaves.length || demo.approval_counts.attendance,
      expenses: demo.approval_counts.expenses,
      overtime: Number(attSummary.overtime) > 0 ? Math.min(99, Math.ceil(attSummary.overtime)) : demo.approval_counts.overtime,
    },
    approval_requests: approvalRequests,
    announcements,
    payslips,
    total_employees: activeEmployees,
    leave_requests: pendingLeave,
    departments,
  };
}

/** Merge live /hr/hub payload with dashboard preview sections. */
export function mergeHrHub(api = {}) {
  return mergeHrDashboard({ hub: api });
}

export function formatInr(v) {
  if (v == null || v === "") return "₹0";
  const n = Number(v);
  if (Number.isNaN(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN")}`;
}

export function statusColor(s) {
  const m = {
    active: "bg-green-100 text-green-800", inactive: "bg-slate-200 text-slate-700",
    present: "bg-green-100 text-green-800", absent: "bg-red-100 text-red-800",
    late: "bg-amber-100 text-amber-800", half_day: "bg-orange-100 text-orange-800",
    pending: "bg-amber-100 text-amber-800", approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
    draft: "bg-slate-100 text-slate-700", processed: "bg-green-100 text-green-800", paid: "bg-green-100 text-green-800",
  };
  return m[s] || "bg-slate-100 text-slate-700";
}

export function deptColor(dept) {
  return DEPARTMENT_COLORS[dept] || "bg-slate-100 text-slate-700";
}

export function sourceLabel(s) {
  const m = { biometric: "Biometric", rfid: "RFID", gps: "GPS", qr: "QR", face: "Face Recognition", manual: "Manual" };
  return m[s] || s || "—";
}
