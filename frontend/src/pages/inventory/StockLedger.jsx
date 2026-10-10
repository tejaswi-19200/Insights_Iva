import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CalendarDays,
  ClipboardList,
  Eye,
  Filter,
  Hash,
  RefreshCw,
  Wrench,
} from "lucide-react";

import Button, { ViewButton } from "../../components/common/Button";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import { ListPageCard, ListPageCardBody, ListPageShell } from "../../components/common/ListPageShell";
import { SearchBar } from "../../components/common/SearchFilter";
import DataTable from "../../components/common/DataTable";
import EmptyState from "../../components/common/EmptyState";
import KpiCard from "../../components/common/KpiCard";
import Loader from "../../components/common/Loader";
import PageHeader from "../../components/common/PageHeader";
import { HeaderWarehouseField } from "../../components/inventory/InventoryHeaderControls";
import StatusBadge from "../../components/common/StatusBadge";
import RecordDetailModal from "../../components/inventory/RecordDetailModal";
import StoreManagerNav from "../../components/inventory/StoreManagerNav";
import { useToast } from "../../context/ToastContext";
import { getStockLedger, getWarehouses } from "../../api/inventoryApi";
import useManufacturingRefresh from "../../hooks/useManufacturingRefresh";
import { exportToExcel, exportToPdf } from "../../utils/exportUtils";
import useAuth from "../../hooks/useAuth";
import { isStoreManager } from "../../config/permissions";
import { asArray } from "../../utils/apiError";
import { todayIso } from "../../utils/dateUtils";

const STOCK_LEDGER_EXPORT_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "item_name", label: "Item" },
  { key: "item_code", label: "Item Code" },
  { key: "transaction", label: "Type" },
  { key: "reference", label: "Reference" },
  { key: "warehouse_name", label: "Warehouse" },
  { key: "qty_in", label: "Stock In" },
  { key: "qty_out", label: "Stock Out" },
  { key: "balance", label: "Balance" },
  { key: "unit", label: "UOM" },
  { key: "user_name", label: "User" },
  { key: "remarks", label: "Remarks" },
];

function formatQty(value, { dashZero = true } = {}) {
  if (value == null || value === "") return "—";
  if (dashZero && Number(value) === 0) return "—";
  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQtyByUnit(totals) {
  const parts = Object.entries(totals)
    .filter(([, quantity]) => quantity > 0)
    .sort(([unitA], [unitB]) => unitA.localeCompare(unitB))
    .map(([unit, quantity]) => `${formatQty(quantity, { dashZero: false })} ${unit}`);
  if (parts.length <= 1) return parts[0] || "0.00";
  return (
    <span title={parts.join(" · ")} aria-label={parts.join(", ")}>
      Multiple units
    </span>
  );
}

function formatDateParts(value) {
  if (!value) return { day: "—", time: "" };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { day: String(value).slice(0, 10), time: "" };
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

function displayDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function resolveTxnType(row) {
  const t = String(row.transaction || "").toLowerCase().replace(/\s+/g, "_");
  if (["in", "purchase", "return", "production"].includes(t)) return "in";
  if (["out", "sales", "sale", "issue", "scrap"].includes(t)) return "out";
  if (t === "transfer_out" || (t === "transfer" && Number(row.qty_out) > 0)) return "transfer_out";
  if (t === "transfer_in" || (t === "transfer" && Number(row.qty_in) > 0)) return "transfer_in";
  if (t === "transfer") return "transfer_out";
  if (t === "adjustment") return "adjustment";
  return t || "adjustment";
}

function txnBadge(type) {
  const map = {
    in: { label: "Stock In", tone: "success", Icon: ArrowDownToLine },
    out: { label: "Stock Out", tone: "danger", Icon: ArrowUpFromLine },
    transfer_out: { label: "Transfer Out", tone: "warning", Icon: ArrowLeftRight },
    transfer_in: { label: "Transfer In", tone: "info", Icon: ArrowLeftRight },
    adjustment: { label: "Adjustment", tone: "pending", Icon: Wrench },
  };
  return map[type] || { label: type, tone: "neutral", Icon: Hash };
}

function ClickableKpiCard({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block h-full w-full border-0 p-0 bg-transparent text-left focus:outline-none cursor-pointer"
      title={title}
    >
      {children}
    </button>
  );
}

export default function StockLedger({ variant = "" }) {
  const [searchParams] = useSearchParams();
  const todaysStockOutMode = variant === "todays_stock_out";
  const { addToast } = useToast();
  const { user } = useAuth();
  const storeMode = isStoreManager(user);
  const kpiDate = searchParams.get("date");
  const kpiDirection = String(searchParams.get("direction") || "").toLowerCase();
  const dateFromRef = useRef(null);
  const dateToRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [warehousesApi, setWarehousesApi] = useState([]);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    warehouse: "",
    item: "",
    type: "",
  });
  const [headerWarehouse, setHeaderWarehouse] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [remarksWidth, setRemarksWidth] = useState(220);
  const [viewTarget, setViewTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, whRes] = await Promise.allSettled([
        getStockLedger(),
        getWarehouses(),
      ]);
      if (listRes.status === "fulfilled") setEntries(asArray(listRes.value?.data));
      else setEntries([]);
      if (whRes.status === "fulfilled") setWarehousesApi(asArray(whRes.value?.data));
      else setWarehousesApi([]);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (todaysStockOutMode) {
      const day = todayIso();
      setFilters((f) => ({
        ...f,
        dateFrom: day,
        dateTo: day,
        type: "out",
      }));
      setShowFilters(true);
      return;
    }
    if (!kpiDate && !kpiDirection) return;
    setFilters((f) => {
      const next = { ...f };
      if (kpiDate) {
        next.dateFrom = kpiDate;
        next.dateTo = kpiDate;
      }
      if (kpiDirection === "in") next.type = "in";
      if (kpiDirection === "out") next.type = "out";
      return next;
    });
    setShowFilters(true);
  }, [kpiDate, kpiDirection, todaysStockOutMode]);
  useManufacturingRefresh(load);

  useEffect(() => {
    if (!headerWarehouse && warehousesApi.length) {
      setHeaderWarehouse(warehousesApi[0].name || String(warehousesApi[0].id));
    }
  }, [warehousesApi, headerWarehouse]);

  const rows = useMemo(
    () =>
      entries.map((e) => ({
        ...e,
        item_code: e.item_code || e.sku || e.batch_number || "",
        unit: e.unit || "",
        remarks: e.remarks || e.notes || "",
        live: true,
      })),
    [entries]
  );

  const warehouses = useMemo(() => {
    const set = new Set();
    rows.forEach((e) => {
      if (e.warehouse_name) set.add(e.warehouse_name);
    });
    warehousesApi.forEach((w) => {
      if (w.name) set.add(w.name);
    });
    return Array.from(set).sort();
  }, [rows, warehousesApi]);

  const itemOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((e) => {
      if (e.item_name) set.add(e.item_name);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((r) =>
        [r.item_name, r.item_code, r.warehouse_name, r.transaction, r.reference, r.remarks]
          .some((value) => value != null && String(value).toLowerCase().includes(query))
      );
    }
    if (filters.type) {
      list = list.filter((r) => resolveTxnType(r) === filters.type);
    }
    if (filters.item) {
      list = list.filter((r) => r.item_name === filters.item);
    }
    if (filters.warehouse) {
      list = list.filter((r) => r.warehouse_name === filters.warehouse);
    }
    if (filters.dateFrom) {
      list = list.filter((r) => r.date && String(r.date).slice(0, 10) >= filters.dateFrom);
    }
    if (filters.dateTo) {
      list = list.filter((r) => r.date && String(r.date).slice(0, 10) <= filters.dateTo);
    }
    return list;
  }, [rows, search, filters]);

  const kpis = useMemo(() => {
    const totals = { stockIn: {}, stockOut: {} };
    let transferCount = 0;
    let adjustmentCount = 0;
    filtered.forEach((row) => {
      const type = resolveTxnType(row);
      const unit = String(row.unit || "Unit").trim();
      const quantity = Math.abs(Number(row.qty_in) || Number(row.qty_out) || 0);
      const bucket = type === "in" ? totals.stockIn
        : type === "out" ? totals.stockOut
          : null;
      if (bucket && quantity > 0) bucket[unit] = (bucket[unit] || 0) + quantity;
      if (type === "transfer_in" || type === "transfer_out") transferCount += 1;
      if (type === "adjustment") adjustmentCount += 1;
    });
    return {
      stock_in: totals.stockIn,
      stock_out: totals.stockOut,
      transfers: transferCount,
      adjustments: adjustmentCount,
      total_transactions: filtered.length,
    };
  }, [filtered]);

  const clearFilters = () => {
    setSearch("");
    setFilters({
      dateFrom: "",
      dateTo: "",
      warehouse: "",
      item: "",
      type: "",
    });
  };

  const handleView = (row) => setViewTarget(row);

  const viewFields = viewTarget
    ? (() => {
        const type = resolveTxnType(viewTarget);
        const meta = txnBadge(type);
        const { day, time } = formatDateParts(viewTarget.date);
        return [
          { label: "Date", value: day },
          { label: "Time", value: time },
          { label: "Item", value: viewTarget.item_name },
          { label: "Item Code", value: viewTarget.item_code },
          { label: "Transaction Type", value: meta.label },
          { label: "Reference No.", value: viewTarget.reference },
          { label: "Warehouse", value: viewTarget.warehouse_name },
          { label: "Stock In", value: viewTarget.qty_in ? formatQty(viewTarget.qty_in) : "—" },
          { label: "Stock Out", value: viewTarget.qty_out ? formatQty(viewTarget.qty_out) : "—" },
          { label: "Balance", value: viewTarget.balance != null ? formatQty(viewTarget.balance) : "—" },
          { label: "UOM", value: viewTarget.unit },
          { label: "User", value: viewTarget.user_name },
          { label: "Remarks", value: viewTarget.remarks },
        ];
      })()
    : [];

  const columns = [
    {
      key: "date",
      label: "Date & Time",
      width: 140,
      minWidth: 140,
      render: (r) => {
        const { day, time } = formatDateParts(r.date);
        return (
          <div className="whitespace-nowrap">
            <p className="text-[13px] font-medium text-[var(--color-text)]">{day}</p>
            <p className="text-[11px] text-[var(--color-text-muted)]">{time}</p>
          </div>
        );
      },
    },
    {
      key: "item_name",
      label: "Item",
      width: 190,
      minWidth: 190,
      render: (r) => (
        <div className="max-w-[180px]">
          <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">{r.item_name || "—"}</p>
          <p className="truncate text-[11px] text-[var(--color-text-muted)]">{r.item_code || "—"}</p>
        </div>
      ),
    },
    {
      key: "transaction",
      label: "Transaction Type",
      width: 140,
      minWidth: 140,
      render: (r) => {
        const type = resolveTxnType(r);
        const meta = txnBadge(type);
        const Icon = meta.Icon;
        return (
          <StatusBadge tone={meta.tone}>
            <span className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
          </StatusBadge>
        );
      },
    },
    {
      key: "reference",
      label: "Reference No.",
      width: 280,
      minWidth: 280,
      render: (r) => (
        <span
          className="block truncate ui-num text-[12px] text-[var(--color-text-secondary)]"
          title={r.reference || ""}
        >
          {r.reference || "—"}
        </span>
      ),
    },
    {
      key: "warehouse_name",
      label: "Warehouse",
      width: 130,
      minWidth: 130,
      render: (r) => <span className="text-[13px] text-[var(--color-text-secondary)]">{r.warehouse_name || "—"}</span>,
    },
    {
      key: "qty_in",
      label: "Stock In",
      align: "center",
      width: 100,
      minWidth: 100,
      render: (r) => (
        <span className={`text-[13px] ${r.qty_in ? "ui-value-positive ui-num" : "ui-value-neutral ui-num"}`}>
          {r.qty_in ? formatQty(r.qty_in) : "—"}
        </span>
      ),
    },
    {
      key: "qty_out",
      label: "Stock Out",
      align: "center",
      width: 100,
      minWidth: 100,
      render: (r) => (
        <span className={`text-[13px] ${r.qty_out ? "ui-value-negative ui-num" : "ui-value-neutral ui-num"}`}>
          {r.qty_out ? formatQty(r.qty_out) : "—"}
        </span>
      ),
    },
    {
      key: "balance",
      label: "Balance",
      align: "center",
      width: 100,
      minWidth: 100,
      render: (r) => (
        <span className="ui-num text-[13px] font-semibold text-[var(--color-text)]">
          {r.balance != null ? formatQty(r.balance) : "—"}
        </span>
      ),
    },
    {
      key: "unit",
      label: "UOM",
      align: "center",
      width: 80,
      minWidth: 80,
      render: (r) => <span className="text-[13px] text-[var(--color-text-secondary)]">{r.unit || "—"}</span>,
    },
    {
      key: "user_name",
      label: "User",
      width: 120,
      minWidth: 120,
      render: (r) => <span className="text-[13px] text-[var(--color-text-secondary)]">{r.user_name || "—"}</span>,
    },
    {
      key: "remarks",
      label: "Remarks",
      sortable: false,
      minWidth: remarksWidth,
      width: remarksWidth,
      render: (r) => (
        <span
          className="block whitespace-normal break-words text-[12px] leading-snug text-[var(--color-text-muted)]"
          title={r.remarks || ""}
        >
          {r.remarks || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "center",
      sortable: false,
      width: 96,
      minWidth: 96,
      className: "min-w-[6rem] w-[6rem] whitespace-nowrap",
      render: (r) => (
        <div className="flex items-center justify-center whitespace-nowrap">
          <ViewButton
            size="sm"
            leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => handleView(r)}
          >
            View
          </ViewButton>
        </div>
      ),
    },
  ];

  const exportRows = useMemo(
    () =>
      filtered.map((r) => ({
        ...r,
        transaction: txnBadge(resolveTxnType(r)).label,
      })),
    [filtered]
  );

  const handleExport = (format) => {
    if (format === "pdf") {
      exportToPdf(exportRows, STOCK_LEDGER_EXPORT_COLUMNS, "Stock Ledger", "stock-ledger");
    } else {
      exportToExcel(exportRows, STOCK_LEDGER_EXPORT_COLUMNS, "stock-ledger");
    }
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  if (loading) {
    return (
      <div className="space-y-5 pb-4">
        {storeMode ? <StoreManagerNav /> : null}
        <Loader label="Loading stock ledger…" />
      </div>
    );
  }

  return (
    <ListPageShell>
    <div className="min-w-0 space-y-5 pb-4">
      {storeMode ? <StoreManagerNav /> : null}

      {todaysStockOutMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          <span>
            Showing stock-out movements only for today. Total matching: {filtered.length.toLocaleString("en-IN")}
          </span>
          <Link to="/inventory/stock-ledger" className="font-semibold text-[var(--color-primary)] hover:underline">
            Open full stock ledger
          </Link>
        </div>
      ) : null}

      <PageHeader
        variant="inventory"
        title={todaysStockOutMode ? "Today's Stock Out" : "Stock Ledger"}
        subtitle={
          todaysStockOutMode
            ? `Stock-out transactions for ${displayDate(todayIso())} (local business date).`
            : "Track and analyze stock movement history"
        }
        action={
          <div className="flex flex-wrap items-end gap-3">
            <div className="inventory-header-control">
              <span className="inventory-header-control__label">Period</span>
              <div className="inventory-header-control__surface cursor-pointer">
                <div className="flex min-w-[12rem] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]">
                  <input
                    ref={dateFromRef}
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                    aria-label="Start date"
                    className="sr-only"
                  />
                  <input
                    ref={dateToRef}
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                    aria-label="End date"
                    className="sr-only"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (dateFromRef.current) {
                        if (typeof dateFromRef.current.showPicker === "function") {
                          dateFromRef.current.showPicker();
                        } else {
                          dateFromRef.current.click();
                        }
                      }
                    }}
                    className="inventory-header-control__icon-btn !static !h-auto !w-auto !transform-none hover:bg-transparent"
                    aria-label="Open start date picker"
                  >
                    <CalendarDays className="h-4 w-4 text-[var(--color-text-icon)]" />
                  </button>
                  <span className="whitespace-nowrap">
                    {filters.dateFrom || "Start date"} – {filters.dateTo || "End date"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (dateToRef.current) {
                        if (typeof dateToRef.current.showPicker === "function") {
                          dateToRef.current.showPicker();
                        } else {
                          dateToRef.current.click();
                        }
                      }
                    }}
                    className="inventory-header-control__icon-btn !static !h-auto !w-auto !transform-none hover:bg-transparent"
                    aria-label="Open end date picker"
                  >
                    <CalendarDays className="h-4 w-4 text-[var(--color-text-icon)]" />
                  </button>
                </div>
              </div>
            </div>
            <HeaderWarehouseField
              label="Warehouse"
              value={headerWarehouse}
              onChange={(value) => {
                setHeaderWarehouse(value);
                setFilters((f) => ({ ...f, warehouse: value }));
              }}
              warehouseOptions={
                warehouses.length
                  ? warehouses.map((w) => ({ value: w, label: w }))
                  : [{ value: "", label: "Main Warehouse" }]
              }
            />
          </div>
        }
      />

      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${todaysStockOutMode ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}>
        {!todaysStockOutMode ? (
          <ClickableKpiCard
            onClick={() => setFilters((f) => ({ ...f, type: "in" }))}
            title="Filter stock in transactions"
            tone="success"
          >
            <KpiCard
              label="Total Stock In"
              value={formatQtyByUnit(kpis.stock_in)}
              icon={ArrowDownToLine}
              tone="success"
              meta="Click to filter"
              className="[&_.ui-kpi__value]:!text-[#16a34a]"
            />
          </ClickableKpiCard>
        ) : null}
        <ClickableKpiCard
          onClick={() => setFilters((f) => ({ ...f, type: "out" }))}
          title="Filter stock out transactions"
          tone="danger"
        >
          <KpiCard
            label="Total Stock Out"
            value={formatQtyByUnit(kpis.stock_out)}
            icon={ArrowUpFromLine}
            tone="danger"
            meta="Click to filter"
            className="[&_.ui-kpi__value]:!text-[#ef4444]"
          />
        </ClickableKpiCard>
        <ClickableKpiCard
          onClick={() => setFilters((f) => ({ ...f, type: "transfer_in" }))}
          title="Filter transfer transactions"
          tone="info"
        >
          <KpiCard
            label="Total Transfers"
            value={Number(kpis.transfers).toLocaleString("en-IN")}
            icon={ArrowLeftRight}
            tone="info"
            meta="Click to filter"
            className="[&_.ui-kpi__value]:!text-[#2563eb]"
          />
        </ClickableKpiCard>
        <ClickableKpiCard
          onClick={() => setFilters((f) => ({ ...f, type: "adjustment" }))}
          title="Filter adjustment transactions"
          tone="warning"
        >
          <KpiCard
            label="Total Adjustments"
            value={Number(kpis.adjustments).toLocaleString("en-IN")}
            icon={ClipboardList}
            tone="warning"
            meta="Click to filter"
            className="[&_.ui-kpi__value]:!text-[#ea580c]"
          />
        </ClickableKpiCard>
        <ClickableKpiCard
          onClick={() => setFilters((f) => ({ ...f, type: "" }))}
          title="Show all transactions"
          tone="primary"
        >
          <KpiCard
            label="Total Transactions"
            value={Number(kpis.total_transactions).toLocaleString("en-IN")}
            icon={Hash}
            tone="primary"
            meta="Click to show all"
            className="[&_.ui-kpi__value]:!text-[#7c3aed]"
          />
        </ClickableKpiCard>
      </div>

      <div className="ui-card p-3 sm:p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search stock movements"
              className="w-full min-w-0 max-w-none flex-1 xl:mr-4"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowFilters((open) => !open)}
                aria-expanded={showFilters}
              >
                <Filter className="h-4 w-4" /> Filters
              </Button>
              <Button type="button" variant="ghost" onClick={clearFilters}>
                <RefreshCw className="h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
          {showFilters ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm min-w-0">
              <span className="ui-label">Item</span>
              <select
                value={filters.item}
                onChange={(e) => setFilters((f) => ({ ...f, item: e.target.value }))}
                className="ui-select w-full"
              >
                <option value="">All Items</option>
                {itemOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="ui-label">Warehouse</span>
              <select
                value={filters.warehouse}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, warehouse: e.target.value }));
                  setHeaderWarehouse(e.target.value);
                }}
                className="ui-select"
              >
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="ui-label">Transaction Type</span>
              <select
                value={filters.type}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
                className="ui-select"
              >
                <option value="">All Types</option>
                <option value="in">Stock In</option>
                <option value="out">Stock Out</option>
                <option value="transfer_in">Transfer In</option>
                <option value="transfer_out">Transfer Out</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="ui-label">Remarks width</span>
              <input
                type="range"
                min={140}
                max={480}
                step={20}
                value={remarksWidth}
                onChange={(e) => setRemarksWidth(Number(e.target.value))}
                className="mt-2 block h-1.5 w-36 cursor-ew-resize accent-[var(--color-primary)]"
                aria-label="Adjust remarks column width"
              />
            </label>
          </div> : null}
        </div>
      </div>

      <ListPageCard>
        <ListPageCardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Stock Movements</h2>
          <ExportDownloadMenu disabled={!exportRows.length} onExport={handleExport} />
        </div>

        <DataTable
          columns={columns}
          data={filtered}
          tableClassName="min-w-[1792px] table-fixed"
          showSearch={false}
          pageSize={10}
          wrapClassName="inventory-table-scroll--ledger rounded-lg border border-[var(--color-border-soft)]"
          emptyState={
            <EmptyState
              icon="document"
              title="No records found."
              description="There is nothing to show here yet."
              className="border-none bg-transparent py-12"
            />
          }
        />
        </ListPageCardBody>
      </ListPageCard>

      <RecordDetailModal
        open={Boolean(viewTarget)}
        title="Ledger Entry"
        subtitle={viewTarget?.item_name}
        fields={viewFields}
        onClose={() => setViewTarget(null)}
      />
    </div>
    </ListPageShell>
  );
}
