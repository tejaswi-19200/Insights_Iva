import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import usePageRefresh from "../../hooks/usePageRefresh";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, ClipboardList, ExternalLink, Eye, Filter, IndianRupee, Plus, ShoppingCart, Trash2, Truck } from "lucide-react";
import KpiCard from "../../components/common/KpiCard";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import { ListPageCard, ListPageCardBody, ListPageShell } from "../../components/common/ListPageShell";

import DeleteSalesOrderDialog from "../../components/sales/DeleteSalesOrderDialog";
import DataTable from "../../components/common/DataTable";
import EmptyState from "../../components/common/EmptyState";
import PageHeader from "../../components/common/PageHeader";
import RowActionMenu from "../../components/common/RowActionMenu";
import SkeletonTable from "../../components/common/SkeletonTable";
import { ErrorState, NoResultsState, OfflineState } from "../../components/common/states";
import SODetailModal from "../../components/sales/SODetailModal";
import { useToast } from "../../context/ToastContext";
import { useNetworkStatus } from "../../context/NetworkStatusContext";
import {
  confirmSalesOrder,
  getSOSummary,
  getSalesOrdersEnriched,
  deleteSalesOrder,
} from "../../api/salesApi";
import { formatInr, statusColor } from "../../data/salesMasterData";
import { runListExport } from "../../utils/listExport";
import { apiErrorMessage, asArray } from "../../utils/apiError";
import {
  isSalesOrderDeletePreBlocked,
  SALES_ORDER_DELETE_SUCCESS_MESSAGE,
  salesOrderDeleteErrorMessage,
} from "../../utils/salesOrderDelete";
import useAuth from "../../hooks/useAuth";
import { userCanAction, userCanCreateSalesJobCard } from "../../config/permissions";
import { jobCardCreateUrl, jobCardDetailsUrl } from "../../utils/jobCardRoutes";
import {
  MANUFACTURING_EVENTS,
  notifyManufacturingSpine,
} from "../../utils/manufacturingEvents";


import Button from "../../components/common/Button";
import { SearchBar } from "../../components/common/SearchFilter";
import { applyDraftListFilters, clearListFilters } from "../../utils/listFilterState";

const defaultFilters = { customer: "", status: "", sales_person: "" };

export default function SalesOrders() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCreate = userCanCreateSalesJobCard(user);
  const canDelete = userCanAction(user, "sales", "delete");
  const { online, markRequestStart, markRequestEnd } = useNetworkStatus();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState([]);
  const [searchParams] = useSearchParams();
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmingOrderId, setConfirmingOrderId] = useState(null);
  const deleteInFlight = useRef(false);

  useEffect(() => {
    const status = searchParams.get("status");
    if (status) {
      const next = { ...defaultFilters, status };
      setDraftFilters(next);
      setAppliedFilters(next);
      setShowAdvanced(true);
    }
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    if (typeof markRequestStart === "function") markRequestStart();
    try {
      const res = await getSalesOrdersEnriched();
      setRows(Array.isArray(res?.data) ? res.data : asArray(res?.data));
    } catch (err) {
      setRows([]);
      setLoadError(apiErrorMessage(err, "Could not load sales orders."));
    } finally {
      if (typeof markRequestEnd === "function") markRequestEnd();
      setLoading(false);
    }
  }, [markRequestStart, markRequestEnd]);

  usePageRefresh(load);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const total_orders = rows.length;
    const pending = rows.filter((r) => String(r.status || "").toLowerCase() === "pending").length;
    const confirmed = rows.filter((r) => String(r.status || "").toLowerCase() === "confirmed").length;
    const packed = rows.filter((r) => String(r.status || "").toLowerCase() === "packed" || r.packed).length;
    const shipped = rows.filter((r) => String(r.status || "").toLowerCase() === "shipped" || r.shipped).length;
    const delivered = rows.filter((r) => String(r.status || "").toLowerCase() === "delivered").length;
    const cancelled = rows.filter((r) => String(r.status || "").toLowerCase() === "cancelled").length;
    const revenue = rows.reduce((acc, r) => acc + (Number(r.amount || r.total_amount) || 0), 0);

    return { total_orders, pending, confirmed, packed, shipped, delivered, cancelled, revenue };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (appliedFilters.customer) {
      list = list.filter((r) =>
        r.customer_name?.toLowerCase().includes(appliedFilters.customer.toLowerCase())
      );
    }
    if (appliedFilters.status) {
      list = list.filter((r) => String(r.status || "").toLowerCase() === appliedFilters.status.toLowerCase());
    }
    if (appliedFilters.sales_person) {
      list = list.filter((r) =>
        r.sales_person?.toLowerCase().includes(appliedFilters.sales_person.toLowerCase())
      );
    }
    return list;
  }, [rows, appliedFilters]);

  const hasAdvancedFilters = Boolean(
    appliedFilters.customer || appliedFilters.status || appliedFilters.sales_person
  );

  const handleConfirmSalesOrder = async (order) => {
    if (typeof order.id !== "number" || confirmingOrderId === order.id) return;
    setConfirmingOrderId(order.id);
    try {
      const res = await confirmSalesOrder(order.id);
      const result = res?.data ?? res;
      notifyManufacturingSpine(MANUFACTURING_EVENTS.MRP_RUN, result);
      notifyManufacturingSpine(MANUFACTURING_EVENTS.DASHBOARD_REFRESH, result);
      if (result?.warning) {
        addToast(result.warning, "warning");
      } else if (result?.already_confirmed) {
        addToast("Order already confirmed");
      } else {
        addToast(
          result?.repaired_workflow
            ? "Sales order linked to inventory check queue. Next: Store verifies materials."
            : "Sales order confirmed. Sent to Store for material check — open Job Card to track progress.",
          "success"
        );
      }
      await load();
    } catch (err) {
      addToast(apiErrorMessage(err, "Confirm failed"), "error");
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const salesOrderDetailsAction = (order) => {
    const status = String(order.status || "").toLowerCase();
    if (["draft", "pending"].includes(status)) {
      return {
        label: "Confirm Sales Order",
        icon: <CheckCircle className="h-4 w-4" />,
        onClick: () => handleConfirmSalesOrder(order),
      };
    }
    return {
      label: "Full Details",
      icon: <ExternalLink className="h-4 w-4" />,
      onClick: () => navigate(`/sales/orders/${order.id}`),
    };
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget?.id || typeof deleteTarget.id !== "number") return;
    if (deleteInFlight.current) return;

    if (
      isSalesOrderDeletePreBlocked({
        deleteBlockers: deleteTarget.delete_blockers,
        deleteError,
      })
    ) {
      return;
    }

    deleteInFlight.current = true;
    setDeleteError("");
    setDeleting(true);
    try {
      await deleteSalesOrder(deleteTarget.id);
      addToast(SALES_ORDER_DELETE_SUCCESS_MESSAGE, "success");
      setDeleteTarget(null);
      if (selected?.id === deleteTarget.id) setSelected(null);
      await load();
    } catch (err) {
      const structured = err?.response?.data?.detail;
      setDeleteError(structured || salesOrderDeleteErrorMessage(err, "Failed to delete sales order."));
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: "order_number",
      label: "Sales Order Number",
      render: (r) =>
        typeof r.id === "number" ? (
          <Link to={`/sales/orders/${r.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
            {r.order_number}
          </Link>
        ) : (
          <span className="font-medium text-[var(--color-text)]">{r.order_number}</span>
        ),    },
    { key: "customer_name", label: "Customer" },
    { key: "order_date", label: "Order Date", render: (r) => String(r.order_date || r.so_date || "").slice(0, 10) || "—" },
    { key: "due_date", label: "Due Date", render: (r) => String(r.due_date || "").slice(0, 10) || "—" },
    {
      key: "item_description",
      label: "Product",
      render: (r) => {
        const lines = r.line_items || [];
        if (!lines.length) return "—";
        const first = lines[0].item_description || "—";
        return lines.length > 1 ? `${first} +${lines.length - 1} more` : first;
      },
    },
    {
      key: "quantity",
      label: "Qty",
      numeric: true,
      render: (r) => {
        const lines = r.line_items || [];
        if (!lines.length) return "—";
        return lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
      },
    },
    {
      key: "unit",
      label: "Unit",
      render: (r) => r.line_items?.[0]?.unit || "—",
    },
    {
      key: "unit_price",
      label: "Unit Price",
      numeric: true,
      render: (r) => {
        const lines = r.line_items || [];
        if (!lines.length) return "—";
        return formatInr(lines[0].unit_price);
      },
    },
    { key: "total_amount", label: "Total Amount", numeric: true, render: (r) => formatInr(r.total_amount || r.amount) },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor(r.status)}`}>
          {r.status}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "center",
      sortable: false,
      render: (r) => (
        <RowActionMenu
          rowId={r.id ?? r.order_number}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          ariaLabel={`Actions for ${r.order_number || "sales order"}`}
          items={[
            {
              label: "View",
              icon: <Eye className="h-4 w-4" />,
              onClick: () => setSelected(r),
            },
            ...(typeof r.id === "number"
              ? [
                  salesOrderDetailsAction(r),
                  {
                    label: "Job Card",
                    icon: <ClipboardList className="h-4 w-4" />,
                    onClick: () => navigate(jobCardDetailsUrl(r.id), { state: { from: "/sales/orders" } }),
                  },
                ]
              : []),
            {
              label: "Dispatch",
              icon: <Truck className="h-4 w-4" />,
              onClick: () => navigate("/sales/dispatch"),
            },
            ...(typeof r.id === "number" && canDelete
              ? [
                  {
                    label: "Delete",
                    icon: <Trash2 className="h-4 w-4" />,
                    danger: true,
                    onClick: () => {
                      setDeleteError("");
                      setDeleteTarget(r);
                    },
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  const handleExport = (format) => {
    runListExport(format, {
      data: filtered,
      columns,
      filename: "sales-orders",
      title: "Sales Orders",
    });
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  return (
    <ListPageShell>
      <PageHeader
        subtitle="Manage orders from quotation to dispatch with production and inventory integration."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportDownloadMenu
              disabled={!filtered.length}
              onExport={handleExport}
            />
            {canCreate ? (
              <Button variant="primary" to={jobCardCreateUrl()}>
                <Plus className="mr-1.5 inline h-4 w-4" /> New Job Card
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="ui-grid-kpi">
        <KpiCard
          label="Total Orders"
          value={summary.total_orders ?? 0}
          icon={ShoppingCart}
          tone="teal"
          onClick={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
          title="Show all orders"
        />
        <KpiCard
          label="Pending"
          value={summary.pending ?? 0}
          icon={ShoppingCart}
          tone="warning"
          onClick={() => {
            const next = { ...defaultFilters, status: "pending" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter pending orders"
        />
        <KpiCard
          label="Confirmed"
          value={summary.confirmed ?? 0}
          icon={ShoppingCart}
          tone="teal"
          onClick={() => {
            const next = { ...defaultFilters, status: "confirmed" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter confirmed orders"
        />
        <KpiCard
          label="Packed"
          value={summary.packed ?? 0}
          icon={ShoppingCart}
          tone="neutral"
          onClick={() => {
            const next = { ...defaultFilters, status: "packed" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter packed orders"
        />
        <KpiCard
          label="Shipped"
          value={summary.shipped ?? 0}
          icon={Truck}
          tone="info"
          onClick={() => {
            const next = { ...defaultFilters, status: "shipped" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter shipped orders"
        />
        <KpiCard
          label="Delivered"
          value={summary.delivered ?? 0}
          icon={Truck}
          tone="teal"
          onClick={() => {
            const next = { ...defaultFilters, status: "delivered" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter delivered orders"
        />
        <KpiCard
          label="Cancelled"
          value={summary.cancelled ?? 0}
          icon={ShoppingCart}
          tone="danger"
          onClick={() => {
            const next = { ...defaultFilters, status: "cancelled" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="Filter cancelled orders"
        />
        <KpiCard
          label="Revenue"
          value={formatInr(summary.revenue ?? 0)}
          icon={IndianRupee}
          tone="teal"
          onClick={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
          title="Total orders revenue"
        />
      </div>

      <ListPageCard>
        <ListPageCardBody>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <SearchBar
              value={draftFilters.customer}
              onChange={(v) => setDraftFilters((f) => ({ ...f, customer: v }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyDraftListFilters(draftFilters, setAppliedFilters);
                }
              }}
              placeholder="Search sales orders..."
              aria-label="Search sales orders"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
            >
              Clear Filters
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => applyDraftListFilters(draftFilters, setAppliedFilters)}
            >
              Apply Filters
            </Button>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-2 text-[var(--text-sm)] font-semibold text-[var(--color-text-secondary)]"
            >
              <Filter className="h-4 w-4" /> Filters
            </button>
          </div>
          null
        </div>
        {showAdvanced && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
              className="ui-select"
            >
              <option value="">All Status</option>
              {["draft", "pending", "confirmed", "packed", "shipped", "delivered", "cancelled"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                )
              )}
            </select>
            <input
              value={draftFilters.sales_person}
              onChange={(e) => setDraftFilters({ ...draftFilters, sales_person: e.target.value })}
              placeholder="Sales Person"
              className="ui-input"
            />
            <div className="col-span-full flex flex-wrap justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
              >
                Clear Filters
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => applyDraftListFilters(draftFilters, setAppliedFilters)}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <SkeletonTable rows={8} cols={6} />
        ) : !online && loadError ? (
          <OfflineState onRetry={load} />
        ) : loadError ? (
          <ErrorState description={loadError} onRetry={load} />
        ) : (
          <>
            {/* Mobile Cards View */}
            <div className="space-y-3 md:hidden">
              {filtered.length === 0 ? (
                rows.length === 0 ? (
                  <EmptyState
                    icon="document"
                    title="No Sales Orders yet"
                    description={
                      canCreate
                        ? "Create a Job Card or convert a quotation to start the sales workflow."
                        : "Sales orders appear here when they are created in the workflow."
                    }
                    actionLabel={canCreate ? "Create Job Card" : undefined}
                    onAction={canCreate ? () => navigate(jobCardCreateUrl()) : undefined}
                    className="border-none bg-transparent py-12"
                  />
                ) : (
                  <NoResultsState
                    title="No sales orders match your filters"
                    description="Try clearing filters or adjusting your search."
                    onClear={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
                    className="border-none bg-transparent py-12"
                  />
                )
              ) : (
                filtered.map((r) => (
                  <div
                    key={r.id || r.order_number}
                    className="ui-card p-3.5 space-y-2.5 transition hover:border-[var(--color-primary-soft)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-[var(--color-primary)]">
                            {r.order_number || `SO-${r.id}`}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusColor(
                              r.status
                            )}`}
                          >
                            {r.status || "draft"}
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
                          ariaLabel={`Actions for ${r.order_number || "sales order"}`}
                          items={[
                            {
                              label: "View",
                              icon: <Eye className="h-4 w-4" />,
                              onClick: () => setSelected(r),
                            },
                            ...(typeof r.id === "number"
                              ? [
                                  salesOrderDetailsAction(r),
                                  {
                                    label: "Job Card",
                                    icon: <ClipboardList className="h-4 w-4" />,
                                    onClick: () =>
                                      navigate(jobCardDetailsUrl(r.id), { state: { from: "/sales/orders" } }),
                                  },
                                ]
                              : []),
                            {
                              label: "Dispatch",
                              icon: <Truck className="h-4 w-4" />,
                              onClick: () => navigate("/sales/dispatch"),
                            },
                            ...(typeof r.id === "number" && canDelete
                              ? [
                                  {
                                    label: "Delete",
                                    icon: <Trash2 className="h-4 w-4" />,
                                    danger: true,
                                    onClick: () => {
                                      setDeleteError("");
                                      setDeleteTarget(r);
                                    },
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs border-t border-[var(--color-border-soft)] pt-2 text-[var(--color-text-secondary)]">
                      <div>
                        <span className="text-[var(--color-text-muted)] text-[11px] block font-medium">
                          Date
                        </span>
                        <span className="font-medium">
                          {r.order_date ? String(r.order_date).slice(0, 10) : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)] text-[11px] block font-medium">
                          Sales Person
                        </span>
                        <span className="font-medium truncate block">{r.sales_person || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[var(--color-text-muted)] text-[11px] block font-medium">
                          Items
                        </span>
                        <span className="font-medium">
                          {Array.isArray(r.items) ? `${r.items.length} items` : "—"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[var(--color-text-muted)] text-[11px] block font-medium">
                          Total Amount
                        </span>
                        <span className="text-sm font-bold text-[var(--color-text)] tabular-nums">
                          {formatInr(r.amount || r.total_amount || 0)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-soft)] pt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelected(r)}
                        leftIcon={<Eye className="h-3.5 w-3.5" />}
                      >
                        View
                      </Button>
                      {typeof r.id === "number" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(jobCardDetailsUrl(r.id), { state: { from: "/sales/orders" } })
                          }
                          leftIcon={<ClipboardList className="h-3.5 w-3.5" />}
                        >
                          Job Card
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block">
              <DataTable
                columns={columns}
                data={filtered}
                showSearch={false}
                emptyState={
                  rows.length === 0 ? (
                    <EmptyState
                      icon="document"
                      title="No Sales Orders yet"
                      description={
                        canCreate
                          ? "Create a Job Card or convert a quotation to start the sales workflow."
                          : "Sales orders appear here when they are created in the workflow."
                      }
                      actionLabel={canCreate ? "Create Job Card" : undefined}
                      onAction={canCreate ? () => navigate(jobCardCreateUrl()) : undefined}
                      className="border-none bg-transparent py-12"
                    />
                  ) : (
                    <NoResultsState
                      title="No sales orders match your filters"
                      description="Try clearing filters or adjusting your search."
                      onClear={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
                      className="border-none bg-transparent py-12"
                    />
                  )
                }
              />
            </div>
          </>
        )}
        </ListPageCardBody>
      </ListPageCard>

      {selected && (
        <SODetailModal
          order={selected}
          onClose={() => setSelected(null)}
        />
      )}

      <DeleteSalesOrderDialog
        open={Boolean(deleteTarget)}
        orderNumber={deleteTarget?.order_number}
        deleteBlockers={deleteTarget?.delete_blockers}
        deleteError={deleteError}
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError("");
          }
        }}
      />
    </ListPageShell>
  );
}
