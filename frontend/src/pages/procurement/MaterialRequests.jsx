import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRightCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  Filter,
  Plus,
  ShoppingCart,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import KpiCard from "../../components/common/KpiCard";
import PageHeader from "../../components/common/PageHeader";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import { ListPageCard, ListPageCardBody, ListPageShell } from "../../components/common/ListPageShell";

import DataTable from "../../components/common/DataTable";
import Loader from "../../components/common/Loader";
import Button from "../../components/common/Button";
import RowActionMenu from "../../components/common/RowActionMenu";
import { useToast } from "../../context/ToastContext";
import {
  approveMaterialRequest,
  convertMaterialRequestToPO,
  deleteMaterialRequest,
  getMaterialRequest,
  getMREnriched,
  getMRSummary,
  getVendors,
} from "../../api/procurementApi";
import {
  MR_DEPARTMENTS,
  MR_PRIORITIES,
  priorityColor,
  statusColor,
} from "../../data/procurementMasterData";
import { runListExport } from "../../utils/listExport";
import useManufacturingRefresh from "../../hooks/useManufacturingRefresh";
import {
  MANUFACTURING_EVENTS,
  notifyManufacturingSpine,
} from "../../utils/manufacturingEvents";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import {
  applyMaterialRequestFieldFilters,
  filterMaterialRequestsByKpi,
} from "../../utils/materialRequestKpi";


function ConvertToPOModal({ row, onClose, onConverted }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [detail, setDetail] = useState(null);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [unitPrice, setUnitPrice] = useState("0");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [vRes, dRes] = await Promise.all([
          getVendors(),
          getMaterialRequest(row.id),
        ]);
        if (cancelled) return;
        setVendors(vRes.data || []);
        setDetail(dRes.data);
        if (dRes.data?.required_date) {
          setExpectedDate(String(dRes.data.required_date).slice(0, 10));
        }
        const linePrices = (dRes.data?.line_items || [])
          .map((line) => Number(line.unit_price))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (linePrices.length) {
          setUnitPrice(String(linePrices[0]));
        }
      } catch (err) {
        addToast(err.response?.data?.detail || "Failed to load material request", "error");
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id, addToast, onClose]);

  const handleConvert = async () => {
    if (!supplierId) {
      addToast("Select a supplier", "error");
      return;
    }
    if (!(detail?.line_items || []).length) {
      addToast("Material request has no line items", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await convertMaterialRequestToPO(row.id, {
        supplier_id: Number(supplierId),
        expected_date: expectedDate || null,
        unit_price: Number(unitPrice) || 0,
        status: "draft",
      });
      const po = res.data;
      notifyManufacturingSpine(MANUFACTURING_EVENTS.MATERIAL_REQUEST_CONVERTED, {
        mr_id: row.id,
        po_id: po?.id,
      });
      notifyManufacturingSpine(MANUFACTURING_EVENTS.PURCHASE_ORDER_CREATED, {
        po_id: po?.id,
      });
      addToast(`Converted to ${po?.po_number || "purchase order"}`);
      onConverted?.(po);
      onClose();
      if (po?.id) navigate("/procurement/purchase-orders");
    } catch (err) {
      addToast(err.response?.data?.detail || "Convert failed", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ui-modal-backdrop">
      <div className="ui-modal w-full max-w-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ArrowRightCircle className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-primary)]" aria-hidden />
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text)]">Convert to Purchase Order</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {row.mr_number} · {detail?.line_items?.length ?? row.item_count ?? 0} line(s)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label className="ui-label">Supplier *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="ui-select w-full"
              >
                <option value="">Select supplier</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.vendor_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label">Expected date</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="ui-input w-full"
              />
            </div>
            <div>
              <label className="ui-label">Default unit price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="ui-input w-full"
              />
            </div>
            {(detail?.line_items || []).length > 0 && (
              <ul className="max-h-32 overflow-auto rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                {detail.line_items.map((l) => (
                  <li key={l.id}>
                    {l.item_name || l.notes?.match(/^Shortage for (.+?) \([^)]*\)$/)?.[1] || `Inventory item #${l.item_id}`}
                    {l.item_sku ? ` · ${l.item_sku}` : ""} · qty {l.quantity}{l.item_unit ? ` ${l.item_unit}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={saving || loading}
            onClick={handleConvert}
          >
            {saving ? "Converting…" : "Create PO"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MRDetailModal({ row, onClose, onConvert, onApproved }) {
  const { addToast } = useToast();
  const [approving, setApproving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (!row || typeof row.id !== "number") return undefined;
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    getMaterialRequest(row.id)
      .then((response) => {
        if (!cancelled) setDetail(response.data || null);
      })
      .catch((error) => {
        if (!cancelled) setDetailError(error.response?.data?.detail || "Could not load requisition materials.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [row?.id]);

  if (!row) return null;
  const approval = (row.approval_status || "").toLowerCase();
  const canApprove =
    typeof row.id === "number" &&
    !["approved", "rejected"].includes(approval) &&
    !["converted", "fulfilled", "cancelled"].includes(row.status);
  const canConvert =
    typeof row.id === "number" &&
    approval === "approved" &&
    !["converted", "fulfilled", "cancelled", "rejected"].includes(row.status);

  const handleApprove = async (approved) => {
    setApproving(true);
    try {
      const response = await approveMaterialRequest(row.id, { approved });
      addToast(approved ? "Purchase requisition approved" : "Purchase requisition rejected");
      onApproved?.(response.data);
      onClose();
    } catch (err) {
      addToast(err.response?.data?.detail || "Approval failed", "error");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="ui-modal-backdrop">
      <div className="ui-modal max-h-[85vh] w-full max-w-2xl overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">{row.mr_number}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {row.department} · {row.requested_by}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Priority</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${priorityColor(row.priority)}`}>
              {row.priority}
            </span>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Items</p>
            <p className="font-medium text-[var(--color-text)]">{row.item_count}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Required Date</p>
            <p className="font-medium text-[var(--color-text)]">{row.required_date || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Approval</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor(row.approval_status)}`}>
              {row.approval_status}
            </span>
          </div>
        </div>
        <section className="mt-5" aria-label="Requested materials">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
            Requested materials ({detail?.line_items?.length ?? row.item_count ?? 0})
          </h3>
          {detailLoading ? (
            <p className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-text-muted)]">Loading material lines…</p>
          ) : detailError ? (
            <p className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-3 text-sm text-[var(--color-danger)]">{detailError}</p>
          ) : (detail?.line_items || []).length ? (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border-soft)]">
              <table className="w-full min-w-[600px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[32%]" />
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                  <col className="w-[28%]" />
                </colgroup>
                <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Qty to purchase</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.line_items.map((line) => {
                    const materialFromNote = line.notes?.match(/^Shortage for (.+?) \([^)]*\)$/)?.[1];
                    return (
                      <tr key={line.id} className="border-t border-[var(--color-border-soft)]">
                        <td className="break-words px-3 py-2 align-top font-medium text-[var(--color-text)]">
                          {line.item_name || materialFromNote || `Inventory item #${line.item_id}`}
                        </td>
                        <td className="break-words px-3 py-2 align-top text-[var(--color-text-secondary)]">{line.item_sku || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-top font-semibold tabular-nums text-[var(--color-text)]">
                          {Number(line.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}{line.item_unit ? ` ${line.item_unit}` : ""}
                        </td>
                        <td className="break-words px-3 py-2 align-top text-xs text-[var(--color-text-muted)]">{line.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-text-muted)]">This requisition has no material lines.</p>
          )}
        </section>
        {canApprove ? (
          <p className="mt-3 text-xs text-[var(--kpi-warning)]">
            Purchase Manager must approve this requisition before creating a Purchase Order.
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="cancel" onClick={onClose}>
            Close
          </Button>
          {canApprove && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={approving}
                onClick={() => handleApprove(false)}
                className="!border-[var(--color-danger-soft)] !text-[var(--color-danger)]"
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={approving}
                onClick={() => handleApprove(true)}
              >
                {approving ? "Saving…" : "Approve PR"}
              </Button>
            </>
          )}
          {canConvert && (
            <Button type="button" variant="primary" onClick={() => onConvert(row)}>
              Convert to PO
            </Button>
          )}
          <Button variant="secondary" to="/procurement/purchase-orders">
            Purchase Orders
          </Button>
        </div>
      </div>
    </div>
  );
}

const defaultFilters = { kpi: "", department: "", priority: "", status: "", requested_by: "" };
const emptySummary = {
  total_requests: 0,
  pending_approval: 0,
  approved: 0,
  rejected: 0,
  converted_to_rfq: 0,
  urgent_requests: 0,
};

export default function MaterialRequests() {
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const tableRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(emptySummary);
  const [rows, setRows] = useState([]);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState(null);
  const [convertRow, setConvertRow] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const scrollToTable = useCallback(() => {
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const applyPreset = useCallback(
    (preset) => {
      setShowAdvanced(true);
      let next = { ...defaultFilters };
      if (preset === "pending") next = { ...defaultFilters, kpi: "pending_approval" };
      else if (preset === "approved") next = { ...defaultFilters, kpi: "approved" };
      else if (preset === "rejected") next = { ...defaultFilters, kpi: "rejected" };
      else if (preset === "converted") next = { ...defaultFilters, kpi: "converted" };
      else if (preset === "urgent") next = { ...defaultFilters, kpi: "urgent" };
      setDraftFilters(next);
      setAppliedFilters(next);
      scrollToTable();
    },
    [scrollToTable]
  );

  useEffect(() => {
    const kpi = searchParams.get("kpi") || searchParams.get("status");
    if (!kpi) return;
    const mapped =
      kpi === "pending" || kpi === "pending_approval"
        ? "pending_approval"
        : kpi;
    const next = { ...defaultFilters, kpi: mapped };
    setDraftFilters(next);
    setAppliedFilters(next);
    setShowAdvanced(true);
  }, [searchParams]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.allSettled([getMRSummary(), getMREnriched()]);
      if (sumRes.status === "fulfilled" && sumRes.value?.data) {
        setSummary({ ...emptySummary, ...sumRes.value.data });
      } else {
        setSummary(emptySummary);
      }
      setRows(listRes.status === "fulfilled" ? listRes.value?.data || [] : []);
    } catch {
      setRows([]);
      addToast("Failed to load purchase requisitions", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  useManufacturingRefresh(load);

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleteBusy(true);
    try {
      await deleteMaterialRequest(deleteTarget.id);
      addToast("Material request deleted", "success");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to delete", "error");
    } finally {
      setDeleteBusy(false);
    }
  };

  const filtered = useMemo(
    () => applyMaterialRequestFieldFilters(rows, appliedFilters),
    [rows, appliedFilters]
  );

  const columns = [
    { key: "mr_number", label: "MR No" },
    {
      key: "request_date",
      label: "Date",
      render: (r) => String(r.request_date || "").slice(0, 10),
    },
    { key: "department", label: "Department" },
    { key: "requested_by", label: "Requested By" },
    {
      key: "priority",
      label: "Priority",
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${priorityColor(r.priority)}`}>
          {r.priority}
        </span>
      ),
    },
    { key: "item_count", label: "Items" },
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
      key: "approval_status",
      label: "Approval",
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor(r.approval_status)}`}>
          {r.approval_status}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "center",
      sortable: false,
      render: (r) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <RowActionMenu
            rowId={r.id}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            items={[
              {
                label: "View Request",
                icon: <Eye className="h-4 w-4" />,
                onClick: () => setSelected(r),
              },
              typeof r.id === "number" && !["converted", "fulfilled", "cancelled"].includes(r.status)
                ? {
                    label: "Convert to PO",
                    icon: <ArrowRightCircle className="h-4 w-4" />,
                    onClick: () => setConvertRow(r),
                  }
                : null,
              typeof r.id === "number" ? { divider: true } : null,
              typeof r.id === "number"
                ? {
                    label: "Delete",
                    icon: <Trash2 className="h-4 w-4" />,
                    danger: true,
                    onClick: () => setDeleteTarget(r),
                  }
                : null,
            ].filter(Boolean)}
          />
        </div>
      ),
    },
  ];

  if (loading) return <Loader label="Loading material requests..." />;

  const handleExport = (format) => {
    runListExport(format, {
      data: filtered,
      columns,
      filename: "material-requests",
      title: "Material Requests",
    });
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  return (
    <ListPageShell>
      <PageHeader
        subtitle="MRP shortages become purchase requests, then purchase orders."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportDownloadMenu disabled={!filtered.length} onExport={handleExport} />
            <Button variant="add" to="/procurement/material-requests/create" leftIcon={<Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />}>
              New Material Request
            </Button>
          </div>
        }
      />

      <div className="ui-grid-kpi">
        <KpiCard
          label="Total Requests"
          value={summary.total_requests}
          icon={ClipboardList}
          tone="primary"
          onClick={() => applyPreset("all")}
        />
        <KpiCard
          label="Pending Approval"
          value={summary.pending_approval}
          icon={Clock}
          tone="warning"
          onClick={() => applyPreset("pending")}
        />
        <KpiCard
          label="Approved"
          value={summary.approved}
          icon={CheckCircle2}
          tone="success"
          onClick={() => applyPreset("approved")}
        />
        <KpiCard
          label="Rejected"
          value={summary.rejected}
          icon={XCircle}
          tone="danger"
          onClick={() => applyPreset("rejected")}
        />
        <KpiCard
          label="Converted to PO"
          value={summary.converted_to_rfq}
          icon={ShoppingCart}
          tone="violet"
          onClick={() => applyPreset("converted")}
        />
        <KpiCard
          label="Urgent Requests"
          value={summary.urgent_requests}
          icon={Zap}
          tone="yellow"
          onClick={() => applyPreset("urgent")}
        />
      </div>

      <ListPageCard>
        <ListPageCardBody ref={tableRef}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-secondary)]"
        >
          <Filter className="h-4 w-4" /> Advanced Filters
        </button>
        {showAdvanced && (
          <div className="mb-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <select
                value={draftFilters.department}
                onChange={(e) => setDraftFilters({ ...draftFilters, department: e.target.value })}
                className="ui-select w-full"
              >
                <option value="">All Departments</option>
                {MR_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.priority}
                onChange={(e) => setDraftFilters({ ...draftFilters, priority: e.target.value })}
                className="ui-select w-full"
              >
                <option value="">All Priorities</option>
                {MR_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.status}
                onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
                className="ui-select w-full"
              >
                <option value="">All Status</option>
                {["pending", "approved", "rejected", "converted"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                value={draftFilters.requested_by}
                onChange={(e) => setDraftFilters({ ...draftFilters, requested_by: e.target.value })}
                placeholder="Requested by"
                className="ui-input w-full"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setAppliedFilters({ ...draftFilters });
                  scrollToTable();
                }}
              >
                Apply Filters
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraftFilters(defaultFilters);
                  setAppliedFilters(defaultFilters);
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        )}
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder="Search"
          searchKeys={["mr_number", "department", "requested_by"]}
          searchInputClassName="pending-inventory-search-input"
          showResultsCount={false}
        />
        </ListPageCardBody>
      </ListPageCard>

      {selected && (
        <MRDetailModal
          row={selected}
          onClose={() => setSelected(null)}
          onApproved={(updatedRequest) => {
            if (updatedRequest) {
              setRows((current) =>
                current.map((request) =>
                  request.id === updatedRequest.id
                    ? {
                        ...request,
                        status: updatedRequest.status,
                        approval_status: updatedRequest.approval_status,
                      }
                    : request
                )
              );
            }
            void load(true);
          }}
          onConvert={(r) => {
            setSelected(null);
            setConvertRow(r);
          }}
        />
      )}

      {convertRow && (
        <ConvertToPOModal
          row={convertRow}
          onClose={() => setConvertRow(null)}
          onConverted={() => load()}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete material request?"
        message={
          deleteTarget
            ? `Delete ${deleteTarget.mr_number || "this request"}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        loading={deleteBusy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </ListPageShell>
  );
}
