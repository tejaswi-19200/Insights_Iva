import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, Download, Edit3, Play, Plus, Printer, Save } from "lucide-react";

import Button from "../common/Button";
import CompletedJobCardAllStagesReport from "./CompletedJobCardAllStagesReport";
import ProductionJobCardSections from "./ProductionJobCardSections";
import SalesJobCardDocument from "./SalesJobCardDocument";
import JobCardTimeline from "./JobCardTimeline";
import StoreManagerJobCardPanel from "./StoreManagerJobCardPanel";
import WorkflowTracker from "./WorkflowTracker";
import { WorkflowStatusBadge } from "./jobCardUiShared";
import { getProductionOrderDetail, getProductionOrders } from "../../api/productionApi";
import { PRIORITY_COLORS, enrichApiOrder } from "../../data/productionPlanningMasterData";
import { getWorkflowStatusLabel } from "../../config/workflowStages";
import { isStoreManager } from "../../config/permissions";
import {
  downloadProductionJobCardPdf,
  downloadSalesJobCardPdf,
  printProductionJobCardLandscape,
  printSalesJobCardLandscape,
} from "../../utils/printUtils";
import { getCompanySettings } from "../../api/settingsApi";
import { storeRowMenuItems } from "../../utils/storeJobCardQueue";
import useAuth from "../../hooks/useAuth";
import "../../styles/job-card-page.css";

/**
 * Unified Job Card Details shell — Sales Job Card document + optional production sections.
 */
export default function JobCardDetailsShell({
  orderId,
  card,
  form,
  salesOrder,
  customer,
  productLines,
  customers,
  products,
  salesPeople,
  errors,
  mode,
  readOnly,
  selectedProduct,
  productCode,
  onPatchField,
  onSave,
  onCreate,
  saving,
  creating,
  isCreated,
  canEditSales,
  backTo,
  onCancel = null,
  productionOrderId: initialPoId,
  onEdit,
  onOpenWorkflow,
  stageActions = null,
  stageTitle = null,
  showWorkflowTracker = true,
  onRefreshStoreContext = null,
  refreshingStoreContext = false,
  details = null,
  machines = [],
  editableSections = [],
  canEditDetails = false,
  onPatchDetailsSection = null,
  onPatchRawMaterial = null,
  onAddRawMaterial = null,
  onRemoveRawMaterial = null,
  productionDetailsEditable = false,
  onSaveProductionDetails = null,
  savingProductionDetails = false,
  audit = null,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [productionOrder, setProductionOrder] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [showProduction, setShowProduction] = useState(false);

  useEffect(() => {
    if (productionDetailsEditable) setShowProduction(true);
  }, [productionDetailsEditable]);

  const summary = card?.summary_panel || {};
  const storeContext = card?.store_context;
  const storeMode = isStoreManager(user) && Boolean(storeContext);
  const ws = card?.workflow_status || form?.workflow_status || summary.workflow_status;
  const priority = form?.priority || summary.priority || card?.priority || "medium";
  const priorityStyle = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;
  const jobCardNo = summary.job_card_no || form?.job_card_no || `JC-${form?.sales_order_no || orderId}`;

  useEffect(() => {
    let cancelled = false;
    getCompanySettings()
      .then((res) => {
        if (!cancelled) setCompanyProfile(res?.data?.data ?? res?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setCompanyProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPo() {
      try {
        let poId = initialPoId || card?.header?.production_order_id;
        if (!poId) {
          const listRes = await getProductionOrders();
          const list = Array.isArray(listRes?.data) ? listRes.data : [];
          const match = list.find((o) => Number(o.sales_order_id) === Number(orderId));
          poId = match?.id;
        }
        if (!poId) {
          if (!cancelled) setProductionOrder(null);
          return;
        }
        const res = await getProductionOrderDetail(poId);
        if (!cancelled) setProductionOrder(enrichApiOrder(res.data));
      } catch {
        if (!cancelled) setProductionOrder(null);
      }
    }
    if (orderId) loadPo();
    return () => {
      cancelled = true;
    };
  }, [orderId, initialPoId, card?.header?.production_order_id]);

  const salesDocument = card?.sales_document;

  const getJobCardPrintPayload = (profile = companyProfile) => ({
    ...(productionOrder || {}),
    ...(card || {}),
    ...(form || {}),
    card,
    form,
    salesDocument,
    details: details || card?.details || form?.details,
    salesOrder,
    customer,
    productLines,
    selectedProduct,
    product_code: productCode,
    productionOrder,
    orderId,
    sales_order_id: orderId,
    id: orderId,
    companyProfile: profile,
    audit: audit || card?.audit,
  });

  const fetchCompanyProfile = async () => {
    try {
      const res = await getCompanySettings({ force: true });
      const profile = res?.data?.data ?? res?.data ?? null;
      setCompanyProfile(profile);
      return profile;
    } catch {
      return companyProfile;
    }
  };

  const handlePrintSales = async () => {
    const profile = await fetchCompanyProfile();
    printSalesJobCardLandscape(getJobCardPrintPayload(profile), user);
  };

  const handleDownloadSalesPdf = async () => {
    const profile = await fetchCompanyProfile();
    downloadSalesJobCardPdf(getJobCardPrintPayload(profile), user);
  };

  const handlePrintProduction = async () => {
    const profile = await fetchCompanyProfile();
    printProductionJobCardLandscape(getJobCardPrintPayload(profile), user);
  };

  const handleDownloadProductionPdf = async () => {
    const profile = await fetchCompanyProfile();
    downloadProductionJobCardPdf(getJobCardPrintPayload(profile), user);
  };

  const isEdit = mode === "edit";
  const salesEditable = isEdit && !isCreated && canEditSales && !readOnly;
  const statusLabel = card?.sales_document?.header?.status || (isCreated ? "Created" : "Draft");

  const headerTitle = isEdit
    ? isCreated
      ? "Edit Job Card"
      : "Create Sales Job Card"
    : "Sales Job Card";

  const headerSubtitle = isEdit
    ? "Complete sales job card details and confirm to release to store."
    : "View sales job card document and workflow status.";

  const storeActionItems = storeMode
    ? storeRowMenuItems({
        ...storeContext,
        sales_order_id: orderId,
        id: orderId,
      }).filter((item) => item.key !== "view" && item.to)
    : [];

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    navigate(backTo);
  };

  const footer = isEdit ? (
    <footer className="job-card-page__footer">
      <Button variant="secondary" onClick={handleCancel} to={onCancel ? undefined : backTo}>
        Cancel
      </Button>
      {canEditSales && !isCreated ? (
        <Button variant="add" loading={creating} disabled={saving} onClick={onCreate} leftIcon={<Plus className="h-4 w-4" aria-hidden />}>
          Confirm Job Card
        </Button>
      ) : null}
      {isCreated && (canEditSales || canEditDetails) ? (
        <Button
          variant="add"
          loading={saving}
          disabled={creating || (readOnly && !canEditDetails)}
          onClick={onSave}
          leftIcon={<Save className="h-4 w-4" aria-hidden />}
        >
          Save
        </Button>
      ) : null}
    </footer>
  ) : (
    <footer className="job-card-page__footer">
      <Button variant="secondary" onClick={() => navigate(backTo)} to={backTo} leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}>
        Back to Job Cards
      </Button>
    </footer>
  );

  const headerActions = !isEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      {(canEditSales || canEditDetails) && onEdit ? (
        <Button variant="add" size="sm" onClick={onEdit} leftIcon={<Edit3 className="h-4 w-4" aria-hidden />}>
          Edit
        </Button>
      ) : null}
      {storeMode && !stageActions
        ? storeActionItems.map((item) => (
            <Button
              key={item.key}
              variant={item.key === "send_to_production" ? "add" : "secondary"}
              size="sm"
              to={item.to}
            >
              {item.label}
            </Button>
          ))
        : null}
      {!storeMode && isCreated && onOpenWorkflow ? (
        <Button variant="secondary" size="sm" onClick={onOpenWorkflow} leftIcon={<Play className="h-4 w-4" aria-hidden />}>
          Open Workflow
        </Button>
      ) : null}
      <Button variant="secondary" size="sm" onClick={handlePrintSales} leftIcon={<Printer className="h-4 w-4" aria-hidden />}>
        Print
      </Button>
      <Button variant="secondary" size="sm" onClick={handleDownloadSalesPdf} leftIcon={<Download className="h-4 w-4" aria-hidden />}>
        Download PDF
      </Button>
      {isCreated && !(storeMode && stageActions) ? (
        <Button variant="secondary" size="sm" onClick={handlePrintProduction} title="Production job card">
          Production Print
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="job-card-page ui-page ui-stack">
      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-soft)] bg-[var(--color-surface)] px-4 py-3 print:hidden">
          <div className="min-w-0">
            <h1 className="mt-0 text-base font-semibold text-[var(--color-text)] sm:text-lg">{headerTitle}</h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{headerSubtitle}</p>
          </div>
          {headerActions}
        </div>

        {!isEdit ? (
          <div className="job-card-page__meta print:hidden">
            <span className="job-card-page__meta-chip">{jobCardNo}</span>
            {orderNoLabel(form, salesOrder) ? (
              <span className="job-card-page__meta-chip">SO {orderNoLabel(form, salesOrder)}</span>
            ) : null}
            <span className="job-card-page__meta-chip">{statusLabel}</span>
            {stageTitle ? <span className="job-card-page__meta-chip">{stageTitle}</span> : null}
            <WorkflowStatusBadge status={ws} label={getWorkflowStatusLabel(ws)} />
            <span className={`job-card-page__meta-chip ${priorityStyle.bg} ${priorityStyle.text}`}>
              {priorityStyle.label}
            </span>
          </div>
        ) : null}

        <SalesJobCardDocument
          card={card}
          form={form}
          salesOrder={salesOrder}
          customer={customer}
          productLines={productLines}
          products={products}
          customers={customers}
          details={details || card?.details}
          companyProfile={companyProfile}
          errors={errors}
          editable={salesEditable}
          onPatchField={onPatchField}
        />

        {isCreated ? (
          <div className="sjc-doc__production-toggle px-4 pb-4 print:hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-primary)]"
              onClick={() => setShowProduction((v) => !v)}
            >
              Production Job Card Details
              {showProduction ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showProduction ? (
              <div className="mt-2 border border-[var(--color-border-soft)]">
                <ProductionJobCardSections
                  details={details || card?.details}
                  errors={errors}
                  editableSections={editableSections}
                  readOnly={
                    productionDetailsEditable
                      ? false
                      : isEdit
                        ? readOnly && !canEditDetails
                        : true
                  }
                  machines={machines}
                  operators={salesPeople}
                  uom={form?.unit || "Nos"}
                  audit={audit || card?.audit}
                  form={form}
                  jobCardNo={jobCardNo}
                  onPatchDetails={onPatchDetailsSection}
                  onPatchRawMaterial={onPatchRawMaterial}
                  onAddRawMaterial={onAddRawMaterial}
                  onRemoveRawMaterial={onRemoveRawMaterial}
                />
                {productionDetailsEditable ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border-soft)] p-3">
                    <Button
                      variant="add"
                      size="sm"
                      loading={savingProductionDetails}
                      onClick={onSaveProductionDetails}
                    >
                      Save Production Job Card
                    </Button>
                  </div>
                ) : null}
                {isEdit && canEditDetails ? (
                  <div className="flex flex-wrap gap-2 border-t border-[var(--color-border-soft)] p-3">
                    <Button variant="secondary" size="sm" onClick={handlePrintProduction}>
                      Print Production
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleDownloadProductionPdf}>
                      Production PDF
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="print:hidden">{footer}</div>

        {stageActions ? <div className="border-t border-[var(--color-border-soft)] p-4 sm:p-5 print:hidden">{stageActions}</div> : null}
      </div>

      {!isEdit && !stageActions && (String(ws || "").toUpperCase() === "COMPLETED" || card?.workflow_status === "completed" || form?.workflow_status === "completed") ? (
        <div className="job-card-page__below print:hidden">
          <CompletedJobCardAllStagesReport
            card={card}
            form={form}
            salesOrder={salesOrder}
            orderId={orderId}
          />
        </div>
      ) : null}

      {storeMode && !stageActions && storeContext?.material_requirements?.length ? (
        <div className="job-card-page__below print:hidden">
          <StoreManagerJobCardPanel
            orderId={orderId}
            storeContext={storeContext}
            summary={summary}
            form={form}
            productCode={productCode}
            onRefresh={onRefreshStoreContext}
            refreshing={refreshingStoreContext}
          />
        </div>
      ) : null}

      {!isEdit && showWorkflowTracker && (card?.workflow_tracker?.length || card?.workflow_steps?.length || card?.workflow?.length) ? (
        <article className="ui-card overflow-hidden print:hidden">
          <h2 className="ui-section-title !rounded-none">Workflow Timeline</h2>
          <div className="p-4 sm:p-5">
            <WorkflowTracker
              embedded
              steps={card?.workflow_tracker || card?.workflow_steps || card?.workflow || []}
              currentStage={card?.workflow_current_stage}
            />
          </div>
        </article>
      ) : null}

      {!isEdit && card?.timeline?.length ? (
        <div className="job-card-page__below print:hidden">
          <JobCardTimeline embedded events={card.timeline} />
        </div>
      ) : null}
    </div>
  );
}

function orderNoLabel(form, salesOrder) {
  return form?.sales_order_no || salesOrder?.order_number || "";
}
