import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Plus,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  createWeekOff,
  deleteWeekOff,
  getWeekOffs,
  updateWeekOff,
} from "../../api/hrApi";
import "./weekOff.css";

const TABLE_COLUMNS = ["Week off name", "Week Off Days", "Created By", "Updated By", "Action"];

const DAYS = [
  { key: "sunday", label: "Sunday", short: "Sun" },
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
];

const WEEK_KEYS = ["w1", "w2", "w3", "w4", "w5"];
const WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "5th"];

const DEMO_WEEK_OFF = {
  id: "org-weekly-off",
  name: "Organization Weekly Off",
  schedule: {
    sunday: { w1: "F", w2: "F", w3: "F", w4: "F", w5: "F" },
    monday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
    tuesday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
    wednesday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
    thursday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
    friday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
    saturday: { w1: "", w2: "", w3: "", w4: "", w5: "" },
  },
  created_by: null,
  updated_by: null,
};

function createEmptySchedule() {
  const schedule = {};
  for (const day of DAYS) {
    schedule[day.key] = { w1: "", w2: "", w3: "", w4: "", w5: "" };
  }
  return schedule;
}

function normalizeSchedule(raw) {
  const base = createEmptySchedule();
  if (!raw || typeof raw !== "object") return base;
  for (const day of DAYS) {
    const row = raw[day.key] || raw[day.label?.toLowerCase()] || {};
    for (const week of WEEK_KEYS) {
      const val = row[week] ?? row[WEEK_LABELS[WEEK_KEYS.indexOf(week)]];
      base[day.key][week] = val === "F" ? "F" : "";
    }
  }
  return base;
}

function isDayAllFull(schedule, dayKey) {
  return WEEK_KEYS.every((week) => schedule[dayKey]?.[week] === "F");
}

function formatWeekOffBadges(schedule) {
  const badges = [];
  for (const day of DAYS) {
    if (isDayAllFull(schedule, day.key)) {
      badges.push(`All ${day.short}`);
      continue;
    }
    WEEK_KEYS.forEach((week, index) => {
      if (schedule[day.key]?.[week] === "F") {
        badges.push(`${WEEK_LABELS[index]} ${day.short}`);
      }
    });
  }
  return badges;
}

function cycleCellValue(value) {
  return value === "F" ? "" : "F";
}

function ActionMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="hr-week-off__action-wrap">
      <button
        type="button"
        className="hr-week-off__action-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open ? (
        <div className="hr-week-off__action-menu">
          <button type="button" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
          <button type="button" className="danger" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
        </div>
      ) : null}
    </div>
  );
}

function AddWeekOffModal({ open, onClose, onSave, initial }) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState(createEmptySchedule);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setSchedule(normalizeSchedule(initial?.schedule));
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const toggleWeek = (dayKey, weekKey) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [weekKey]: cycleCellValue(prev[dayKey][weekKey]),
      },
    }));
  };

  const toggleAllWeeks = (dayKey) => {
    setSchedule((prev) => {
      const nextVal = isDayAllFull(prev, dayKey) ? "" : "F";
      const nextRow = {};
      for (const week of WEEK_KEYS) nextRow[week] = nextVal;
      return { ...prev, [dayKey]: nextRow };
    });
  };

  if (!open) return null;

  const modal = (
    <div className="hr-week-off__overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add Week Off">
      <div className="hr-week-off__modal" onClick={(e) => e.stopPropagation()}>
        <div className="hr-week-off__modal-header">
          <h2 className="hr-week-off__modal-title">{initial?.id ? "Edit Week Off" : "Add Week Off"}</h2>
          <button type="button" className="hr-week-off__modal-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="hr-week-off__modal-body">
          <div>
            <label className="hr-week-off__field-label">Week Off Name <span>*</span></label>
            <input
              className="hr-week-off__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter Week Off Name"
            />
          </div>

          <div className="hr-week-off__legend">
            <div>How to use: Click on any cell to cycle through:</div>
            <div className="hr-week-off__legend-row">
              <span className="hr-week-off__legend-chip">Empty</span>
              <span className="hr-week-off__legend-arrow">→</span>
              <span className="hr-week-off__legend-chip hr-week-off__legend-chip--full">F - Full Day</span>
            </div>
          </div>

          <div className="hr-week-off__grid-wrap">
            <table className="hr-week-off__grid">
              <thead>
                <tr>
                  <th>Days Off</th>
                  <th>All</th>
                  {WEEK_LABELS.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day) => (
                  <tr key={day.key}>
                    <td>{day.label}</td>
                    <td>
                      <button
                        type="button"
                        className={`hr-week-off__cell ${isDayAllFull(schedule, day.key) ? "hr-week-off__cell--full" : ""}`}
                        onClick={() => toggleAllWeeks(day.key)}
                        aria-label={`Toggle all weeks for ${day.label}`}
                      >
                        {isDayAllFull(schedule, day.key) ? "F" : ""}
                      </button>
                    </td>
                    {WEEK_KEYS.map((week) => (
                      <td key={week}>
                        <button
                          type="button"
                          className={`hr-week-off__cell ${schedule[day.key][week] === "F" ? "hr-week-off__cell--full" : ""}`}
                          onClick={() => toggleWeek(day.key, week)}
                          aria-label={`${day.label} ${week}`}
                        >
                          {schedule[day.key][week] === "F" ? "F" : ""}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hr-week-off__modal-footer">
          <button type="button" className="hr-week-off__outline-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hr-week-off__solid-btn"
            onClick={() => onSave({ id: initial?.id, name: name.trim(), schedule })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;
  return createPortal(modal, portalTarget);
}

export default function WeekOff() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const res = await getWeekOffs();
      const rows = res?.data;
      if (Array.isArray(rows) && rows.length) {
        setRecords(rows.map((row) => ({
          ...row,
          schedule: normalizeSchedule(row.schedule),
        })));
      } else {
        setRecords([]);
      }
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return records.slice(start, start + pageSize);
  }, [records, currentPage, pageSize]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setModalOpen(true);
  };

  const handleSave = async (payload) => {
    if (!payload.name) {
      addToast("Week Off Name is required", "error");
      return;
    }
    const hasSelection = DAYS.some((day) => WEEK_KEYS.some((week) => payload.schedule[day.key][week] === "F"));
    if (!hasSelection) {
      addToast("Select at least one week off day", "error");
      return;
    }

    try {
      if (payload.id) {
        await updateWeekOff(payload.id, payload);
        setRecords((prev) => prev.map((row) => (row.id === payload.id ? { ...row, ...payload } : row)));
        addToast("Week off updated", "success");
      } else {
        const res = await createWeekOff(payload);
        const created = res?.data || { ...payload, id: `wo-${Date.now()}` };
        setRecords((prev) => [...prev, { ...created, schedule: normalizeSchedule(created.schedule || payload.schedule) }]);
        addToast("Week off created", "success");
      }
    } catch {
      if (payload.id) {
        setRecords((prev) => prev.map((row) => (row.id === payload.id ? { ...row, ...payload } : row)));
        addToast("Week off saved locally", "info");
      } else {
        setRecords((prev) => [...prev, { ...payload, id: `wo-${Date.now()}` }]);
        addToast("Week off saved locally", "info");
      }
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = async (row) => {
    try {
      await deleteWeekOff(row.id);
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
      addToast("Week off removed", "success");
    } catch {
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
      addToast("Week off removed", "success");
    }
  };

  if (loading) return <Loader label="Loading week off..." />;

  const showingFrom = pagedRows.length ? (currentPage - 1) * pageSize + 1 : 0;
  const showingTo = Math.min(currentPage * pageSize, records.length);

  return (
    <>
      <ListPageShell>
        <div className="hr-week-off min-w-0">
          <div className="hr-week-off__top">
            <div className="hr-week-off__title-row">
              <h1 className="hr-week-off__title">Manage Week Off</h1>
              <BookOpen className="hr-week-off__title-icon h-4 w-4" aria-hidden />
            </div>
            <button type="button" className="hr-week-off__add-btn" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add Week Off
            </button>
          </div>

          <div className="hr-week-off__table-wrap">
            <table className="hr-week-off__table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLUMNS.length} className="hr-week-off__empty">No records found</td>
                  </tr>
                ) : (
                  pagedRows.map((row) => {
                    const badges = formatWeekOffBadges(normalizeSchedule(row.schedule));
                    return (
                      <tr key={row.id}>
                        <td>{row.name || "—"}</td>
                        <td>
                          <div className="hr-week-off__badges">
                            {badges.length ? badges.map((badge) => (
                              <span key={badge} className="hr-week-off__badge">{badge}</span>
                            )) : "—"}
                          </div>
                        </td>
                        <td>{row.created_by || "--"}</td>
                        <td>{row.updated_by || "--"}</td>
                        <td>
                          <ActionMenu onEdit={() => openEdit(row)} onDelete={() => handleDelete(row)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className="hr-week-off__footer">
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
              <span>Showing {showingFrom} to {showingTo} of {records.length} entries</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="hr-week-off__page-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" className="hr-week-off__page-btn hr-week-off__page-btn--active" aria-label={`Page ${currentPage}`}>
                  {currentPage}
                </button>
                <button
                  type="button"
                  className="hr-week-off__page-btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </ListPageShell>

      <AddWeekOffModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={handleSave}
        initial={editing}
      />
    </>
  );
}
