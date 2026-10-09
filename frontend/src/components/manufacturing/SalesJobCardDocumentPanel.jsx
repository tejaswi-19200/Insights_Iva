import { useCallback, useEffect, useState } from "react";
import { Download, Edit3, Printer, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../common/Button";
import CommonStatusBadge from "../common/StatusBadge";
import { erpListStatus } from "../../utils/jobCardListStatus";
import { ErrorState, LoadingState } from "../common/states";
import SalesJobCardDocument from "./SalesJobCardDocument";
import useSalesJobCardDocumentLoader from "../../hooks/useSalesJobCardDocumentLoader";
import useAuth from "../../hooks/useAuth";
import useTenantId from "../../hooks/useTenantId";
import { getCompanySettings } from "../../api/settingsApi";
import { getManualJobCard } from "../../api/workflowApi";
import { jobCardEditUrl } from "../../utils/jobCardRoutes";
import { apiErrorMessage } from "../../utils/apiError";
import { printSalesJobCardLandscape, downloadSalesJobCardPdf } from "../../utils/printUtils";
import StoreManualJobCardActions from "./StoreManualJobCardActions";
import ManualMaterialStatusPanel from "./ManualMaterialStatusPanel";
import WorkflowNextStep from "./WorkflowNextStep";
import { getJobCardWorkflowGuidance } from "../../utils/jobCardWorkflowUx";
import { manualJobCardCanSend } from "../../utils/manualSalesJobCard";
import "../../styles/workflow-next-step.css";

/**
 * Sales Job Card document panel — view manual or SO-linked job cards.
 */
export default function SalesJobCardDocumentPanel({
  orderId = null,
  jobCardId = null,
  row = null,
  listPath = "/my-job-cards",
  onEdit,
  canEdit = false,
  storeMode = false,
  showEmptyShell = false,
  emptyMessage = "Select a job card from the list below, or click New Job Card to create one.",
  showMaterialStatus = false,
  onSend,
  showToolbarSendButton = true,
}) {
  const { user } = useAuth();
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const isManual = Boolean(jobCardId || row?.is_manual);
  const resolvedJobCardId = jobCardId || (row?.is_manual ? row?.job_card_id : null);
  const resolvedOrderId = !isManual ? (orderId ?? row?.sales_order_id ?? null) : null;
  const title =
    row?.job_card_no ||
    row?.order_number ||
    (resolvedJobCardId ? `JC #${resolvedJobCardId}` : resolvedOrderId ? `Order #${resolvedOrderId}` : "Sales Job Card");

  const [shellCompany, setShellCompany] = useState(null);
  const [manualCard, setManualCard] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState("");

  const {
    loading: soLoading,
    error: soError,
    card: soCard,
    form: soForm,
    salesOrder,
    customer,
    productLines,
    products,
    companyProfile,
    load: reloadSo,
    printPayload: soPrintPayload,
  } = useSalesJobCardDocumentLoader(resolvedOrderId, tenantId, Boolean(resolvedOrderId) && !isManual);

  const loadManual = useCallback(async () => {
    if (!resolvedJobCardId) return;
    setManualLoading(true);
    setManualError("");
    try {
      const res = await getManualJobCard(resolvedJobCardId);
      setManualCard(res?.data ?? res);
    } catch (err) {
      setManualCard(null);
      setManualError(apiErrorMessage(err, "Could not load job card."));
    } finally {
      setManualLoading(false);
    }
  }, [resolvedJobCardId]);

  useEffect(() => {
    if (resolvedJobCardId) loadManual();
    else setManualCard(null);
  }, [resolvedJobCardId, loadManual]);

  useEffect(() => {
    let cancelled = false;
    getCompanySettings()
      .then((res) => {
        if (!cancelled) setShellCompany(res?.data?.data ?? res?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setShellCompany(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEdit = () => {
    if (onEdit && row) {
      onEdit(row);
      return;
    }
    if (resolvedJobCardId) {
      navigate(`/sales/job-cards/${resolvedJobCardId}/edit`);
      return;
    }
    if (resolvedOrderId) navigate(jobCardEditUrl(resolvedOrderId));
  };

  const card = isManual ? manualCard : soCard;
  const loading = isManual ? manualLoading : soLoading;
  const error = isManual ? manualError : soError;
  const reload = isManual ? loadManual : reloadSo;

  const manualPrintPayload = () => {
    const sd = manualCard?.sales_document;
    const doc = manualCard?.manual_document;
    const cust = sd?.customer_details || {};
    const lines = sd?.product_lines || [];
    return {
      card: manualCard,
      salesDocument: sd,
      salesOrder: null,
      customer: {
        name: cust.customer_name,
        contact_name: cust.contact_person,
        phone: cust.phone,
        email: cust.email,
        address_line1: cust.billing_address,
      },
      productLines: lines.map((l) => ({
        product_name: l.product_name,
        product_code: l.product_code,
        quantity: l.quantity,
        unit: l.uom,
        uom: l.uom,
        unit_price: l.unit_price,
        line_amount: l.line_amount,
        total_amount: l.total_amount,
      })),
      products: [],
      details: { approval: sd?.approval || doc?.approval },
      companyProfile: companyProfile || shellCompany,
    };
  };

  const printPayload = () => (isManual ? manualPrintPayload() : soPrintPayload());

  const resolvedForm = isManual ? manualCard?.form || {} : soForm || soCard?.form || {};
  const profile = companyProfile || shellCompany;
  const hasSelection = Boolean(resolvedOrderId || resolvedJobCardId);
  const showDocument = Boolean(hasSelection && card && !loading && !error && (card?.sales_document || card?.form));
  const showEmptyLayout = showEmptyShell && !hasSelection;
  const salesReadOnly = storeMode || Boolean(card?.read_only_sales);
  const showStoreActions = storeMode && isManual && resolvedJobCardId && card;
  const workflowStatus = erpListStatus(card || row || {});
  const guidanceSource = card || row || {};
  const workflowGuidance = getJobCardWorkflowGuidance({
    card,
    row,
    storeMode,
    productionMode: showMaterialStatus,
  });
  const showSendButton =
    showToolbarSendButton &&
    Boolean(onSend) &&
    isManual &&
    hasSelection &&
    manualJobCardCanSend(guidanceSource);

  const handleGuidanceAction = () => {
    if (workflowGuidance?.actionType === "send" && onSend) {
      onSend(row || { ...guidanceSource, job_card_id: resolvedJobCardId });
    }
  };

  const manualCustomer = card?.sales_document?.customer_details
    ? {
        name: card.sales_document.customer_details.customer_name,
        contact_name: card.sales_document.customer_details.contact_person,
        phone: card.sales_document.customer_details.phone,
        email: card.sales_document.customer_details.email,
        address_line1: card.sales_document.customer_details.billing_address,
      }
    : null;

  const manualProductLines = (card?.sales_document?.product_lines || []).map((l) => ({
    product_name: l.product_name,
    product_code: l.product_code,
    quantity: l.quantity,
    unit: l.uom,
    uom: l.uom,
    unit_price: l.unit_price,
    line_amount: l.line_amount,
    total_amount: l.total_amount,
  }));

  return (
    <section className="ui-card my-job-cards-page__document-panel" id="sales-job-card-panel">
      <div className="my-job-cards-page__document-toolbar">
        <div className="my-job-cards-page__document-toolbar-main">
          <div className="my-job-cards-page__document-toolbar-titles">
            <h2 className="my-job-cards-page__document-title">Sales Job Card</h2>
            {hasSelection ? (
              <p className="my-job-cards-page__document-subtitle">
                <span className="my-job-cards-page__document-jc-no">{title}</span>
                {row?.customer_name || card?.sales_document?.customer_details?.customer_name ? (
                  <span>
                    {" "}
                    · {row?.customer_name || card?.sales_document?.customer_details?.customer_name}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          {hasSelection && workflowStatus?.label ? (
            <CommonStatusBadge tone={workflowStatus.tone} className="my-job-cards-page__document-status">
              {workflowStatus.label}
            </CommonStatusBadge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showSendButton ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSend(row || { ...guidanceSource, job_card_id: resolvedJobCardId })}
              leftIcon={<Send className="h-4 w-4" aria-hidden />}
            >
              {workflowGuidance?.actionLabel || "Send Job Card"}
            </Button>
          ) : null}
          {canEdit && hasSelection && !salesReadOnly ? (
            <Button variant="secondary" size="sm" onClick={handleEdit} leftIcon={<Edit3 className="h-4 w-4" aria-hidden />}>
              Edit
            </Button>
          ) : null}
          {salesReadOnly && hasSelection ? (
            <span className="my-job-cards-page__read-only-badge">Sales information — read only</span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={!showDocument}
            onClick={() => printSalesJobCardLandscape(printPayload(), user)}
            leftIcon={<Printer className="h-4 w-4" aria-hidden />}
          >
            Print
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!showDocument}
            onClick={() => downloadSalesJobCardPdf(printPayload(), user)}
            leftIcon={<Download className="h-4 w-4" aria-hidden />}
          >
            Download PDF
          </Button>
        </div>
      </div>

      {showDocument && workflowGuidance ? (
        <div className="my-job-cards-page__document-guidance">
          <WorkflowNextStep
            {...workflowGuidance}
            onAction={workflowGuidance.actionType ? handleGuidanceAction : undefined}
            compact
          />
        </div>
      ) : null}

      <div className="my-job-cards-page__document-body">
        {showEmptyLayout ? (
          <>
            <SalesJobCardDocument
              card={{}}
              form={{}}
              salesOrder={null}
              customer={null}
              productLines={[]}
              products={[]}
              companyProfile={profile}
              editable={false}
            />
            <p className="my-job-cards-page__document-empty-msg" role="status">{emptyMessage}</p>
          </>
        ) : null}

        {hasSelection && loading ? (
          <LoadingState label="Loading sales job card…" description="" compact className="py-12" />
        ) : null}

        {hasSelection && error ? (
          <ErrorState title="Could not load sales job card" description={error} onRetry={reload} className="py-10" />
        ) : null}

        {showDocument ? (
          <SalesJobCardDocument
            card={card}
            form={resolvedForm}
            salesOrder={isManual ? null : salesOrder}
            customer={isManual ? manualCustomer : customer}
            productLines={isManual ? manualProductLines : productLines}
            products={isManual ? [] : products}
            details={isManual ? { approval: card?.sales_document?.approval } : card?.details}
            companyProfile={profile}
            editable={false}
          />
        ) : null}

        {showStoreActions ? (
          <StoreManualJobCardActions
            jobCardId={resolvedJobCardId}
            card={card}
            allowedActions={card?.allowed_actions || []}
            onUpdated={reload}
          />
        ) : null}

        {showMaterialStatus && isManual && card?.material_check?.checked_at ? (
          <ManualMaterialStatusPanel
            materialCheck={card.material_check}
            storeComments={card?.store_workflow?.store_comments}
          />
        ) : null}
      </div>
    </section>
  );
}
