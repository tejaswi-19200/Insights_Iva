/** Site visit preview data — merged with live employees when API returns records. */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DEMO_SITE_VISIT_EMPLOYEES = [
  { id: 1, name: "Akhilesh Kothari", places_visited: 2, has_avatar: true },
  { id: 2, name: "Aakansha Kalani", places_visited: 0, has_avatar: false },
  { id: 3, name: "ABC KUMAR", places_visited: 0, has_avatar: false },
  { id: 4, name: "Akash Paul", places_visited: 0, has_avatar: false },
  { id: 5, name: "Amar Parmar", places_visited: 0, has_avatar: false },
  { id: 6, name: "Anthony Soni", places_visited: 0, has_avatar: false },
  { id: 7, name: "Anu OTU", places_visited: 0, has_avatar: false },
  { id: 8, name: "anurag kumar kashyap", places_visited: 0, has_avatar: false },
];

export function formatSiteVisitDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}-${MONTHS_SHORT[Number(m) - 1]}-${y}`;
}

export function formatMonthYear(date) {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthPicker(date) {
  return `${MONTHS_SHORT[date.getMonth()]}-${date.getFullYear()}`;
}

export function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

export function formatWeekRangeLabel(start, end) {
  const fmt = (dt) => `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

export function getWeekDays(anchorDate) {
  const { start } = getWeekRange(anchorDate);
  const days = [];
  const labels = ["S", "M", "T", "W", "T", "F", "S"];
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    days.push({
      key: dt.toISOString().slice(0, 10),
      label: labels[dt.getDay()],
      date: dt.getDate(),
      isToday: dt.toDateString() === new Date().toDateString(),
      isSelected: dt.toDateString() === anchorDate.toDateString(),
    });
  }
  return days;
}

function mapApiEmployee(row, index, visitCounts = {}) {
  const name = row.full_name || row.name || "—";
  const id = row.id ?? index + 1;
  return {
    id,
    name,
    places_visited: visitCounts[id] ?? 0,
    has_avatar: Boolean(row.avatar || row.initials),
    initials: row.initials || name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase(),
  };
}

/** Merge API employees with site-visit preview or live API visit counts. */
export function mergeSiteVisitEmployees(apiRows = [], { period = "daily", visits = [] } = {}) {
  const liveCounts = {};
  if (Array.isArray(visits) && visits.length > 0) {
    visits.forEach((v) => {
      if (v.employee_id) {
        liveCounts[v.employee_id] = (liveCounts[v.employee_id] || 0) + 1;
      }
    });
  }

  if (!apiRows?.length) {
    return [];
  }

  return apiRows.map((row, i) => mapApiEmployee(row, i, liveCounts));
}

export function totalVisitsForPeriod(employees, period) {
  return employees.reduce((sum, e) => sum + (Number(e.places_visited) || 0), 0);
}

export function placesLabel(count) {
  const n = Number(count) || 0;
  return `${n} place${n === 1 ? "" : "s"} visited`;
}

/** Demo map coordinates per employee until site-visit GPS API exists. */
export function getEmployeeMapLocation(employee) {
  const index = Math.max(0, Number(employee?.id) - 1);
  const base = { lat: 17.4326, lng: 78.4071 };
  const offset = (index % 6) * 0.006;
  return { lat: base.lat + offset, lng: base.lng + offset * 0.85 };
}
