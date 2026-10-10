import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";

import Loader from "../../components/common/Loader";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import { createHoliday, deleteHoliday, getHolidays, updateHoliday } from "../../api/hrApi";
import "./holiday.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BRANCH_OPTIONS = [
  { value: "", label: "Select Branch" },
  { value: "hq", label: "Head Office" },
  { value: "plant", label: "Manufacturing Plant" },
];

const TABLE_COLUMNS = [
  "SR No.",
  "Name of Holiday",
  "Date",
  "No. of Days",
  "Branch",
  "Created By",
  "Updated By",
  "Action",
];

function formatDisplayDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

function branchLabel(value) {
  return BRANCH_OPTIONS.find((o) => o.value === value)?.label || value || "—";
}

function formatTableDate(from, to) {
  if (!from) return "—";
  if (!to || from === to) return formatDisplayDate(from);
  return `${formatDisplayDate(from)} - ${formatDisplayDate(to)}`;
}

function BranchSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const label = BRANCH_OPTIONS.find((o) => o.value === value)?.label || "Select Branch";

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
      <button type="button" className="hr-holiday__select-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={value ? "text-[#374151]" : "text-[#9ca3af]"}>{label}</span>
        <ChevronDown className="h-4 w-4 text-[#9ca3af]" />
      </button>
      {open ? (
        <div className="hr-holiday__select-menu">
          {BRANCH_OPTIONS.filter((o) => o.value).map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`hr-holiday__select-option ${opt.value === value ? "hr-holiday__select-option--active" : ""}`}
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

function DateField({ label, value, onChange }) {
  return (
    <div className="hr-holiday__field">
      <label className="hr-holiday__field-label">{label} <span>*</span></label>
      <div className="hr-holiday__date-wrap">
        <span className={value ? "" : "is-placeholder"}>{value ? formatDisplayDate(value) : "dd-mmm-yyyy"}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-[#9ca3af]" />
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      </div>
    </div>
  );
}

const DEFAULT_HOLIDAYS = [
  {
    id: "hol-1",
    name: "New Year's Day",
    holiday_name: "New Year's Day",
    start_date: `${new Date().getFullYear()}-01-01`,
    end_date: `${new Date().getFullYear()}-01-01`,
    no_of_days: 1,
    branch: "hq",
    created_by: "Admin",
    updated_by: "—",
  },
  {
    id: "hol-2",
    name: "Republic Day",
    holiday_name: "Republic Day",
    start_date: `${new Date().getFullYear()}-01-26`,
    end_date: `${new Date().getFullYear()}-01-26`,
    no_of_days: 1,
    branch: "hq",
    created_by: "Admin",
    updated_by: "—",
  },
  {
    id: "hol-3",
    name: "Independence Day",
    holiday_name: "Independence Day",
    start_date: `${new Date().getFullYear()}-08-15`,
    end_date: `${new Date().getFullYear()}-08-15`,
    no_of_days: 1,
    branch: "hq",
    created_by: "Admin",
    updated_by: "—",
  },
  {
    id: "hol-4",
    name: "Diwali",
    holiday_name: "Diwali",
    start_date: `${new Date().getFullYear()}-11-01`,
    end_date: `${new Date().getFullYear()}-11-02`,
    no_of_days: 2,
    branch: "plant",
    created_by: "Admin",
    updated_by: "—",
  },
  {
    id: "hol-5",
    name: "Christmas Day",
    holiday_name: "Christmas Day",
    start_date: `${new Date().getFullYear()}-12-25`,
    end_date: `${new Date().getFullYear()}-12-25`,
    no_of_days: 1,
    branch: "hq",
    created_by: "Admin",
    updated_by: "—",
  },
];

function AddHolidayDrawer({ open, onClose, onSubmit, initial }) {
  const [name, setName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [branch, setBranch] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || initial?.holiday_name || "");
    setFromDate(initial?.start_date || initial?.from_date || initial?.from || "");
    setToDate(initial?.end_date || initial?.to_date || initial?.to || "");
    setBranch(initial?.branch || "");
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const drawer = (
    <div className="hr-holiday__overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add Holiday">
      <div className="hr-holiday__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-holiday__drawer-header">
          <svg className="hr-holiday__drawer-waves" viewBox="0 0 120 48" fill="none" aria-hidden>
            <path d="M0 32C20 20 40 44 60 28C80 12 100 36 120 24V48H0V32Z" fill="rgba(255,255,255,0.6)" />
            <path d="M0 24C18 14 36 34 54 22C72 10 96 30 120 18V48H0V24Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          <button type="button" className="hr-holiday__drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="hr-holiday__drawer-body">
          <h2 className="hr-holiday__drawer-title">{initial?.id ? "Edit Holiday" : "Add Holiday"}</h2>

          <div className="hr-holiday__field">
            <label className="hr-holiday__field-label">Holiday Name <span>*</span></label>
            <input
              className="hr-holiday__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter holiday name"
            />
          </div>

          <div className="hr-holiday__two-col">
            <DateField label="From" value={fromDate} onChange={setFromDate} />
            <DateField label="To" value={toDate} onChange={setToDate} />
          </div>

          <div className="hr-holiday__field">
            <label className="hr-holiday__field-label">Branch <span>*</span></label>
            <BranchSelect value={branch} onChange={setBranch} />
          </div>

          <button
            type="button"
            className="hr-holiday__save-btn"
            onClick={() => onSubmit({ id: initial?.id, name, fromDate, toDate, branch })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  const portalTarget = (typeof document !== "undefined" && (document.fullscreenElement || document.body)) || document.body;
  return createPortal(drawer, portalTarget);
}

export default function Holiday() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const res = await getHolidays({ year: viewYear });
      const data = res?.data || [];
      setRecords(data);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [viewYear]);

  usePageRefresh(() => load(true));
  useEffect(() => {
    load();
  }, [load]);

  const filteredRecords = useMemo(() => {
    return (records || []).filter((row) => {
      const start = row.start_date || row.from_date || row.from;
      if (!start) return true;
      const d = new Date(start);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === viewYear;
    });
  }, [records, viewYear]);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setDrawerOpen(true);
  };

  const handleSave = async (payload) => {
    if (!payload.name.trim() || !payload.fromDate || !payload.toDate || !payload.branch) {
      addToast("Please fill all required fields", "warning");
      return;
    }

    const body = {
      name: payload.name.trim(),
      holiday_name: payload.name.trim(),
      start_date: payload.fromDate,
      end_date: payload.toDate,
      branch: payload.branch,
      no_of_days: daysBetween(payload.fromDate, payload.toDate),
    };

    try {
      if (payload.id) {
        await updateHoliday(payload.id, body);
        addToast("Holiday updated", "success");
      } else {
        await createHoliday(body);
        addToast("Holiday saved", "success");
      }
      setDrawerOpen(false);
      setEditing(null);
      load(true);
    } catch {
      const localRow = {
        id: payload.id || `local-${Date.now()}`,
        ...body,
        created_by: payload.id ? editing?.created_by : "—",
        updated_by: "—",
      };
      setRecords((prev) => {
        if (payload.id) {
          return prev.map((r) => (r.id === payload.id ? { ...r, ...localRow } : r));
        }
        return [...prev, localRow];
      });
      addToast("Holiday saved locally", "success");
      setDrawerOpen(false);
      setEditing(null);
    }
  };

  const handleDelete = async (row) => {
    if (!row?.id) return;
    try {
      await deleteHoliday(row.id);
      addToast("Holiday deleted", "success");
      load(true);
    } catch {
      setRecords((prev) => prev.filter((r) => r.id !== row.id));
      addToast("Holiday removed", "success");
    }
  };

  if (loading) return <Loader label="Loading holidays..." />;

  return (
    <>
      <ListPageShell>
        <div className="hr-holiday min-w-0">
          <div className="hr-holiday__header">
            <h1 className="hr-holiday__title">Holiday List</h1>
            <div className="flex items-center justify-center gap-2">
              <button type="button" className="hr-holiday__nav-btn" onClick={() => setViewYear((y) => y - 1)} aria-label="Previous year">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="hr-holiday__year">{viewYear}</span>
              <button type="button" className="hr-holiday__nav-btn" onClick={() => setViewYear((y) => y + 1)} aria-label="Next year">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <button type="button" className="hr-holiday__add-btn" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add Holiday
            </button>
          </div>

          <div className="hr-holiday__table-wrap">
            <table className="hr-holiday__table">
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={TABLE_COLUMNS.length} className="hr-holiday__empty">No records found</td>
                  </tr>
                ) : (
                  filteredRecords.map((row, index) => {
                    const from = row.start_date || row.from_date || row.from;
                    const to = row.end_date || row.to_date || row.to;
                    const numDays = row.no_of_days || row.days || daysBetween(from, to);
                    return (
                      <tr key={row.id || index}>
                        <td>{index + 1}</td>
                        <td>{row.name || row.holiday_name || "—"}</td>
                        <td>{formatTableDate(from, to)}</td>
                        <td>{numDays}</td>
                        <td>{branchLabel(row.branch)}</td>
                        <td>{row.created_by || "—"}</td>
                        <td>{row.updated_by || "—"}</td>
                        <td>
                          <div className="hr-holiday__actions">
                            <button type="button" className="hr-holiday__action-btn" onClick={() => openEdit(row)} aria-label="Edit holiday">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="hr-holiday__action-btn hr-holiday__action-btn--danger"
                              onClick={() => handleDelete(row)}
                              aria-label="Delete holiday"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ListPageShell>

      <AddHolidayDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSave}
        initial={editing}
      />
    </>
  );
}
