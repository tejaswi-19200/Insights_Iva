import { useCallback, useEffect, useMemo, useState } from "react";
import usePageRefresh from "../../hooks/usePageRefresh";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Ban,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  FileText,
  Filter,
  ListFilter,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";

import Loader from "../../components/common/Loader";
import { canConvertQuotationToSalesOrder } from "../../utils/quotationWorkflow";
import PageHeader from "../../components/common/PageHeader";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import ConfirmationDialog from "../../components/common/ConfirmationDialog";
import { ListPageShell } from "../../components/common/ListPageShell";
import { SearchBar } from "../../components/common/SearchFilter";
import Button from "../../components/common/Button";
import EmptyState from "../../components/common/EmptyState";
import RowActionMenu from "../../components/common/RowActionMenu";
import { SerialNumberCell, SerialNumberHeader } from "../../components/common/SerialNumberCell";
import QuoteDetailModal from "../../components/sales/QuoteDetailModal";
import { useToast } from "../../context/ToastContext";
import {
  cancelQuotation,
  getQuotationSummary,
  getQuotationsEnriched,
  deleteQuotation,
  updateQuotationStatus,
} from "../../api/salesApi";
import { apiErrorMessage } from "../../utils/apiError";
import { formatQuotationInr, statusColor } from "../../data/salesMasterData";
import { runListExport } from "../../utils/listExport";
import { InlineNativeDateRange } from "../../design-system/dateControls";
import {
  salesListTextMuted,
  salesListTextPrimary,
  salesListTextSecondary,
} from "../../components/sales/salesListDesignSystem";

const QUOTATION_EXPORT_COLUMNS = [
  { key: "quote_number", label: "Quotation No." },
  { key: "quote_date", label: "Date" },
  { key: "customer_name", label: "Party Name" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
];
const PAGE_SIZES = [10, 20, 50];

const SORT_OPTIONS = [
  { id: "date_desc", label: "Quotation date (Latest First)" },
  { id: "date_asc", label: "Quotation date (Oldest First)" },
  { id: "amount_desc", label: "Quotation Amount (High to Low)" },
  { id: "amount_asc", label: "Quotation Amount (Low to High)" },
];

const EMPTY_FILTERS = {
  quotationType: "",
  amountBand: "",
};

const AMOUNT_BANDS = [
  { id: "under_2k", label: "under ₹2,000", min: 0, max: 2000 },
  { id: "2k_5k", label: "₹2,000-₹5,000", min: 2000, max: 5000 },
  { id: "5k_10k", label: "₹5,000-₹10,000", min: 5000, max: 10000 },
  { id: "10k_20k", label: "₹10,000-₹20,000", min: 10000, max: 20000 },
  { id: "20k_above", label: "₹20,000-Above", min: 20000, max: Infinity },
];

function Chip({ label, active, onClick }) {
  return (
    <Button
      type="button"
      variant={active ? "primary" : "secondary"}
      size="sm"
      onClick={onClick}
      className="!rounded-full"
    >
      {label}
    </Button>
  );
}

function FilterSection({ label, children }) {
  return (
    <div className="border-b border-[var(--color-table-border)] py-4 last:border-b-0">
      <p className="mb-2.5 text-[12px] font-medium text-[var(--color-text-faint)]">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function SummaryTab({ label, count, amount, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-w-[125px] flex-1 shrink-0 border-b-[3px] px-4 py-2.5 sm:px-5 sm:py-3 text-left transition duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
        active
          ? "border-[var(--color-primary)] bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#0f172a)] shadow-sm"
          : "border-transparent bg-[var(--color-surface-muted,#f8fafc)] text-[var(--color-text-muted,#64748b)] hover:bg-[var(--color-surface,#ffffff)]"
      }`}
    >
      <p className={`text-xs sm:text-[13px] ${active ? "font-semibold text-indigo-900 dark:text-indigo-300" : "font-medium text-slate-600 dark:text-slate-400"}`}>
        {label} <span className="text-slate-400 font-normal">({count})</span>
      </p>
      <p className={`mt-0.5 text-base sm:text-[17px] font-bold tabular-nums ${active ? "text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}>
        {amount}
      </p>
    </button>
  );
}

function inAmountBand(amount, bandId) {
  const band = AMOUNT_BANDS.find((b) => b.id === bandId);
  if (!band) return true;
  const n = Number(amount) || 0;
  return n >= band.min && n < band.max;
}

function statusBucket(status) {
  const s = String(status || "").toLowerCase();
  if (["accepted", "approved"].includes(s)) return "accepted";
  if (["rejected", "cancelled", "canceled", "expired"].includes(s)) return "cancelled";
  return "pending";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return String(iso).slice(0, 10);
  return `${d}/${m}/${y}`;
}

export default function Quotations() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [selected, setSelected] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [searchParams] = useSearchParams();
  const [kpiFilter, setKpiFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-04-01");
  const [dateTo, setDateTo] = useState("2027-03-31");
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [sortId, setSortId] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.allSettled([
        getQuotationSummary(),
        getQuotationsEnriched(),
      ]);


      if (sumRes.status === "fulfilled" && sumRes.value?.data) setSummary(sumRes.value.data);
      else setSummary({});
      if (listRes.status === "fulfilled") setRows(listRes.value?.data || []);
      else setRows([]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  usePageRefresh(() => load(true));

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const kpi = searchParams.get("kpi");
    if (kpi === "pending") setKpiFilter("pending");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from) setDateFrom(from);
    if (to) setDateTo(to);
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [kpiFilter, search, filters, sortId, pageSize, dateFrom, dateTo]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q) {
        const hay = `${r.quote_number || ""} ${r.customer_name || ""} ${r.sales_person || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const d = String(r.quote_date || r.valid_until || "").slice(0, 10);
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      const bucket = statusBucket(r.status);
      if (kpiFilter === "pending" && bucket !== "pending") return false;
      if (kpiFilter === "accepted" && bucket !== "accepted") return false;
      if (kpiFilter === "cancelled" && bucket !== "cancelled") return false;
      if (filters.quotationType === "converted" && !r.converted_to_invoice) return false;
      if (filters.quotationType === "not_converted" && r.converted_to_invoice) return false;
      if (filters.amountBand && !inAmountBand(r.amount, filters.amountBand)) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      const da = String(a.quote_date || a.valid_until || "");
      const db = String(b.quote_date || b.valid_until || "");
      const aa = Number(a.amount) || 0;
      const ab = Number(b.amount) || 0;
      if (sortId === "date_asc") return da.localeCompare(db);
      if (sortId === "amount_desc") return ab - aa;
      if (sortId === "amount_asc") return aa - ab;
      return db.localeCompare(da);
    });
    return list;
  }, [rows, search, dateFrom, dateTo, kpiFilter, filters, sortId]);

  const tabStats = useMemo(() => {
    const base = rows;
    const sumAmt = (arr) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pending = base.filter((r) => statusBucket(r.status) === "pending");
    const accepted = base.filter((r) => statusBucket(r.status) === "accepted");
    const cancelled = base.filter((r) => statusBucket(r.status) === "cancelled");
    return {
      all: { count: base.length, amount: sumAmt(base) },
      pending: { count: pending.length, amount: sumAmt(pending) },
      accepted: { count: accepted.length, amount: sumAmt(accepted) },
      cancelled: { count: cancelled.length, amount: sumAmt(cancelled) },
    };
  }, [rows]);

  const total = filteredSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const handleStatusChange = async (row, newStatus, labelText) => {
    const label = row.quote_number || row.id;
    try {
      await updateQuotationStatus(row.id, newStatus);
      addToast(`Quotation ${label} marked as ${labelText || newStatus}.`, "success");
      await load();
    } catch (err) {
      addToast(apiErrorMessage(err, `Failed to update status for Quotation ${label}`), "error");
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    const label = cancelTarget.quote_number || cancelTarget.id;
    setCancelLoading(true);
    try {
      await cancelQuotation(cancelTarget.id);
      addToast(`Quotation ${label} cancelled successfully.`, "success");
      setCancelTarget(null);
      await load();
    } catch (err) {
      addToast(apiErrorMessage(err, `Failed to cancel Quotation ${label}`), "error");
    } finally {
      setCancelLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const label = deleteTarget.quote_number || deleteTarget.id;
    setDeleteLoading(true);
    try {
      await deleteQuotation(deleteTarget.id);
      addToast(`Quotation ${label} deleted successfully.`, "success");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      addToast(apiErrorMessage(err, `Failed to delete Quotation ${label}`), "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleStatus = async (quote, status) => {
    if (typeof quote.id === "number") {
      try {
        await updateQuotationStatus(quote.id, status);
        addToast(`Quotation marked as ${status}`);
        load();
      } catch (err) {
        addToast(err.response?.data?.detail || "Update failed", "error");
        return;
      }
    }
    setSelected(null);
  };

  const handleExport = (format) => {
    const exportRows = filteredSorted.map((r) => ({
      quote_number: r.quote_number,
      quote_date: fmtDate(r.quote_date || r.valid_until),
      customer_name: r.customer_name,
      amount: r.amount,
      status: r.status,
    }));
    runListExport(format, {
      data: exportRows,
      columns: QUOTATION_EXPORT_COLUMNS,
      filename: "quotations",
      title: "Quotations",
    });
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  if (loading) {
    return (
      <ListPageShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader label="Loading quotations..." />
        </div>
      </ListPageShell>
    );
  }

  return (
    <ListPageShell stackClassName="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="overflow-hidden rounded-xl border border-[var(--color-table-border)] bg-[var(--color-surface-muted)] flex-1 max-w-2xl">
          <div className="flex overflow-x-auto scrollbar-none" role="tablist" aria-label="Quotation status">
            <SummaryTab
              label="All Quotations"
              count={tabStats.all.count}
              amount={formatQuotationInr(tabStats.all.amount)}
              active={kpiFilter === "all"}
              onClick={() => setKpiFilter("all")}
            />
            <SummaryTab
              label="Pending"
              count={tabStats.pending.count}
              amount={formatQuotationInr(tabStats.pending.amount)}
              active={kpiFilter === "pending"}
              onClick={() => setKpiFilter("pending")}
            />
            <SummaryTab
              label="Accepted"
              count={tabStats.accepted.count}
              amount={formatQuotationInr(tabStats.accepted.amount)}
              active={kpiFilter === "accepted"}
              onClick={() => setKpiFilter("accepted")}
            />
            <SummaryTab
              label="Cancelled"
              count={tabStats.cancelled.count}
              amount={formatQuotationInr(tabStats.cancelled.amount)}
              active={kpiFilter === "cancelled"}
              onClick={() => setKpiFilter("cancelled")}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <InlineNativeDateRange
            from={dateFrom}
            to={dateTo}
            fromId="quotation-from-date"
            toId="quotation-to-date"
            onFromChange={(value) => {
              setDateFrom(value);
              setPage(1);
            }}
            onToChange={(value) => {
              setDateTo(value);
              setPage(1);
            }}
          />
          <Link
            to="/sales/quotations/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary,#2563eb)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            Create Quotation
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search quotations..." />
        <div className="flex items-center gap-2 shrink-0">
          <ExportDownloadMenu disabled={!filteredSorted.length} onExport={handleExport} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-initial"
            onClick={() => {
              setDraftFilters(filters);
              setShowFilters(true);
            }}
            leftIcon={<Filter className="h-4 w-4" aria-hidden />}
          >
            Filters
          </Button>
          <div className="relative flex-1 sm:flex-initial">
            <Button
              type="button"
              variant={showSort ? "outline" : "secondary"}
              size="sm"
              className="w-full"
              onClick={() => setShowSort((v) => !v)}
              leftIcon={<ListFilter className="h-4 w-4" aria-hidden />}
            >
              Sort by
            </Button>
            {showSort ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  aria-label="Close sort"
                  onClick={() => setShowSort(false)}
                />
                <div className="absolute right-0 z-20 mt-1.5 w-[280px] overflow-hidden rounded-xl border border-[var(--color-table-border)] bg-[var(--color-surface)] py-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSortId(opt.id);
                        setShowSort(false);
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-[13px] hover:bg-[var(--color-surface-hover)] ${
                        sortId === opt.id ? `font-semibold ${salesListTextPrimary}` : salesListTextSecondary
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Mobile Cards View */}
      <div className="space-y-3 md:hidden">
        {pageRows.length === 0 ? (
          <EmptyState
            icon="document"
            title="No records found."
            description="There is nothing to show here yet."
            className="border-none bg-transparent py-12"
          />
        ) : (
          pageRows.map((r) => (
            <div
              key={r.id}
              className="ui-card p-3.5 space-y-2.5 transition hover:border-[var(--color-primary-soft)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[var(--color-primary)]">
                      {r.quote_number}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusColor(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <h3 className="mt-1 font-semibold text-xs sm:text-sm text-[var(--color-text)] truncate">
                    {r.customer_name || "—"}
                  </h3>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <RowActionMenu
                    rowId={r.id}
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    items={[
                      {
                        label: "View / Print",
                        icon: <Eye className="h-4 w-4" />,
                        onClick: () => navigate(`/sales/quotations/${r.id}`),
                      },
                      {
                        label: "Edit",
                        icon: <Edit2 className="h-4 w-4" />,
                        onClick: () => navigate(`/sales/quotations/${r.id}/edit`),
                      },
                      canConvertQuotationToSalesOrder(r)
                        ? {
                            label: "Convert to Sales Order",
                            icon: <CheckCircle className="h-4 w-4" />,
                            onClick: () => setSelected(r),
                          }
                        : r.converted_to_so && r.converted_sales_order_number
                          ? {
                              label: "Converted",
                              disabled: true,
                            }
                          : null,
                      (r.status || "").toLowerCase() === "draft"
                        ? {
                            label: "Mark as Sent",
                            icon: <Send className="h-4 w-4" />,
                            onClick: () => handleStatusChange(r, "sent", "Sent"),
                          }
                        : null,
                      ["draft", "sent"].includes((r.status || "").toLowerCase())
                        ? {
                            label: "Mark as Accepted",
                            icon: <Check className="h-4 w-4" />,
                            onClick: () => handleStatusChange(r, "accepted", "Accepted"),
                          }
                        : null,
                      (r.status || "").toLowerCase() === "cancelled"
                        ? {
                            label: "Reopen as Draft",
                            icon: <RotateCcw className="h-4 w-4" />,
                            onClick: () => handleStatusChange(r, "draft", "Draft"),
                          }
                        : null,
                      { divider: true },
                      (r.status || "").toLowerCase() !== "cancelled"
                        ? {
                            label: "Cancel",
                            icon: <Ban className="h-4 w-4" />,
                            danger: true,
                            onClick: () => setCancelTarget(r),
                          }
                        : null,
                      {
                        label: "Delete",
                        icon: <Trash2 className="h-4 w-4" />,
                        danger: true,
                        onClick: () => setDeleteTarget(r),
                      },
                    ].filter(Boolean)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--color-border-soft)] pt-2 text-xs">
                <div>
                  <span className={`${salesListTextMuted} text-[11px] block font-medium`}>Date</span>
                  <span className={`${salesListTextSecondary} font-medium`}>{fmtDate(r.quote_date)}</span>
                </div>
                <div className="text-right">
                  <span className={`${salesListTextMuted} text-[11px] block font-medium`}>Amount</span>
                  <span className={`text-sm font-bold tabular-nums ${salesListTextPrimary}`}>{formatQuotationInr(r.amount)}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-soft)] pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/sales/quotations/${r.id}`)}
                  leftIcon={<Eye className="h-3.5 w-3.5" />}
                >
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/sales/quotations/${r.id}/edit`)}
                  leftIcon={<Edit2 className="h-3.5 w-3.5" />}
                >
                  Edit
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-[var(--color-table-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="ui-table-head">
              <tr>
                <SerialNumberHeader className="border-b border-r border-[var(--color-table-border)]" />
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Quotation No.</th>
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Date</th>
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Party Name</th>
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Amount</th>
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Status</th>
                <th className="border-b border-r border-[var(--color-table-border)] px-4 py-3 last:border-r-0">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-none p-0">
                    <EmptyState
                      icon="document"
                      title="No records found."
                      description="There is nothing to show here yet."
                      className="border-none bg-transparent py-12"
                    />
                  </td>
                </tr>
              ) : (
                pageRows.map((r, rowIndex) => (
                  <tr key={r.id} className="hover:bg-[var(--color-table-row-hover)]">
                    <SerialNumberCell
                      rowIndex={rowIndex}
                      page={page}
                      pageSize={pageSize}
                      className="border-t border-r border-[var(--color-table-border)]"
                    />
                    <td className="border-t border-r border-[var(--color-table-border)] px-4 py-3 font-semibold text-[var(--color-primary)]">
                      {r.quote_number}
                    </td>
                    <td className="border-t border-r border-[var(--color-table-border)] px-4 py-3 text-[var(--color-text-secondary)]">{fmtDate(r.quote_date)}</td>
                    <td className="border-t border-r border-[var(--color-table-border)] px-4 py-3 text-[var(--color-text)]">{r.customer_name || "—"}</td>
                    <td className="border-t border-r border-[var(--color-table-border)] px-4 py-3 tabular-nums font-medium text-[var(--color-text)]">
                      {formatQuotationInr(r.amount)}
                    </td>
                    <td className="border-t border-r border-[var(--color-table-border)] px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor(r.status)}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="border-t border-[var(--color-table-border)] px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end">
                        <RowActionMenu
                          rowId={r.id}
                          openMenu={openMenu}
                          setOpenMenu={setOpenMenu}
                          items={[
                            {
                              label: "View / Print",
                              icon: <Eye className="h-4 w-4" />,
                              onClick: () => navigate(`/sales/quotations/${r.id}`),
                            },
                            {
                              label: "Edit",
                              icon: <Edit2 className="h-4 w-4" />,
                              onClick: () => navigate(`/sales/quotations/${r.id}/edit`),
                            },
                            
                            canConvertQuotationToSalesOrder(r)
                              ? {
                                  label: "Convert to Sales Order",
                                  icon: <CheckCircle className="h-4 w-4" />,
                                  onClick: () => setSelected(r),
                                }
                              : r.converted_to_so && r.converted_sales_order_number
                                ? {
                                    label: "Converted",
                                    disabled: true,
                                  }
                                : null,
                            (r.status || "").toLowerCase() === "draft"
                              ? {
                                  label: "Mark as Sent",
                                  icon: <Send className="h-4 w-4" />,
                                  onClick: () => handleStatusChange(r, "sent", "Sent"),
                                }
                              : null,
                            ["draft", "sent"].includes((r.status || "").toLowerCase())
                              ? {
                                  label: "Mark as Accepted",
                                  icon: <Check className="h-4 w-4" />,
                                  onClick: () => handleStatusChange(r, "accepted", "Accepted"),
                                }
                              : null,
                            (r.status || "").toLowerCase() === "cancelled"
                              ? {
                                  label: "Reopen as Draft",
                                  icon: <RotateCcw className="h-4 w-4" />,
                                  onClick: () => handleStatusChange(r, "draft", "Draft"),
                                }
                              : null,
                            { divider: true },
                            (r.status || "").toLowerCase() !== "cancelled"
                              ? {
                                  label: "Cancel",
                                  icon: <Ban className="h-4 w-4" />,
                                  danger: true,
                                  onClick: () => setCancelTarget(r),
                                }
                              : null,
                            {
                              label: "Delete",
                              icon: <Trash2 className="h-4 w-4" />,
                              danger: true,
                              onClick: () => setDeleteTarget(r),
                            },
                          ].filter(Boolean)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ui-pagination justify-between flex-wrap gap-2 border-t border-[var(--color-border-soft)] pt-3">
        <div className="flex items-center gap-2.5 flex-nowrap whitespace-nowrap text-xs sm:text-[13px] text-[var(--color-text-muted)]">
          <span>Rows:</span>
          <label htmlFor="quotation-page-size" className="sr-only">
            Items per page
          </label>
          <select
            id="quotation-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="ui-pagination-select"
          >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>
              {total === 0
                ? "0–0 of 0"
                : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="ui-page-btn"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="ui-page-btn ui-page-btn--active"
            >
              {page}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="ui-page-btn"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
      </div>

      {showFilters ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/35"
          role="presentation"
          onMouseDown={(e) => e.target === e.currentTarget && setShowFilters(false)}
        >
          <aside className="flex h-full w-full max-w-[400px] flex-col bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-table-border)] px-5 py-4">
              <h2 className="text-[18px] font-bold text-[var(--color-text)]">Filters</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowFilters(false)}
                aria-label="Close filters"
              >
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-5">
              <FilterSection label="Quotation Type">
                <Chip
                  label="Converted to Invoice"
                  active={draftFilters.quotationType === "converted"}
                  onClick={() =>
                    setDraftFilters((f) => ({
                      ...f,
                      quotationType: f.quotationType === "converted" ? "" : "converted",
                    }))
                  }
                />
                <Chip
                  label="Not Converted"
                  active={draftFilters.quotationType === "not_converted"}
                  onClick={() =>
                    setDraftFilters((f) => ({
                      ...f,
                      quotationType: f.quotationType === "not_converted" ? "" : "not_converted",
                    }))
                  }
                />
              </FilterSection>
              <FilterSection label="Total Amount">
                {AMOUNT_BANDS.map((b) => (
                  <Chip
                    key={b.id}
                    label={b.label}
                    active={draftFilters.amountBand === b.id}
                    onClick={() =>
                      setDraftFilters((f) => ({
                        ...f,
                        amountBand: f.amountBand === b.id ? "" : b.id,
                      }))
                    }
                  />
                ))}
              </FilterSection>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-[var(--color-table-border)] px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setDraftFilters(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                  setShowFilters(false);
                }}
              >
                Clear Filter
              </Button>
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => {
                  setFilters(draftFilters);
                  setShowFilters(false);
                }}
              >
                Apply Filter
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {selected ? (
        <QuoteDetailModal
          quote={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatus}
        />
      ) : null}

      <ConfirmationDialog
        open={Boolean(cancelTarget)}
        title="Cancel Quotation"
        message={`Are you sure you want to cancel Quotation ${cancelTarget?.quote_number || cancelTarget?.id || ""}?`}
        confirmLabel="Cancel Quotation"
        danger
        loading={cancelLoading}
        onConfirm={handleConfirmCancel}
        onCancel={() => {
          if (!cancelLoading) setCancelTarget(null);
        }}
      />

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete Quotation"
        message={`Are you sure you want to delete Quotation ${deleteTarget?.quote_number || deleteTarget?.id || ""}?`}
        confirmLabel="Delete"
        danger
        loading={deleteLoading}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
      />
    </ListPageShell>
  );
}
