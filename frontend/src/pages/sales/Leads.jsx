import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Filter, LayoutGrid, List, PhoneCall, Plus, Target, TrendingUp, UserPlus, Users, XCircle } from "lucide-react";
import KpiCard from "../../components/common/KpiCard";

import DataTable from "../../components/common/DataTable";
import EmptyState from "../../components/common/EmptyState";
import Loader from "../../components/common/Loader";
import PageHeader from "../../components/common/PageHeader";
import ExportDownloadMenu from "../../components/common/ExportDownloadMenu";
import { ListPageCard, ListPageCardBody, ListPageShell } from "../../components/common/ListPageShell";
import { SearchBar } from "../../components/common/SearchFilter";
import Button from "../../components/common/Button";
import {
  salesListTextMuted,
  salesListTextPrimary,
  salesListTextSecondary,
} from "../../components/sales/salesListDesignSystem";
import LeadDetailModal from "../../components/sales/LeadDetailModal";
import LeadRowActionsMenu from "../../components/sales/LeadRowActionsMenu";
import ConfirmationDialog from "../../components/common/ConfirmationDialog";
import { useToast } from "../../context/ToastContext";
import usePageRefresh from "../../hooks/usePageRefresh";
import usePermissions from "../../hooks/usePermissions";
import {
  convertLeadToQuotation,
  deleteLead,
  getLeadSummary,
  getLeadsEnriched,
  updateLeadStatus,
} from "../../api/salesApi";
import { apiErrorMessage } from "../../utils/apiError";
import {
  KANBAN_COLUMNS,
  LEAD_INDUSTRIES,
  LEAD_REGIONS,
  LEAD_SOURCES,
  formatInr,
  priorityColor,
  statusColor,
} from "../../data/salesMasterData";
import { runListExport } from "../../utils/listExport";
import { applyDraftListFilters, clearListFilters } from "../../utils/listFilterState";

const LEAD_EXPORT_COLUMNS = [
  { key: "lead_id", label: "Lead ID" },
  { key: "customer_name", label: "Customer" },
  { key: "company", label: "Company" },
  { key: "contact", label: "Contact" },
  { key: "source", label: "Source" },
  { key: "sales_executive", label: "Sales Exec" },
  { key: "priority", label: "Priority" },
  { key: "next_followup", label: "Next Follow-up" },
  { key: "status", label: "Status" },
];

const defaultFilters = { sales_executive: "", source: "", industry: "", region: "", status: "", priority: "" };

function leadMatchesSearch(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [row.customer_name, row.company, row.sales_executive]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function Leads() {
  const { addToast } = useToast();
  const { isAdmin, can, canAction } = usePermissions();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState([]);
  const [summaryState, setSummaryState] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const openPipelineOnly = searchParams.get("open") === "1";
  const followupDueOnly = searchParams.get("followup") === "due";
  const leadQueryParams = useMemo(() => {
    const params = {};
    if (openPipelineOnly) params.open_only = true;
    if (followupDueOnly) params.followup_due = true;
    const createdFrom = searchParams.get("created_from");
    const createdTo = searchParams.get("created_to");
    if (createdFrom && createdTo) {
      params.from_date = createdFrom;
      params.to_date = createdTo;
    }
    return params;
  }, [openPipelineOnly, followupDueOnly, searchParams]);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [view, setView] = useState("table");
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [convertingLeadId, setConvertingLeadId] = useState(null);

  const canViewLeads = can("sales");
  const canEditLeads = isAdmin || canAction("sales", "update") || can("sales");
  const canDeleteLeads = isAdmin || canAction("sales", "delete");
  const canCreateQuotation = isAdmin || canAction("sales", "create") || can("sales");

  useEffect(() => {
    const status = searchParams.get("status");
    if (status) {
      const next = { ...defaultFilters, status };
      setDraftFilters(next);
      setAppliedFilters(next);
      setShowAdvanced(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    navigate("/sales/leads/new");
  }, [navigate, searchParams]);

  useEffect(() => {
    const leadId = searchParams.get("lead");
    if (!leadId || !rows.length) return;
    const match = rows.find((r) => String(r.id) === String(leadId));
    if (match) {
      setSelected(match);
      const next = new URLSearchParams(searchParams);
      next.delete("lead");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, rows, setSearchParams]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [summaryRes, listRes] = await Promise.allSettled([
        getLeadSummary(),
        getLeadsEnriched(leadQueryParams),
      ]);

      if (listRes.status === "rejected") {
        throw listRes.reason;
      }
      const rawRows = Array.isArray(listRes.value?.data) ? listRes.value.data : [];
      // Backend returns "name" / "phone"; this page still reads the older
      // "customer_name" / "contact" keys in its table, search, and export
      // logic. Alias them here so both old and new leads render correctly
      // without touching every render site below.
      const liveRows = rawRows.map((r) => ({
        ...r,
        customer_name: r.customer_name ?? r.name,
        contact: r.contact ?? r.phone,
      }));
      const liveSummary = summaryRes.status === "fulfilled" && summaryRes.value?.data
        ? summaryRes.value.data
        : null;
      setRows(liveRows);
      if (liveSummary) {
        setSummaryState(liveSummary);
      } else {
        setSummaryState(null);
        addToast(
          apiErrorMessage(summaryRes.reason, "Could not load lead summary from the server."),
          "error"
        );
      }
    } catch (err) {
      setRows([]);
      setSummaryState(null);
      addToast(apiErrorMessage(err, "Could not load leads from the server."), "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, leadQueryParams]);

  usePageRefresh(() => load(true));

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    if (summaryState) {
      return {
        total_leads: Number(summaryState.total_leads ?? summaryState.total ?? rows.length) || 0,
        new_leads: Number(summaryState.new_leads ?? 0) || 0,
        contacted_leads: Number(summaryState.contacted_leads ?? 0) || 0,
        qualified_leads: Number(summaryState.qualified_leads ?? 0) || 0,
        won_customers: Number(summaryState.won_customers ?? summaryState.won ?? 0) || 0,
        lost_leads: Number(summaryState.lost_leads ?? 0) || 0,
        conversion_rate: summaryState.conversion_rate ?? 0,
      };
    }
    const total_leads = rows.length;
    const new_leads = rows.filter((r) => String(r.status || "").toLowerCase() === "new").length;
    const contacted_leads = rows.filter((r) => String(r.status || "").toLowerCase() === "contacted").length;
    const qualified_leads = rows.filter((r) => ["qualified"].includes(String(r.status || "").toLowerCase())).length;
    const won_customers = rows.filter((r) => ["won", "converted"].includes(String(r.status || "").toLowerCase())).length;
    const lost_leads = rows.filter((r) => String(r.status || "").toLowerCase() === "lost").length;
    const conversion_rate = total_leads > 0 ? ((won_customers / total_leads) * 100).toFixed(1) : 0;
    return { total_leads, new_leads, contacted_leads, qualified_leads, won_customers, lost_leads, conversion_rate };
  }, [rows, summaryState]);

  const hasAdvancedFilters = useMemo(
    () => Object.values(appliedFilters).some((v) => Boolean(v)),
    [appliedFilters]
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (openPipelineOnly && !leadQueryParams.open_only) {
      list = list.filter((r) => {
        const s = String(r.status || "").toLowerCase();
        return s !== "converted" && s !== "lost" && s !== "won";
      });
    }
    Object.entries(appliedFilters).forEach(([k, v]) => {
      if (!v) return;
      list = list.filter((r) => String(r[k] || "").toLowerCase().includes(v.toLowerCase()));
    });
    if (tableSearch.trim()) {
      list = list.filter((r) => leadMatchesSearch(r, tableSearch));
    }
    return list;
  }, [rows, appliedFilters, tableSearch, openPipelineOnly, leadQueryParams]);

  const handleStatus = async (lead, status) => {
    if (typeof lead.id === "number") {
      try {
        await updateLeadStatus(lead.id, status);
        addToast("Lead status updated");
      } catch (err) {
        addToast(err.response?.data?.detail || "Update failed", "error");
      }
    } else {
      addToast(`Lead status updated to ${status}`);
    }

    const matchLead = (l) =>
      (l.lead_id && lead.lead_id && l.lead_id === lead.lead_id) ||
      (l.id && lead.id && l.id === lead.id) ||
      l.customer_name === lead.customer_name;

    // Update state and persistent storage
    setRows((prev) => {
      const updated = prev.map((l) => (matchLead(l) ? { ...l, status } : l));
      const stored = localStorage.getItem("smrt_leads");
      const localLeads = stored ? JSON.parse(stored) : [];
      const updatedLocal = localLeads.map((l) => (matchLead(l) ? { ...l, status } : l));
      if (!updatedLocal.some((l) => matchLead(l))) {
        const found = updated.find((l) => matchLead(l));
        if (found) updatedLocal.push(found);
      }
      localStorage.setItem("smrt_leads", JSON.stringify(updatedLocal));
      return updated;
    });

    setSelected((prev) => (prev && matchLead(prev) ? { ...prev, status } : prev));
  };

  const handleViewLead = (lead) => setSelected(lead);

  const handleEditLead = (lead) => {
    if (!canEditLeads) return;
    if (typeof lead.id !== "number") {
      addToast("This lead must be saved on the server before it can be edited.", "error");
      return;
    }
    navigate(`/sales/leads/${lead.id}/edit`);
  };

  const handleDeleteLead = (lead) => {
    if (!canDeleteLeads) return;
    setDeleteTarget(lead);
  };

  const confirmDeleteLead = async () => {
    if (!deleteTarget || typeof deleteTarget.id !== "number") {
      setDeleteTarget(null);
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteLead(deleteTarget.id);
      setRows((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) setSelected(null);
      addToast("Lead deleted.", "success");
      setDeleteTarget(null);
    } catch (err) {
      addToast(apiErrorMessage(err, "Could not delete lead."), "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreateQuotationFromLead = async (lead) => {
    if (!canCreateQuotation) return;
    if (typeof lead.id !== "number") {
      addToast("Save this lead on the server before creating a quotation.", "error");
      return;
    }
    setConvertingLeadId(lead.id);
    try {
      const res = await convertLeadToQuotation(lead.id);
      const quote = res?.data;
      const quoteId = quote?.id;
      addToast(quote?.quote_number ? `Quotation ${quote.quote_number} created.` : "Quotation created.", "success");
      if (quoteId) {
        navigate(`/sales/quotations/${quoteId}/edit`);
      } else {
        navigate("/sales/quotations");
      }
    } catch (err) {
      addToast(apiErrorMessage(err, "Could not create quotation from lead."), "error");
    } finally {
      setConvertingLeadId(null);
    }
  };

  const handleViewQuotationFromLead = (lead) => {
    if (lead.quotation_id) {
      navigate(`/sales/quotations/${lead.quotation_id}/edit`);
    }
  };

  const leadActionMenuProps = {
    openMenu,
    setOpenMenu,
    canView: canViewLeads,
    canEdit: canEditLeads,
    canDelete: canDeleteLeads,
    canCreateQuotation,
    onView: handleViewLead,
    onEdit: handleEditLead,
    onDelete: handleDeleteLead,
    onCreateQuotation: handleCreateQuotationFromLead,
    onViewQuotation: handleViewQuotationFromLead,
  };

  const columns = [
    { key: "lead_id", label: "Lead ID", render: (r) => <span className="rounded bg-[var(--color-success-soft)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--color-success)]">{r.lead_id || `LD-${r.id}`}</span> },
    { key: "customer_name", label: "Customer", render: (r) => <span className="font-bold text-[var(--color-text)]">{r.customer_name}</span> },
    { key: "company", label: "Company" },
    { key: "contact", label: "Contact" },
    { key: "source", label: "Source" },
    { key: "sales_executive", label: "Sales Exec" },
    { key: "priority", label: "Priority", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${priorityColor(r.priority)}`}>{r.priority}</span> },
    { key: "next_followup", label: "Next Follow-up", render: (r) => String(r.next_followup || "").slice(0, 10) || "—" },
    { key: "status", label: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor(r.status)}`}>{r.status}</span> },
    {
      key: "actions",
      label: "Actions",
      align: "center",
      sortable: false,
      render: (r) => (
        <LeadRowActionsMenu lead={r} {...leadActionMenuProps} />
      ),
    },
  ];

  const handleExport = (format) => {
    const exportRows = filtered.map((r) => ({
      lead_id: r.lead_id || `LD-${r.id}`,
      customer_name: r.customer_name,
      company: r.company,
      contact: r.contact,
      source: r.source,
      sales_executive: r.sales_executive,
      priority: r.priority,
      next_followup: String(r.next_followup || "").slice(0, 10),
      status: r.status,
    }));
    runListExport(format, {
      data: exportRows,
      columns: LEAD_EXPORT_COLUMNS,
      filename: "leads",
      title: "Leads",
    });
    addToast(format === "pdf" ? "Exported to PDF" : "Exported to Excel", "success");
  };

  if (loading) return <Loader label="Loading leads..." />;

  return (
    <ListPageShell stackClassName="space-y-4 pb-4">
      <PageHeader
        className="erp-hero-header--compact inventory-hero-header--compact"
        subtitle="Kanban and table views with lead profiles and quotation handoff."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportDownloadMenu disabled={!filtered.length} onExport={handleExport} />
            <Button
              variant="add"
              type="button"
              onClick={() => navigate("/sales/leads/new")}
              leftIcon={<Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
            >
              New Lead
            </Button>
          </div>
        }
      />

      <div className="ui-grid-kpi">
        <KpiCard
          label="Total Leads"
          value={summary.total_leads}
          icon={Users}
          tone="teal"
          onClick={() => clearListFilters(defaultFilters, setDraftFilters, setAppliedFilters)}
          title="View all leads"
        />
        <KpiCard
          label="New Leads"
          value={summary.new_leads}
          icon={UserPlus}
          tone="teal"
          onClick={() => {
            const next = { ...defaultFilters, status: "new" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="View new leads"
        />
        <KpiCard
          label="Contacted"
          value={summary.contacted_leads}
          icon={PhoneCall}
          tone="info"
          onClick={() => {
            const next = { ...defaultFilters, status: "contacted" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="View contacted leads"
        />
        <KpiCard
          label="Qualified"
          value={summary.qualified_leads}
          icon={Target}
          tone="neutral"
          onClick={() => {
            const next = { ...defaultFilters, status: "qualified" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="View qualified leads"
        />
        <KpiCard
          label="Lost Leads"
          value={summary.lost_leads}
          icon={XCircle}
          tone="danger"
          onClick={() => {
            const next = { ...defaultFilters, status: "lost" };
            setDraftFilters(next);
            setAppliedFilters(next);
          }}
          title="View lost leads"
        />
        <KpiCard label="Conversion Rate" value={summary.conversion_rate} suffix="%" icon={TrendingUp} tone="success" title="Overall conversion rate" />
      </div>

      <div className={`ui-card flex items-center gap-2 overflow-x-auto py-2.5 px-3 text-xs font-medium ${salesListTextSecondary} scrollbar-none`}>
        {["Lead", "Qualification", "Opportunity", "Quotation", "Sales Order"].map((s, i, arr) => (
          <span key={s} className="flex items-center gap-2 shrink-0">
            <span className={`rounded-lg bg-[var(--color-surface-muted)] px-2.5 py-1 font-semibold ${salesListTextPrimary} ring-1 ring-[var(--color-border)]`}>
              {s}
            </span>
            {i < arr.length - 1 && (
              <span className={salesListTextMuted} aria-hidden="true">
                →
              </span>
            )}
          </span>
        ))}
      </div>

      <ListPageCard>
        <ListPageCardBody>
          <div className="ui-list-toolbar mb-3">
            <div className="ui-list-toolbar__start">
              <SearchBar
                value={tableSearch}
                onChange={setTableSearch}
                placeholder="Search leads..."
                aria-label="Search leads"
              />
              <Button
                type="button"
                variant={showAdvanced || hasAdvancedFilters ? "outline" : "secondary"}
                size="sm"
                onClick={() => setShowAdvanced((open) => !open)}
                leftIcon={<Filter className="h-4 w-4" aria-hidden />}
                aria-expanded={showAdvanced}
              >
                Advanced Filters
              </Button>
            </div>
            <div className="ui-list-toolbar__end">
              <div
                className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] p-0.5"
                role="group"
                aria-label="Lead view"
              >
                <Button
                  type="button"
                  variant={view === "table" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView("table")}
                  leftIcon={<List className="h-3.5 w-3.5" aria-hidden />}
                  aria-pressed={view === "table"}
                >
                  Table
                </Button>
                <Button
                  type="button"
                  variant={view === "kanban" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView("kanban")}
                  leftIcon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
                  aria-pressed={view === "kanban"}
                >
                  Kanban
                </Button>
              </div>
            </div>
          </div>

          {showAdvanced && (
            <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <input
                value={draftFilters.sales_executive}
                onChange={(e) => setDraftFilters({ ...draftFilters, sales_executive: e.target.value })}
                placeholder="Sales Executive"
                className="ui-input"
              />
              <select
                value={draftFilters.source}
                onChange={(e) => setDraftFilters({ ...draftFilters, source: e.target.value })}
                className="ui-select"
              >
                <option value="">All Sources</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.industry}
                onChange={(e) => setDraftFilters({ ...draftFilters, industry: e.target.value })}
                className="ui-select"
              >
                <option value="">All Industries</option>
                {LEAD_INDUSTRIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.region}
                onChange={(e) => setDraftFilters({ ...draftFilters, region: e.target.value })}
                className="ui-select"
              >
                <option value="">All Regions</option>
                {LEAD_REGIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.status}
                onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
                className="ui-select"
              >
                <option value="">All Status</option>
                {["new", "contacted", "qualified", "converted", "won", "lost"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={draftFilters.priority}
                onChange={(e) => setDraftFilters({ ...draftFilters, priority: e.target.value })}
                className="ui-select"
              >
                <option value="">All Priority</option>
                {["urgent", "high", "medium", "low"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <div className="col-span-full flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-soft)] pt-3">
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

          {view === "table" ? (
            <>
              {/* Mobile Lead Cards View */}
              <div className="space-y-3 md:hidden">
                {filtered.length === 0 ? (
                  <EmptyState
                    icon="document"
                    title="No records found."
                    description="There is nothing to show here yet."
                    className="border-none bg-transparent py-8"
                  />
                ) : (
                  filtered.map((r) => {
                    return (
                      <div
                        key={r.lead_id || r.id}
                        className="ui-card p-3.5 space-y-2.5 transition hover:border-[var(--color-primary-soft)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="rounded bg-[var(--color-success-soft)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-success)]">
                                {r.lead_id || `LD-${r.id}`}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${priorityColor(r.priority)}`}>
                                {r.priority}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusColor(r.status)}`}>
                                {r.status}
                              </span>
                            </div>
                            <h3 className="mt-1 font-bold text-sm text-[var(--color-text)] truncate">
                              {r.customer_name}
                            </h3>
                            {r.company && (
                              <p className="text-xs text-[var(--color-text-muted)] truncate">{r.company}</p>
                            )}
                          </div>
                        </div>

                        <div className={`grid grid-cols-2 gap-2 text-xs border-t border-[var(--color-border-soft)] pt-2 ${salesListTextSecondary}`}>
                          <div>
                            <span className={`${salesListTextMuted} block text-[11px] font-medium`}>Contact</span>
                            <span className="font-medium truncate block">{r.contact || "—"}</span>
                          </div>
                          <div>
                            <span className={`${salesListTextMuted} block text-[11px] font-medium`}>Sales Exec</span>
                            <span className="font-medium truncate block">{r.sales_executive || "—"}</span>
                          </div>
                          <div>
                            <span className={`${salesListTextMuted} block text-[11px] font-medium`}>Next Follow-up</span>
                            <span className="font-medium">{String(r.next_followup || "").slice(0, 10) || "—"}</span>
                          </div>
                          {(r.opportunity_value || r.estimated_value) && (
                            <div>
                              <span className={`${salesListTextMuted} block text-[11px] font-medium`}>Value</span>
                              <span className="font-bold text-[var(--color-success)]">{formatInr(r.opportunity_value || r.estimated_value)}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end border-t border-[var(--color-border-soft)] pt-2.5">
                          <LeadRowActionsMenu lead={r} {...leadActionMenuProps} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block">
                <DataTable
                  columns={columns}
                  data={filtered}
                  showSearch={false}
                  emptyState={
                    <EmptyState
                      icon="document"
                      title="No records found."
                      description="There is nothing to show here yet."
                      className="border-none bg-transparent py-12"
                    />
                  }
                />
              </div>
            </>
          ) : (
            <div className="flex gap-3.5 overflow-x-auto pb-3 snap-x snap-mandatory scrollbar-none lg:grid lg:grid-cols-5 lg:overflow-visible">
              {KANBAN_COLUMNS.map((col) => (
                <div
                  key={col.id}
                  className={`min-w-[260px] max-w-[280px] shrink-0 snap-center rounded-lg border p-3 sm:min-w-0 sm:max-w-none ${col.color}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className={`text-xs font-semibold ${salesListTextPrimary}`}>{col.label}</p>
                    <span className={`rounded-full bg-[var(--color-surface)]/80 px-2 py-0.5 text-[10px] font-bold ${salesListTextPrimary}`}>
                      {
                        filtered.filter(
                          (r) =>
                            String(r.status || "").toLowerCase() === col.id.toLowerCase() ||
                            (col.id === "converted" && (r.status === "converted" || r.status === "won"))
                        ).length
                      }
                    </span>
                  </div>
                  <div className="space-y-2.5 max-h-[70vh] overflow-y-auto">
                    {filtered
                      .filter(
                        (r) =>
                          String(r.status || "").toLowerCase() === col.id.toLowerCase() ||
                          (col.id === "converted" && (r.status === "converted" || r.status === "won"))
                      )
                      .map((r) => {
                        return (
                          <div
                            key={r.lead_id || r.id}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-sm transition-shadow hover:shadow-md"
                          >
                            <div className="flex items-start justify-between gap-1">
                              <p className={`text-sm font-bold line-clamp-1 ${salesListTextPrimary}`}>
                                {r.customer_name}
                              </p>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ${priorityColor(r.priority)}`}>
                                {r.priority}
                              </span>
                            </div>
                            <p className={`text-xs font-medium ${salesListTextMuted}`}>{r.company}</p>
                            {(r.opportunity_value || r.estimated_value) && (
                              <p className="mt-1.5 text-xs font-bold text-[var(--color-success)]">
                                {formatInr(r.opportunity_value || r.estimated_value)}
                              </p>
                            )}
                            <div className="mt-3 flex items-center justify-end border-t border-[var(--color-border-soft)] pt-2 text-xs">
                              <LeadRowActionsMenu lead={r} {...leadActionMenuProps} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ListPageCardBody>
      </ListPageCard>

      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatus}
          converting={convertingLeadId === selected?.id}
          onConvertToQuotation={handleCreateQuotationFromLead}
        />
      )}
      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete Lead?"
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.customer_name || deleteTarget.company || "this lead"}?`
            : ""
        }
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={confirmDeleteLead}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
      />
    </ListPageShell>
  );
}