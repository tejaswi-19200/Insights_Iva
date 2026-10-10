import { manualJobCardCanSend } from "./manualSalesJobCard";

/** Human-readable status for manual job card workflow banners. */
export function jobCardStatusLabel(cardOrRow) {
  const src = cardOrRow || {};
  return (
    src.queue_status_label ||
    src.status_label ||
    src.workflow_stage ||
    src.status ||
    "—"
  );
}

/**
 * Returns contextual "what happened / what next" guidance for Job Card screens.
 * Used by WorkflowNextStep banners — not for business logic.
 */
export function getJobCardWorkflowGuidance({
  card = null,
  row = null,
  storeMode = false,
  productionMode = false,
  materialCheckTargetId = "manual-material-check-panel",
} = {}) {
  const src = card || row || {};
  const ws = String(src.workflow_status || "").toUpperCase();
  const canSend =
    src.can_send === true ||
    (src.can_send !== false && manualJobCardCanSend(src));
  const sentTo = src.sent_to || card?.sent_to;
  const materialCheck = card?.material_check || src.material_check;

  if (storeMode) {
    if (ws === "MATERIAL_CHECK_PENDING" && !materialCheck?.checked_at) {
      return {
        tone: "info",
        title: "Review this job card",
        statusLabel: jobCardStatusLabel(src),
        message:
          "Check required materials against live inventory. Saving the material check does not send the job card anywhere.",
        nextStep: "Complete Material Availability Check below, then save your result.",
        scrollToId: materialCheckTargetId,
        actionLabel: "Go to Material Check",
      };
    }
    if (
      materialCheck?.checked_at &&
      ["MATERIAL_AVAILABLE", "MATERIAL_PARTIAL", "MATERIAL_SHORTAGE"].includes(ws)
    ) {
      const shortage = ws === "MATERIAL_SHORTAGE";
      const partial = ws === "MATERIAL_PARTIAL";
      return {
        tone: shortage || partial ? "warning" : "success",
        title: "Material check saved",
        statusLabel: jobCardStatusLabel(src),
        message: shortage
          ? "Materials are not fully available. The job card stays with you until you decide to notify Production or wait for stock."
          : partial
            ? "Some materials are in stock and some are short. Review shortages before sending to Production."
            : "All required materials are available in stock.",
        nextStep: canSend
          ? "When ready, explicitly send this job card to Production Manager. Saving did not send it."
          : "No further send action is available from your role right now.",
        actionType: canSend ? "send" : null,
        actionLabel: canSend ? "Send to Production Manager" : null,
        sendRole: "Production Manager",
      };
    }
    return null;
  }

  if (productionMode && materialCheck?.checked_at) {
    const shortage = materialCheck.status === "shortage";
    const partial = materialCheck.status === "partial";
    return {
      tone: shortage ? "warning" : partial ? "warning" : "success",
      title: "Material status from Store",
      statusLabel: jobCardStatusLabel(src),
      message: shortage
        ? "Store reported a material shortage. Review details before planning production."
        : partial
          ? "Store reported partial material availability. Review shortages below."
          : "Store confirmed materials are available.",
      nextStep: "Review job card details, then continue with production planning.",
    };
  }

  if (!storeMode && !productionMode) {
    if (ws === "RETURNED_TO_SALES") {
      return {
        tone: "warning",
        title: "Returned from Store",
        statusLabel: "Returned to Sales",
        message: "Store returned this job card for correction. Sales information can be edited.",
        nextStep: canSend
          ? "Update the job card, save, then send back to Store Manager."
          : "Update the job card and save your changes.",
        actionType: canSend ? "send" : null,
        actionLabel: canSend ? "Send to Store Manager" : null,
        sendRole: "Store Manager",
      };
    }
    if ((ws === "SAVED" || ws === "" || ws === "DRAFT") && canSend) {
      return {
        tone: "success",
        title: "Job Card saved — not sent yet",
        statusLabel: ws === "DRAFT" ? "Draft" : "Saved",
        message:
          "Save only stores this job card. It has not been routed to Store Manager or any other user.",
        nextStep: "When ready, send it to Store Manager for material availability check.",
        actionType: "send",
        actionLabel: "Send to Store Manager",
        sendRole: "Store Manager",
      };
    }
    if (ws === "MATERIAL_CHECK_PENDING" || sentTo) {
      return {
        tone: "info",
        title: "Job Card sent",
        statusLabel: sentTo ? `Sent — ${sentTo}` : "Sent to Store",
        message: "This job card is with Store Manager for material check.",
        nextStep: "You will be notified when Store completes the check or returns it to Sales.",
      };
    }
    if (ws === "READY_FOR_PRODUCTION") {
      return {
        tone: "info",
        title: "With Production",
        statusLabel: "Ready for Production",
        message: "Store has forwarded this job card to Production Manager.",
        nextStep: "Production planning can continue from the Production queue.",
      };
    }
  }

  return null;
}
