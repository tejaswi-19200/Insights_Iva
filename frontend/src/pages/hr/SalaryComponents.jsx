import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Pencil, Plus, Trash2, X } from "lucide-react";

import Loader from "../../components/common/Loader";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import { ListPageShell } from "../../components/common/ListPageShell";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  createSalaryComponent,
  deleteSalaryComponent,
  getOvertimeSettings,
  getSalaryComponents,
  saveOvertimeSettings,
  updateSalaryComponent,
} from "../../api/hrApi";
import "./salaryComponents.css";

const TABS = [
  { key: "earnings", label: "Earnings" },
  { key: "deductions", label: "Deductions" },
  { key: "overtime", label: "Overtime" },
];

const CALC_LABELS = {
  flat_amount: "Flat Amount",
  percentage_of_basic: "Percentage of basic",
  percentage_of_gross: "Percentage of Gross",
};

const DEFAULT_EARNINGS = [
  {
    id: "earn-basic",
    name: "Basic",
    calculation_type: "percentage_of_gross",
    calculation_value: 50,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "earn-da",
    name: "DA",
    calculation_type: "flat_amount",
    calculation_value: 0,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "earn-hra",
    name: "HRA",
    calculation_type: "percentage_of_basic",
    calculation_value: 40,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "earn-other",
    name: "Other Allowance",
    calculation_type: "flat_amount",
    calculation_value: 0,
    is_active: true,
    is_fixed: false,
  },
];

const DEFAULT_DEDUCTIONS = [
  {
    id: "ded-pf",
    name: "Provident Fund (PF)",
    calculation_type: "percentage_of_basic",
    calculation_value: 12,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "ded-esic",
    name: "Employee State Insurance (ESIC)",
    calculation_type: "percentage_of_gross",
    calculation_value: 0.75,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "ded-pt",
    name: "Professional Tax (PT)",
    calculation_type: "flat_amount",
    calculation_value: 200,
    is_active: true,
    is_fixed: false,
  },
  {
    id: "ded-tds",
    name: "TDS / Income Tax",
    calculation_type: "flat_amount",
    calculation_value: 0,
    is_active: true,
    is_fixed: false,
  },
];

const DEFAULT_OVERTIME = {
  mode: "fixed_amount",
  fixed_amount: "",
  gross_multiplier: "",
  basic_multiplier: "",
};

function formatCalcValue(row) {
  if (row.calculation_type === "flat_amount") {
    const n = Number(row.calculation_value) || 0;
    return `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${row.calculation_value ?? 0} %`;
}

function calcTypeLabel(type) {
  return CALC_LABELS[type] || type;
}

function earningCalcOptions(isBasic) {
  if (isBasic) {
    return [
      { value: "flat_amount", label: "Flat Amount" },
      { value: "percentage_of_gross", label: "Percentage of Gross" },
    ];
  }
  return [
    { value: "flat_amount", label: "Flat Amount" },
    { value: "percentage_of_basic", label: "Percentage of Basic" },
  ];
}

function ComponentDrawer({ open, mode, tab, initial, onClose, onSave }) {
  const isEdit = mode === "edit";
  const isEarning = tab === "earnings";
  const title = isEdit
    ? isEarning ? "Update Earning" : "Update Deduction"
    : isEarning ? "New Earning" : "New Deduction";

  const [name, setName] = useState("");
  const [calcType, setCalcType] = useState("flat_amount");
  const [value, setValue] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isFixed, setIsFixed] = useState(false);

  const isBasicRow = initial?.id === "earn-basic" || name.trim().toLowerCase() === "basic";
  const calcOptions = isEarning ? earningCalcOptions(isBasicRow) : [
    { value: "flat_amount", label: "Flat Amount" },
    { value: "percentage_of_basic", label: "Percentage of Basic" },
    { value: "percentage_of_gross", label: "Percentage of Gross" },
  ];

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setCalcType(initial?.calculation_type || "flat_amount");
    setValue(initial?.calculation_value != null ? String(initial.calculation_value) : "");
    setIsActive(initial?.is_active ?? true);
    setIsFixed(initial?.is_fixed ?? false);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const isPercent = calcType !== "flat_amount";
  const valueLabel = isPercent ? "Enter Percentage" : "Enter Amount";

  const drawer = (
    <div className="hr-salary-components__overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="hr-salary-components__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="hr-salary-components__drawer-header">
          <svg className="hr-salary-components__drawer-waves" viewBox="0 0 120 48" fill="none" aria-hidden>
            <path d="M0 32C20 20 40 44 60 28C80 12 100 36 120 24V48H0V32Z" fill="rgba(255,255,255,0.6)" />
            <path d="M0 24C18 14 36 34 54 22C72 10 96 30 120 18V48H0V24Z" fill="rgba(255,255,255,0.35)" />
          </svg>
          <button type="button" className="hr-salary-components__drawer-close" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="hr-salary-components__drawer-body">
          <h2 className="hr-salary-components__drawer-title">{title}</h2>

          <div className="hr-salary-components__field">
            <label className="hr-salary-components__field-label">
              {isEarning ? "Earning Name" : "Deduction Name"} <span>*</span>
            </label>
            <input
              className="hr-salary-components__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isEarning ? "Enter Earning Name" : "Enter Deduction Name"}
            />
          </div>

          <div className="hr-salary-components__field">
            <span className="hr-salary-components__field-label">Calculation Type</span>
            <div className="hr-salary-components__radio-row">
              {calcOptions.map((opt) => (
                <label key={opt.value} className="hr-salary-components__radio">
                  <input
                    type="radio"
                    name="calcType"
                    checked={calcType === opt.value}
                    onChange={() => setCalcType(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="hr-salary-components__field">
            <label className="hr-salary-components__field-label">{valueLabel} <span>*</span></label>
            {isPercent ? (
              <div className="hr-salary-components__suffix-wrap">
                <input
                  className="hr-salary-components__input"
                  type="number"
                  min="0"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                />
                <span className="hr-salary-components__suffix">%</span>
              </div>
            ) : (
              <ShorthandQuantityInput
                value={value}
                onChange={(val) => setValue(val)}
                prefix="₹"
                placeholder="0"
              />
            )}
          </div>

          {!isEdit ? (
            <>
              <label className="hr-salary-components__checkbox">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Mark this as Active</span>
              </label>
              <label className="hr-salary-components__checkbox">
                <input type="checkbox" checked={isFixed} onChange={(e) => setIsFixed(e.target.checked)} />
                <span>Mark as Fixed Amount</span>
              </label>
              <p className="hr-salary-components__checkbox-hint">This amount will not change across pay periods</p>
            </>
          ) : null}
        </div>

        <div className={`hr-salary-components__drawer-footer ${isEdit ? "hr-salary-components__drawer-footer--center" : ""}`}>
          <button
            type="button"
            className="hr-salary-components__save-btn"
            disabled={!name.trim() || value === ""}
            onClick={() => {
              onSave({
                name: name.trim(),
                calculation_type: calcType,
                calculation_value: Number(value) || 0,
                is_active: isActive,
                is_fixed: isFixed,
              });
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}

function StatusToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      className={`hr-salary-components__toggle ${checked ? "hr-salary-components__toggle--on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-label={checked ? "Active" : "Inactive"}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

export default function SalaryComponents() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("earnings");
  const [earnings, setEarnings] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [overtime, setOvertime] = useState(DEFAULT_OVERTIME);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState("create");
  const [editingRow, setEditingRow] = useState(null);
  const [savingOvertime, setSavingOvertime] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [earnRes, dedRes, otRes] = await Promise.all([
        getSalaryComponents({ type: "earnings" }),
        getSalaryComponents({ type: "deductions" }),
        getOvertimeSettings(),
      ]);
      const earnRows = earnRes?.data?.items || earnRes?.data;
      const dedRows = dedRes?.data?.items || dedRes?.data;
      setEarnings(Array.isArray(earnRows) ? earnRows : []);
      setDeductions(Array.isArray(dedRows) ? dedRows : []);
      setOvertime(otRes?.data || DEFAULT_OVERTIME);
    } catch {
      setEarnings([]);
      setDeductions([]);
      setOvertime(DEFAULT_OVERTIME);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));
  useEffect(() => { load(); }, [load]);

  const rows = tab === "earnings" ? earnings : deductions;

  const handleSaveComponent = async (payload) => {
    const isEarning = tab === "earnings";
    const current = isEarning ? earnings : deductions;

    if (drawerMode === "edit" && editingRow) {
      try {
        const res = await updateSalaryComponent(editingRow.id, { ...payload, type: tab });
        const updated = res?.data || { ...editingRow, ...payload };
        const next = current.map((row) => (row.id === editingRow.id ? updated : row));
        if (isEarning) setEarnings(next);
        else setDeductions(next);
        addToast("Component updated", "success");
      } catch (err) {
        addToast(err?.response?.data?.detail || "Failed to update component", "error");
      }
      return;
    }

    try {
      await createSalaryComponent({ ...payload, type: tab });
      addToast("Component added", "success");
      await load(true);
    } catch (err) {
      addToast(err?.response?.data?.detail || "Failed to add component", "error");
    }
  };

  const handleDelete = async (row) => {
    const isEarning = tab === "earnings";
    const current = isEarning ? earnings : deductions;
    const next = current.filter((r) => r.id !== row.id);
    try {
      await deleteSalaryComponent(row.id);
      if (isEarning) setEarnings(next);
      else setDeductions(next);
      addToast("Component deleted", "success");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Failed to delete component";
      addToast(msg, "error");
    }
  };

  const handleToggleStatus = async (row) => {
    const isEarning = tab === "earnings";
    const current = isEarning ? earnings : deductions;
    const next = current.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r));
    try {
      await updateSalaryComponent(row.id, { is_active: !row.is_active, type: tab });
      if (isEarning) setEarnings(next);
      else setDeductions(next);
    } catch {
      addToast("Failed to update component status", "error");
    }
  };

  const handleSaveOvertime = async () => {
    setSavingOvertime(true);
    try {
      await saveOvertimeSettings(overtime);
      addToast("Overtime settings saved", "success");
    } catch {
      addToast("Failed to save overtime settings", "error");
    } finally {
      setSavingOvertime(false);
    }
  };

  const showAddButton = tab !== "overtime";

  const overtimeFields = useMemo(() => ({
    fixed_amount: overtime.fixed_amount ?? "",
    gross_multiplier: overtime.gross_multiplier ?? "",
    basic_multiplier: overtime.basic_multiplier ?? "",
  }), [overtime]);

  if (loading) return <Loader label="Loading salary components..." />;

  return (
    <ListPageShell>
      <div className="hr-salary-components min-w-0">
        <div className="hr-salary-components__top">
          <h1 className="hr-salary-components__title">Salary Components</h1>
          {showAddButton ? (
            <button
              type="button"
              className="hr-salary-components__add-btn"
              onClick={() => {
                setDrawerMode("create");
                setEditingRow(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add Component
            </button>
          ) : (
            <span aria-hidden />
          )}
        </div>

        <div className="hr-salary-components__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`hr-salary-components__tab ${tab === t.key ? "hr-salary-components__tab--active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overtime" ? (
          <div className="hr-salary-components__overtime-card">
            <h2 className="hr-salary-components__overtime-title">Set Calculation for overtime</h2>

            <label className="hr-salary-components__ot-option">
              <input
                type="radio"
                name="otMode"
                checked={overtime.mode === "fixed_amount"}
                onChange={() => setOvertime((p) => ({ ...p, mode: "fixed_amount" }))}
              />
              <span className="hr-salary-components__ot-label">
                Fixed amount of
                <span className="hr-salary-components__ot-input-wrap">
                  <span className="hr-salary-components__ot-prefix">₹</span>
                  <input
                    type="number"
                    min="0"
                    value={overtimeFields.fixed_amount}
                    onChange={(e) => setOvertime((p) => ({ ...p, fixed_amount: e.target.value }))}
                  />
                </span>
                is paid per overtime hour
              </span>
            </label>
            <p className="hr-salary-components__ot-hint">
              <Info className="h-3.5 w-3.5" />
              Enter a specific amount to be paid for each overtime hours
            </p>

            <label className="hr-salary-components__ot-option">
              <input
                type="radio"
                name="otMode"
                checked={overtime.mode === "gross_multiplier"}
                onChange={() => setOvertime((p) => ({ ...p, mode: "gross_multiplier" }))}
              />
              <span className="hr-salary-components__ot-label">
                <span className="hr-salary-components__ot-input-wrap hr-salary-components__ot-input-wrap--plain">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={overtimeFields.gross_multiplier}
                    onChange={(e) => setOvertime((p) => ({ ...p, gross_multiplier: e.target.value }))}
                  />
                </span>
                Times of hourly gross pay is paid per overtime hour
              </span>
            </label>
            <p className="hr-salary-components__ot-hint">
              <Info className="h-3.5 w-3.5" />
              Set the multiplier to calculate overtime pay based on the employee&apos;s gross pay. Formula: [(Gross Salary / Total Shift Hours) × Approved Overtime Hours] × Multiplier
            </p>

            <label className="hr-salary-components__ot-option">
              <input
                type="radio"
                name="otMode"
                checked={overtime.mode === "basic_multiplier"}
                onChange={() => setOvertime((p) => ({ ...p, mode: "basic_multiplier" }))}
              />
              <span className="hr-salary-components__ot-label">
                <span className="hr-salary-components__ot-input-wrap hr-salary-components__ot-input-wrap--plain">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={overtimeFields.basic_multiplier}
                    onChange={(e) => setOvertime((p) => ({ ...p, basic_multiplier: e.target.value }))}
                  />
                </span>
                Times of hourly basic pay is paid per overtime hour
              </span>
            </label>
            <p className="hr-salary-components__ot-hint">
              <Info className="h-3.5 w-3.5" />
              Set the multiplier to calculate overtime pay based on the employee&apos;s Basic Pay + DA. Formula: [[(Basic Pay + DA) / Total shift hours] × Approved Overtime Hours] × Multiplier
            </p>

            <div className="hr-salary-components__overtime-footer">
              <button
                type="button"
                className="hr-salary-components__save-btn"
                disabled={savingOvertime}
                onClick={handleSaveOvertime}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="hr-salary-components__table-wrap">
            <table className="hr-salary-components__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Calculation Type</th>
                  <th>Calculation Value</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="hr-salary-components__empty">
                      <div className="flex flex-col items-center justify-center py-6 gap-2">
                        <span className="text-slate-500">No {tab === "earnings" ? "earning" : "deduction"} components found</span>
                        <button
                          type="button"
                          onClick={() => {
                            setDrawerMode("create");
                            setEditingRow(null);
                            setDrawerOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors shadow-xs"
                        >
                          <Plus className="h-4 w-4" />
                          Add {tab === "earnings" ? "Earning" : "Deduction"} Component
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{calcTypeLabel(row.calculation_type)}</td>
                      <td>{formatCalcValue(row)}</td>
                      <td>
                        <StatusToggle
                          checked={row.is_active !== false}
                          onChange={() => handleToggleStatus(row)}
                        />
                      </td>
                      <td>
                        <div className="hr-salary-components__actions">
                          <button
                            type="button"
                            className="hr-salary-components__icon-btn"
                            aria-label={`Edit ${row.name}`}
                            onClick={() => {
                              setDrawerMode("edit");
                              setEditingRow(row);
                              setDrawerOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="hr-salary-components__icon-btn"
                            aria-label={`Delete ${row.name}`}
                            onClick={() => handleDelete(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <ComponentDrawer
          open={drawerOpen}
          mode={drawerMode}
          tab={tab}
          initial={editingRow}
          onClose={() => setDrawerOpen(false)}
          onSave={handleSaveComponent}
        />
      </div>
    </ListPageShell>
  );
}
