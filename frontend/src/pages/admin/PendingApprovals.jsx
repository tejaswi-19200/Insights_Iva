import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CheckCircle2, Eye, RefreshCw, Search, XCircle } from "lucide-react";

import PageHeader from "../../components/common/PageHeader";
import AccessDenied from "../../components/admin/AccessDenied";
import ConfirmDialog from "../../components/admin/ConfirmDialog";
import Pagination from "../../components/common/Pagination";
import RowActionMenu from "../../components/common/RowActionMenu";
import usePermissions from "../../hooks/usePermissions";
import { userCanAccessApprovalQueue } from "../../config/permissions";
import usePageRefresh from "../../hooks/usePageRefresh";
import { useToast } from "../../context/ToastContext";
import {
  approveLeaveRequest,
  decideInventoryAdjustment,
  decideMaterialRequest,
  decideProductionOrder,
  decidePurchaseOrder,
  decideVendor,
  getApprovalQueue,
  getLeaveApprovalHistory,
  rejectLeaveRequest,
} from "../../api/approvalsApi";

const CATEGORY_TABS = [
  { id: "all", label: "All" },
  { id: "leave", label: "Leaves" },
  { id: "procurement", label: "Procurement" },
  { id: "production", label: "Production" },
  { id: "inventory", label: "Inventory" },
];

const CATEGORY_LABELS = {
  leave: "Leave Request",
  material_request: "Material Request",
  purchase_order: "Purchase Order",
  vendor: "Vendor Registration",
  production: "Production Order",
  inventory: "Inventory Adjustment",
};

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateRange(extra) {
  if (!extra?.start_date || !extra?.end_date) return null;
  return `${formatDate(extra.start_date)} – ${formatDate(extra.end_date)}`;
}

function apiErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return fallback;
}

export default function PendingApprovals() {
  const navigate = useNavigate();
  const { user } = usePermissions();
  const allowed = userCanAccessApprovalQueue(user);
  const { addToast } = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);

  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    search: "",
    status: "pending",
    fromDate: "",
    toDate: "",
  });

  const [selectedDetail, setSelectedDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getApprovalQueue({
        page,
        page_size: pageSize,
        category: activeTab === "all" ? undefined : activeTab,
        status: appliedFilters.status || "pending",
        search: appliedFilters.search || undefined,
        from_date: appliedFilters.fromDate || undefined,
        to_date: appliedFilters.toDate || undefined,
      });
      const data = res?.data || {};
      setItems(data.items || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.total_pages ?? 0);
      setPendingTotal(data.pending_total ?? data.total ?? 0);
    } catch {
      setError("load");
      setItems([]);
      setTotal(0);
      setPendingTotal(0);
    } finally {
      setLoading(false);
    }
  }, [allowed, page, pageSize, activeTab, appliedFilters]);

  usePageRefresh(() => load());

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  useEffect(() => {
    if (!selectedDetail || selectedDetail.category !== "leave") {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    getLeaveApprovalHistory(selectedDetail.resource_id)
      .then((res) => setHistory(res?.data || []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [selectedDetail]);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters({
      search: searchInput.trim(),
      status: statusFilter,
      fromDate,
      toDate,
    });
  };

  const resetFilters = () => {
    setSearchInput("");
    setStatusFilter("pending");
    setFromDate("");
    setToDate("");
    setPage(1);
    setAppliedFilters({ search: "", status: "pending", fromDate: "", toDate: "" });
  };

  const refreshAfterAction = () => {
    load();
  };

  const runDecision = async (item, approved, rejectionReason) => {
    const type = item.resource_type;
    const id = item.resource_id;
    const body = {
      approved,
      expected_status: item.status,
      rejection_reason: rejectionReason || undefined,
      notes: rejectionReason || undefined,
    };
    if (type === "leave_request") {
      if (approved) {
        await approveLeaveRequest(id, { expected_status: item.status });
      } else {
        await rejectLeaveRequest(id, {
          expected_status: item.status,
          rejection_reason: rejectionReason,
        });
      }
      return;
    }
    if (type === "material_request") {
      await decideMaterialRequest(id, body);
      return;
    }
    if (type === "vendor") {
      await decideVendor(id, body);
      return;
    }
    if (type === "purchase_order") {
      await decidePurchaseOrder(id, { ...body, expected_status: item.status || "draft" });
      return;
    }
    if (type === "production_order") {
      await decideProductionOrder(id, { ...body, expected_status: item.status || "planned" });
      return;
    }
    if (type === "stock_adjustment") {
      await decideInventoryAdjustment(id, body);
    }
  };

  const handleConfirmApprove = async () => {
    if (!approveTarget) return;
    const approvedMaterialRequest = approveTarget.resource_type === "material_request";
    setActionLoading(true);
    try {
      await runDecision(approveTarget, true);
      if (approveTarget.category === "leave") {
        addToast("✓ Leave request approved successfully.", "success");
      } else {
        addToast(`✓ ${approveTarget.request_code} approved successfully.`, "success");
      }
      setApproveTarget(null);
      setSelectedDetail(null);
      refreshAfterAction();
      if (approvedMaterialRequest) {
        navigate("/procurement/material-requests?kpi=approved");
      }
    } catch (err) {
      addToast(
        apiErrorMessage(
          err,
          "We couldn't process this approval right now. Please try again."
        ),
        "error"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (rejectTarget.category === "leave" && !reason) {
      addToast("Rejection reason is required.", "error");
      return;
    }
    setActionLoading(true);
    try {
      await runDecision(rejectTarget, false, reason);
      if (rejectTarget.category === "leave") {
        addToast("✓ Leave request rejected successfully.", "success");
      } else {
        addToast(`✓ ${rejectTarget.request_code} rejected successfully.`, "success");
      }
      setRejectTarget(null);
      setRejectReason("");
      setSelectedDetail(null);
      refreshAfterAction();
    } catch (err) {
      addToast(
        apiErrorMessage(
          err,
          "We couldn't process this approval right now. Please try again."
        ),
        "error"
      );
    } finally {
      setActionLoading(false);
    }
  };

  const subtitle = useMemo(() => {
    if (loading) return "Review requests that require your approval.";
    if (pendingTotal > 0) {
      return `You have ${pendingTotal} request${pendingTotal === 1 ? "" : "s"} waiting for your approval.`;
    }
    return "Review requests that require your approval.";
  }, [loading, pendingTotal]);

  if (!allowed) return <AccessDenied />;

  return (
    <div className="space-y-4 pb-6">
      <PageHeader
        eyebrow="Administration"
        title="Approvals"
        subtitle={subtitle}
      />

      <div className="flex flex-wrap gap-2">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab.id
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ui-card p-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg border border-[var(--color-border)] bg-white pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-text-muted)]">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              const val = e.target.value;
              setStatusFilter(val);
              setPage(1);
              setAppliedFilters((prev) => ({
                ...prev,
                status: val,
                search: searchInput.trim(),
                fromDate,
                toDate,
              }));
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm cursor-pointer"
          >
            <option value="pending">Pending</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-text-muted)]">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-text-muted)]">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" className="ui-btn ui-btn-primary text-xs" onClick={applyFilters}>
            Apply Filters
          </button>
          <button type="button" className="ui-btn ui-btn-secondary text-xs" onClick={resetFilters}>
            Reset
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-ghost p-2"
            title="Refresh"
            onClick={() => load()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ui-card p-8 text-center text-sm text-[var(--color-text-muted)]">
          Loading approvals…
        </div>
      ) : error ? (
        <div className="ui-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-base font-semibold text-[var(--color-text)]">Unable to load approvals</p>
          <p className="text-sm text-[var(--color-text-muted)] max-w-md">
            We couldn&apos;t retrieve the approval queue right now.
          </p>
          <button type="button" className="ui-btn ui-btn-primary text-sm" onClick={() => load()}>
            Try Again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="ui-card flex flex-col items-center justify-center p-12 text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-[var(--color-text)]">All Approvals Clear</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
            There are currently no pending requests that require your approval.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden md:block ui-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Request</th>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Details</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-[var(--color-primary)]">
                      {item.request_code}
                    </td>
                    <td className="px-4 py-3">{item.employee_name || "—"}</td>
                    <td className="px-4 py-3">{CATEGORY_LABELS[item.category] || item.title}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {item.category === "leave"
                        ? formatDateRange(item.extra) || item.detail_summary
                        : item.detail_summary}
                    </td>
                    <td className="px-4 py-3">{formatDate(item.submitted_at)}</td>
                    <td className="px-4 py-3 capitalize">{item.status}</td>
                    <td className="px-4 py-3 text-right">
                      <RowActions
                        item={item}
                        onView={() => setSelectedDetail(item)}
                        onApprove={() => setApproveTarget(item)}
                        onReject={() => {
                          setRejectTarget(item);
                          setRejectReason("");
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {items.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                onView={() => setSelectedDetail(item)}
                onApprove={() => setApproveTarget(item)}
                onReject={() => {
                  setRejectTarget(item);
                  setRejectReason("");
                }}
              />
            ))}
          </div>

          <div className="ui-card px-4 py-3">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              summaryMode="entries"
            />
          </div>
        </>
      )}

      {selectedDetail && (
        <DetailModal
          item={selectedDetail}
          history={history}
          historyLoading={historyLoading}
          onClose={() => setSelectedDetail(null)}
          onApprove={() => setApproveTarget(selectedDetail)}
          onReject={() => {
            setRejectTarget(selectedDetail);
            setRejectReason("");
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(approveTarget)}
        title="Approve request?"
        message={
          approveTarget?.category === "leave"
            ? approveLeaveMessage(approveTarget)
            : `Approve ${approveTarget?.request_code}?`
        }
        confirmLabel={approveTarget?.category === "leave" ? "Approve Leave" : "Approve"}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleConfirmApprove}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title={
          rejectTarget?.category === "leave" ? "Reject Leave Request" : "Reject request"
        }
        confirmLabel={rejectTarget?.category === "leave" ? "Reject Leave" : "Reject"}
        destructive
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
        onConfirm={handleConfirmReject}
        loading={actionLoading}
        confirmDisabled={
          rejectTarget?.category === "leave" ? !rejectReason.trim() : false
        }
      >
        {rejectTarget ? (
          <RejectForm item={rejectTarget} reason={rejectReason} setReason={setRejectReason} />
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function RowActions({ item, onView, onApprove, onReject }) {
  const isDraftPo = item.resource_type === "purchase_order" && item.status === "draft";
  const canAct = item.status === "pending" || isDraftPo;
  const items = [
    {
      label: "View",
      icon: <Eye className="h-4 w-4" aria-hidden />,
      onClick: onView,
    },
    ...(canAct
      ? [
          {
            label: "Approve",
            icon: <Check className="h-4 w-4" aria-hidden />,
            onClick: onApprove,
          },
          {
            label: "Reject",
            icon: <XCircle className="h-4 w-4" aria-hidden />,
            danger: true,
            onClick: onReject,
          },
        ]
      : []),
  ];

  return (
    <div className="flex justify-end">
      <RowActionMenu
        rowId={`${item.category}-${item.id}`}
        items={items}
        ariaLabel={`Actions for ${item.request_code || item.title || "approval request"}`}
      />
    </div>
  );
}

function ApprovalCard({ item, onView, onApprove, onReject }) {
  const isLeave = item.category === "leave";
  return (
    <div className="ui-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">
            {isLeave ? "Leave Request" : CATEGORY_LABELS[item.category]}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {item.employee_name}
            {item.department ? ` • ${item.department}` : ""}
          </p>
        </div>
        <span className="text-xs font-semibold capitalize">{item.status}</span>
      </div>
      <p className="text-xs text-[var(--color-text)]">
        {isLeave ? (
          <>
            {item.title} • {formatDateRange(item.extra)} • {item.detail_summary}
          </>
        ) : (
          <>
            {item.title} • {item.detail_summary}
          </>
        )}
      </p>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Submitted: {formatDate(item.submitted_at)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn ui-btn-secondary text-xs" onClick={onView}>
          <Eye className="h-3.5 w-3.5 mr-1 inline" />
          View Details
        </button>
        <button type="button" className="ui-btn ui-btn-primary text-xs" onClick={onApprove}>
          <Check className="h-3.5 w-3.5 mr-1 inline" />
          Approve
        </button>
        <button type="button" className="ui-btn ui-btn-ghost text-xs text-rose-600" onClick={onReject}>
          <XCircle className="h-3.5 w-3.5 mr-1 inline" />
          Reject
        </button>
      </div>
    </div>
  );
}

function DetailModal({ item, history, historyLoading, onClose, onApprove, onReject }) {
  const isLeave = item.category === "leave";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text)]">
              {isLeave ? "Leave Request" : CATEGORY_LABELS[item.category]}
            </h3>
            <p className="text-xs font-mono text-[var(--color-primary)]">{item.request_code}</p>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            ✕
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm">
          {isLeave && (
            <>
              <DetailRow label="Employee" value={item.employee_name} />
              <DetailRow label="Department" value={item.department} />
              <DetailRow label="Designation" value={item.designation} />
              <DetailRow label="Leave Type" value={item.title || item.extra?.leave_type} />
              <DetailRow label="Duration" value={formatDateRange(item.extra)} />
              <DetailRow label="Days" value={item.extra?.days} />
              {item.extra?.leave_balance != null && (
                <DetailRow label="Leave balance" value={`${item.extra.leave_balance} day(s)`} />
              )}
            </>
          )}
          {!isLeave && (
            <>
              <DetailRow label="Summary" value={item.title} />
              <DetailRow label="Details" value={item.detail_summary} />
              {item.employee_name && <DetailRow label="Requested by" value={item.employee_name} />}
            </>
          )}
          <DetailRow label="Reason" value={item.reason || "—"} />
          <DetailRow label="Submitted" value={formatDate(item.submitted_at)} />
          <DetailRow label="Status" value={item.status} />
        </dl>

        {isLeave && (
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-bold text-[var(--color-text-muted)] mb-2">Approval History</p>
            {historyLoading ? (
              <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">No additional history.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {history.map((h, idx) => (
                  <li key={idx} className="rounded-lg bg-[var(--color-surface-muted)] p-2">
                    <p className="font-semibold">{h.label}</p>
                    <p className="text-[var(--color-text-muted)]">
                      {formatDate(h.at)}
                      {h.by_name ? ` · ${h.by_name}` : ""}
                    </p>
                    {h.status && <p className="capitalize">Status: {h.status}</p>}
                    {h.detail && <p className="mt-1">{h.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
          <button type="button" className="ui-btn ui-btn-secondary text-xs" onClick={onClose}>
            Close
          </button>
          <button type="button" className="ui-btn ui-btn-ghost text-xs text-rose-600" onClick={onReject}>
            Reject
          </button>
          <button type="button" className="ui-btn ui-btn-primary text-xs" onClick={onApprove}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-border)]/60 pb-2">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-medium text-[var(--color-text)] text-right">{value ?? "—"}</dd>
    </div>
  );
}

function approveLeaveMessage(item) {
  const range = formatDateRange(item.extra);
  return `Approve Leave Request?\n\n${item.employee_name}\n${item.title}\n${range}\n${item.detail_summary}\n\nAre you sure you want to approve this request?`;
}

function RejectForm({ item, reason, setReason }) {
  const range = formatDateRange(item.extra);
  const summary =
    item.category === "leave"
      ? `Employee: ${item.employee_name}\nLeave: ${range || item.detail_summary}`
      : item.request_code;
  return (
    <div className="space-y-3 text-left text-sm">
      <p className="whitespace-pre-line text-[var(--color-text-muted)]">{summary}</p>
      <label className="block text-xs font-semibold">
        Reason for rejection <span className="text-rose-500">*</span>
        <textarea
          className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </div>
  );
}
