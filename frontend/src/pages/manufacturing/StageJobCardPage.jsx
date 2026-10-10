import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Boxes,
  CheckCircle2,
  CheckSquare,
  Clock,
  Factory,
  Layers,
  PackageCheck,
  Plus,
  Receipt,
  ShoppingCart,
} from "lucide-react";

import { FormField, Input, Select, Textarea } from "../../components/common/FormField";
import Button from "../../components/common/Button";
import AddUserModal from "../../components/admin/AddUserModal";
import CreateMachineModal from "../../components/production/CreateMachineModal";
import OperatorJobCardBody from "../../components/manufacturing/OperatorJobCardBody";
import JobCardActions from "../../components/manufacturing/JobCardActions";
import JobCardDetailsShell from "../../components/manufacturing/JobCardDetailsShell";
import { StageNavLinks } from "../../components/manufacturing/JobCardLayout";
import MaterialTable from "../../components/manufacturing/MaterialTable";
import { CardSectionHeader } from "../../components/manufacturing/jobCardUiShared";
import { useToast } from "../../context/ToastContext";
import useAuth from "../../hooks/useAuth";
import usePermissions from "../../hooks/usePermissions";
import useTenantId from "../../hooks/useTenantId";
import useJobCardDetails from "../../hooks/useJobCardDetails";
import { PermissionDeniedState } from "../../components/common/states";
import CompletedJobCardAllStagesReport from "../../components/manufacturing/CompletedJobCardAllStagesReport";
import { getTeamDirectory, getUsers } from "../../api/adminApi";
import { getMachines } from "../../api/productionApi";

function extractOperators(usersList) {
  if (!Array.isArray(usersList) || usersList.length === 0) return [];
  const matched = usersList.filter((u) => {
    if (!u) return false;
    const roleStr = String(u.role || u.role_name || u.designation || u.department || "").toLowerCase();
    if (roleStr.includes("operator") || roleStr.includes("machinist") || roleStr.includes("technician")) {
      return true;
    }
    const rolesList = Array.isArray(u.roles) ? u.roles : [];
    return rolesList.some((r) => {
      const name = String(typeof r === "string" ? r : r?.name || r?.role_name || "").toLowerCase();
      return name.includes("operator") || name.includes("machinist") || name.includes("technician");
    });
  });

  if (matched.length > 0) return matched;
  return usersList.filter((u) => u && u.is_active !== false);
}
import {
  assignOperator,
  completePacking,
  completeProduction,
  createBillingInvoice,
  getStageJobCard,
  holdWorkflowOrder,
  pauseProduction,
  raiseMaterialRequest,
  resumeProduction,
  startProduction,
  submitMaterialCheck,
  submitQualityCheck,
  submitStoreIssue,
  updateProductionProgress,
} from "../../api/workflowApi";
import { ROUTE_SEGMENT_TO_STAGE, STAGE_TITLES } from "../../config/workflowStages";

function formFromStageCard(card) {
  const sp = card?.summary_panel || {};
  const f = card?.form || {};
  return {
    customer_id: f.customer_id ?? card?.customer_id,
    customer_name: sp.customer || f.customer_name,
    sales_person_id: f.sales_person_id,
    sales_person_name: f.sales_person_name || sp.sales_person,
    product_id: f.product_id ?? card?.product_id,
    product_name: sp.product || f.product_name,
    product_code: f.product_code,
    quantity: sp.order_quantity ?? f.quantity,
    unit: sp.uom || f.unit || "Nos",
    required_delivery_date: sp.required_delivery || f.required_delivery_date,
    priority: sp.priority || f.priority || "medium",
    sales_order_no: sp.sales_order_no || f.sales_order_no,
    job_card_no: sp.job_card_no || f.job_card_no,
    notes: f.notes || "",
    workflow_status: sp.workflow_status || card?.workflow_status,
  };
}

export default function StageJobCardPage() {
  const { orderId, stage: routeStage } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const tenantId = useTenantId();

  const stage = ROUTE_SEGMENT_TO_STAGE[routeStage] || routeStage;
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [card, setCard] = useState(null);
  const [materialLines, setMaterialLines] = useState([]);
  const [issueLines, setIssueLines] = useState([]);
  const [operators, setOperators] = useState([]);
  const [machines, setMachines] = useState([]);
  const [showAddOperatorModal, setShowAddOperatorModal] = useState(false);
  const [showAddMachineModal, setShowAddMachineModal] = useState(false);
  const [assignForm, setAssignForm] = useState({ operator_user_id: "", machine_id: "", planned_quantity: "" });
  const [qualityForm, setQualityForm] = useState({ result: "pass", notes: "", defects: "" });
  const [packingForm, setPackingForm] = useState({ packing_status: "packed", packed_quantity: "", courier: "", lr_number: "", remarks: "" });
  const [productionForm, setProductionForm] = useState({
    produced_qty: "",
    rejected_qty: "",
    rework_qty: "",
    notes: "",
    actual_start_time: "",
    actual_end_time: "",
  });

  const {
    loading: detailsLoading,
    card: detailsCard,
    form: detailsForm,
    machines: detailMachines,
    salesPeople: detailOperators,
    salesOrder,
    productLines,
    customers,
    products,
    salesPeople,
    errors,
    load: loadDetails,
    details,
    editableSections,
    patchDetailsSection,
    patchRawMaterial,
    addRawMaterial,
    removeRawMaterial,
    handleSaveDetailsOnly,
    saving: savingDetails,
  } = useJobCardDetails(orderId, tenantId);

  const load = useCallback(async () => {
    if (!orderId || !stage) return;
    setLoading(true);
    setPermissionDenied(false);
    try {
      const res = await getStageJobCard(orderId, stage);
      const data = res?.data ?? res;
      setCard(data);
      if (data.materials) setMaterialLines(data.materials.map((m) => ({ ...m })));
      if (data.material_issue_lines) setIssueLines(data.material_issue_lines.map((m) => ({ ...m })));
      if (data.summary_panel?.order_quantity) {
        setAssignForm((f) => ({ ...f, planned_quantity: String(data.summary_panel.order_quantity) }));
        setPackingForm((f) => ({ ...f, packed_quantity: String(data.summary_panel.order_quantity) }));
      }
      if (stage === "operator" && data.execution) {
        const ex = data.execution;
        setProductionForm({
          produced_qty: ex.produced_qty != null ? String(ex.produced_qty) : "",
          rejected_qty: ex.rejected_qty != null ? String(ex.rejected_qty) : "",
          rework_qty: ex.rework_qty != null ? String(ex.rework_qty) : "",
          notes: ex.operator_remarks || "",
          actual_start_time: "",
          actual_end_time: "",
        });
      } else if (data.summary_panel?.order_quantity && stage !== "operator") {
        setProductionForm((f) => ({ ...f, produced_qty: String(data.summary_panel.order_quantity) }));
      }
    } catch (err) {
      if (err?.response?.status === 403) {
        setPermissionDenied(true);
      } else {
        addToast(err?.response?.data?.detail || "Could not load stage job card", "error");
      }
      setCard(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, stage, addToast]);

  useEffect(() => {
    load();
    loadDetails();
  }, [load, loadDetails]);

  const loadOperators = useCallback(async () => {
    try {
      const rawUsers = await getTeamDirectory()
        .then((r) => r?.data?.items ?? r?.data ?? r ?? [])
        .catch(() => getUsers().then((r) => r?.data?.items ?? r?.data ?? r ?? []))
        .catch(() => []);
      const usersList = Array.isArray(rawUsers) ? rawUsers : [];
      const ops = extractOperators(usersList);
      setOperators(ops);
      return ops;
    } catch {
      return [];
    }
  }, []);

  const handleOperatorCreated = async (createdUser) => {
    const updatedOps = await loadOperators();
    if (createdUser?.id) {
      setAssignForm((f) => ({ ...f, operator_user_id: String(createdUser.id) }));
    } else if (updatedOps.length > 0) {
      const matched = updatedOps.find(
        (o) =>
          (createdUser?.email && o.email === createdUser.email) ||
          (createdUser?.full_name && o.full_name === createdUser.full_name)
      );
      if (matched) {
        setAssignForm((f) => ({ ...f, operator_user_id: String(matched.id) }));
      }
    }
  };

  const loadMachines = useCallback(async () => {
    try {
      const r = await getMachines().catch(() => []);
      const macs = Array.isArray(r) ? r : r?.data?.items ?? r?.data ?? [];
      setMachines(macs);
      return macs;
    } catch {
      return [];
    }
  }, []);

  const handleMachineCreated = async (createdMachine) => {
    const updatedMacs = await loadMachines();
    if (createdMachine?.id) {
      setAssignForm((f) => ({ ...f, machine_id: String(createdMachine.id) }));
    } else if (updatedMacs.length > 0) {
      const matched = updatedMacs.find(
        (m) =>
          (createdMachine?.name && m.name === createdMachine.name) ||
          (createdMachine?.code && m.code === createdMachine.code)
      );
      if (matched) {
        setAssignForm((f) => ({ ...f, machine_id: String(matched.id) }));
      }
    }
  };

  useEffect(() => {
    if (stage !== "production_manager") return;
    Promise.all([
      loadOperators(),
      loadMachines(),
    ]).catch(() => {});
  }, [stage, loadOperators, loadMachines]);

  const inventorySnapshot = useMemo(() => {
    const lines = stage === "store" ? issueLines : materialLines;
    if (!Array.isArray(lines) || !lines.length) return null;
    const required = lines.reduce((s, ln) => s + Number(ln.required_qty || 0), 0);
    const available = lines.reduce((s, ln) => s + Number(ln.available_qty || 0), 0);
    const reserved = lines.reduce((s, ln) => s + Number(ln.reserved_qty || 0), 0);
    const shortage = lines.reduce((s, ln) => s + Number(ln.shortage_qty || 0), 0);
    const warehouse = lines.find((ln) => ln.stock_location || ln.store_location);
    return {
      required,
      available,
      reserved,
      shortage,
      warehouse: warehouse?.stock_location || warehouse?.store_location || "—",
    };
  }, [stage, materialLines, issueLines]);

  const stockSnapshot = inventorySnapshot ? (
    <div className="grid grid-cols-2 gap-2 border-b border-[var(--color-border-muted)] px-4 py-3 text-xs sm:grid-cols-5">
      {[
        ["Required", inventorySnapshot.required],
        ["Available", inventorySnapshot.available],
        ["Reserved", inventorySnapshot.reserved],
        ["Shortage", inventorySnapshot.shortage],
        ["Warehouse", inventorySnapshot.warehouse],
      ].map(([label, value]) => (
        <div key={label}>
          <p className="text-[var(--color-text-faint)]">{label}</p>
          <p className={`font-semibold tabular-nums ${label === "Shortage" && Number(value) > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"}`}>
            {typeof value === "number" ? value.toLocaleString("en-IN") : value}
          </p>
        </div>
      ))}
    </div>
  ) : null;

  const woId = card?.production_plan?.work_order_id || card?.execution?.work_order_id;
  const inspectionId = card?.inspection_id;

  const saveOperatorProgress = async () => {
    if (!woId) return;
    setSubmitting(true);
    try {
      await updateProductionProgress(woId, {
        produced_qty: productionForm.produced_qty ? Number(productionForm.produced_qty) : undefined,
        rejected_qty: productionForm.rejected_qty ? Number(productionForm.rejected_qty) : undefined,
        rework_qty: productionForm.rework_qty ? Number(productionForm.rework_qty) : undefined,
        notes: productionForm.notes,
        actual_start_time: productionForm.actual_start_time || undefined,
        actual_end_time: productionForm.actual_end_time || undefined,
      });
      addToast("Production progress saved", "success");
      await load();
    } catch (err) {
      addToast(err?.response?.data?.detail || "Could not save progress", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (action) => {
    setSubmitting(true);
    try {
      if (stage === "inventory_check") {
        if (action === "confirm_inventory") {
          await submitMaterialCheck(orderId, {
            lines: materialLines.map((ln) => ({
              id: ln.id,
              available_qty: ln.available_qty,
              stock_location: ln.stock_location,
            })),
          });
          addToast("Inventory check submitted. Advanced to Stage 3: Store Issue.", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/store`);
          return;
        } else if (action === "recheck_inventory") {
          const res = await submitMaterialCheck(orderId, {});
          const result = res?.data ?? res;
          if (result?.workflow_status === "STORE_ISSUE_PENDING") {
            addToast("All materials are available. Advanced to Store Issue.", "success");
            navigate(`/manufacturing/workflow/order/${orderId}/store`);
            return;
          }
          addToast(
            result?.workflow_status === "MATERIAL_PARTIAL"
              ? "Stock rechecked. Some materials are still short."
              : "Stock rechecked. Materials are still unavailable.",
            "info"
          );
        } else if (action === "hold_order") {
          await holdWorkflowOrder(orderId, { reason: "On hold by store" });
          addToast("Order placed on hold by Store Manager", "success");
        } else if (action === "raise_material_request") {
          await raiseMaterialRequest(orderId, {});
          addToast("Material request raised for shortage items", "success");
        }
      } else if (stage === "store") {
        if (action === "issue_materials") {
          await submitStoreIssue(orderId, {
            lines: issueLines.map((ln) => ({ id: ln.id, issued_qty: ln.issued_qty, store_location: ln.store_location })),
            send_to_production: false,
          });
          addToast("Issued quantities saved. Store issue is still in progress.", "success");
          await load();
        } else if (action === "send_to_production") {
          await submitStoreIssue(orderId, {
            lines: issueLines.map((ln) => ({ id: ln.id, issued_qty: ln.required_qty, store_location: ln.store_location })),
            send_to_production: true,
          });
          addToast("All required materials issued. Advanced to Production Manager.", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/production`);
          return;
        } else if (action === "hold") {
          await holdWorkflowOrder(orderId, { reason: "Store hold" });
          addToast("Order placed on hold by Store Manager", "success");
        }
      } else if (stage === "production_manager" && woId) {
        if (action === "assign_operator" || action === "send_to_operator") {
          await assignOperator(woId, {
            operator_user_id: Number(assignForm.operator_user_id),
            machine_id: assignForm.machine_id ? Number(assignForm.machine_id) : undefined,
            planned_quantity: assignForm.planned_quantity ? Number(assignForm.planned_quantity) : undefined,
          });
          addToast("Machine & Operator allocated. Advanced to Stage 5: Shop Floor Execution.", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/operator`);
        } else if (action === "hold") {
          await holdWorkflowOrder(orderId, { reason: "Production hold" });
          addToast("Order placed on hold by Production Manager", "success");
        }
      } else if (stage === "operator" && woId) {
        if (action === "start_work") {
          await startProduction(woId);
          addToast("Production started on machine", "success");
        } else if (action === "pause") {
          await pauseProduction(woId);
          addToast("Production paused", "success");
        } else if (action === "resume") {
          await resumeProduction(woId);
          addToast("Production resumed", "success");
        } else if (action === "complete_production") {
          await completeProduction(woId, {
            produced_qty: productionForm.produced_qty ? Number(productionForm.produced_qty) : undefined,
            rejected_qty: productionForm.rejected_qty ? Number(productionForm.rejected_qty) : undefined,
            rework_qty: productionForm.rework_qty ? Number(productionForm.rework_qty) : undefined,
            notes: productionForm.notes,
          });
          addToast("Production completed (Output recorded). Advanced to Stage 6: Quality Inspection (QA).", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/quality`);
        }
      } else if (stage === "quality" && inspectionId) {
        const resultMap = { approve: "pass", reject: "fail", hold: "hold", send_back_to_production: "fail" };
        await submitQualityCheck(inspectionId, {
          result: resultMap[action] || qualityForm.result,
          notes: qualityForm.notes,
          defects: qualityForm.defects,
        });
        if (action === "approve") {
          addToast("Quality Approved! Inspection stamp issued & advanced to Stage 7: Packing & Dispatch.", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/packing`);
        } else {
          addToast("Quality check record updated", "success");
        }
      } else if (stage === "packing") {
        if (action === "start_packing") {
          await completePacking(orderId, { ...packingForm, packing_status: "in_progress" });
          addToast("Packing started", "success");
        } else if (action === "complete_packing" || action === "dispatch") {
          await completePacking(orderId, {
            ...packingForm,
            packing_status: action === "dispatch" ? "dispatched" : "packed",
          });
          addToast("Packing confirmed & FG stock updated. Advanced to Stage 8: Finance & Billing.", "success");
          navigate(`/manufacturing/workflow/order/${orderId}/billing`);
        } else if (action === "hold") {
          await holdWorkflowOrder(orderId, { reason: "Packing hold" });
          addToast("Order placed on hold by Packing team", "success");
        }
      } else if (stage === "billing") {
        if (action === "create_invoice" || action === "confirm_billing") {
          await createBillingInvoice(orderId, { remarks: packingForm.remarks });
          addToast("GST Tax Invoice generated & Job Card completed successfully!", "success");
          navigate("/my-job-cards?dept=billing");
          return;
        }
      }
      await load();
    } catch (err) {
      addToast(err?.response?.data?.detail || "Action failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const inventoryColumns = useMemo(
    () => [
      { key: "material_code", label: "Code" },
      { key: "material_name", label: "Material" },
      { key: "required_qty", label: "Required" },
      { key: "available_qty", label: "Available", editable: card?.editable, type: "number" },
      { key: "reserved_qty", label: "Reserved" },
      { key: "shortage_qty", label: "Shortage" },
      { key: "unit", label: "Unit" },
      { key: "stock_location", label: "Location", editable: card?.editable },
      { key: "availability_status", label: "Status" },
    ],
    [card?.editable]
  );

  const issueColumns = useMemo(
    () => [
      { key: "material_code", label: "Code" },
      { key: "material_name", label: "Material" },
      { key: "required_qty", label: "Required" },
      { key: "available_qty", label: "Available" },
      { key: "issued_qty", label: "Total Issued", editable: card?.editable, type: "number", showZero: true },
      { key: "remaining_qty", label: "Remaining" },
      { key: "store_location", label: "Store", editable: card?.editable },
      { key: "issue_status", label: "Status" },
    ],
    [card?.editable]
  );

  const stageBody = () => {
    if (stage === "inventory_check") {
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Required Materials" />
          {stockSnapshot}
          <MaterialTable
            columns={inventoryColumns}
            rows={materialLines}
            editable={card?.editable}
            onChange={(id, key, val) =>
              setMaterialLines((rows) =>
                rows.map((r) => {
                  if (r.id !== id) return r;
                  const updated = { ...r, [key]: val };
                  if (key === "available_qty") {
                    const req = Number(updated.required_qty || 0);
                    const avail = Number(val || 0);
                    const res = Number(updated.reserved_qty || 0);
                    const net = Math.max(0, avail - res);
                    updated.shortage_qty = Math.max(0, req - net);
                    updated.availability_status = (net >= req && req > 0) ? "Available" : (net > 0 ? "Partial" : "Not Available");
                  }
                  return updated;
                })
              )
            }
          />
          {card?.stock_status ? (
            <p className="border-t border-[var(--color-border-muted)] px-4 py-2 text-sm">
              Stock status: <strong>{card.stock_status}</strong>
            </p>
          ) : null}
          <JobCardActions
            actions={card?.allowed_actions}
            loading={submitting}
            onAction={runAction}
            labels={{
              confirm_inventory: "Confirm Materials",
              recheck_inventory: "Recheck Stock",
              raise_material_request: "Record Shortage",
            }}
          />
        </article>
      );
    }
    if (stage === "store") {
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Material Issue" />
          <p className="border-b border-[var(--color-border-muted)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            Enter the total quantity issued for each material. Saving deducts only any increase from stock. If materials remain, save the issue and return later. “Issue All &amp; Send to Production” issues all remaining quantities and advances the job card.
          </p>
          {stockSnapshot}
          <MaterialTable
            columns={issueColumns}
            rows={issueLines}
            editable={card?.editable}
            onChange={(id, key, val) =>
              setIssueLines((rows) =>
                rows.map((r) => {
                  if (r.id !== id) return r;
                  const updated = { ...r, [key]: val };
                  if (key === "issued_qty") {
                    const req = Number(updated.required_qty || 0);
                    const iss = Number(val || 0);
                    updated.remaining_qty = Math.max(0, req - iss);
                    updated.issue_status = iss >= req ? "issued" : (iss > 0 ? "partial" : "pending");
                  }
                  return updated;
                })
              )
            }
          />
          <JobCardActions
            actions={(card?.allowed_actions || []).filter((action) => action !== "partial_issue")}
            loading={submitting}
            onAction={runAction}
            labels={{
              issue_materials: "Save Issue Quantities",
              send_to_production: "Issue All & Send to Production",
            }}
          />
        </article>
      );
    }
    if (stage === "production_manager") {
      const plan = card?.production_plan || {};
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Production Planning" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <FormField label="Work Order">
              <Input value={plan.work_order_number || "—"} readOnly />
            </FormField>
            <FormField label="Planned Qty">
              <Input
                type="number"
                value={assignForm.planned_quantity}
                onChange={(e) => setAssignForm((f) => ({ ...f, planned_quantity: e.target.value }))}
                disabled={!card?.editable}
              />
            </FormField>
            <FormField label="Assign Operator">
              <Select
                value={assignForm.operator_user_id}
                onChange={(e) => {
                  if (e.target.value === "__add_operator__") {
                    setShowAddOperatorModal(true);
                    return;
                  }
                  setAssignForm((f) => ({ ...f, operator_user_id: e.target.value }));
                }}
                disabled={!card?.editable}
              >
                <option value="">Select operator</option>
                {isAdmin ? (
                  <option value="__add_operator__">+ Add Operator</option>
                ) : null}
                {operators.map((op) => {
                  const displayName = op.full_name || op.name || op.username || op.email || `Operator #${op.id}`;
                  const roleLabel = op.role || op.role_name || op.designation ? ` (${op.role || op.role_name || op.designation})` : "";
                  return (
                    <option key={op.id} value={op.id}>
                      {displayName}{roleLabel}
                    </option>
                  );
                })}
              </Select>
            </FormField>
            <FormField label="Machine">
              <Select
                value={assignForm.machine_id}
                onChange={(e) => {
                  if (e.target.value === "__add_machine__") {
                    setShowAddMachineModal(true);
                    return;
                  }
                  setAssignForm((f) => ({ ...f, machine_id: e.target.value }));
                }}
                disabled={!card?.editable}
              >
                <option value="">Select Machine...</option>
                {isAdmin ? (
                  <option value="__add_machine__">+ Add new Machine</option>
                ) : null}
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.machine_name || m.code || m.id}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <JobCardActions actions={card?.allowed_actions} loading={submitting} onAction={runAction} />
        </article>
      );
    }
    if (stage === "operator") {
      return (
        <OperatorJobCardBody
          card={card}
          form={productionForm}
          onChange={(key, value) => setProductionForm((f) => ({ ...f, [key]: value }))}
          submitting={submitting}
          onAction={runAction}
          onSaveProgress={saveOperatorProgress}
        />
      );
    }
    if (stage === "quality") {
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Quality Inspection" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <FormField label="Result">
              <Select
                value={qualityForm.result}
                onChange={(e) => setQualityForm((f) => ({ ...f, result: e.target.value }))}
                disabled={!card?.editable}
              >
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="hold">Hold</option>
              </Select>
            </FormField>
            <FormField label="Remarks" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={qualityForm.notes}
                onChange={(e) => setQualityForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={!card?.editable}
              />
            </FormField>
          </div>
          <JobCardActions actions={card?.allowed_actions} loading={submitting} onAction={runAction} />
        </article>
      );
    }
    if (stage === "packing") {
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Packing & Dispatch" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <FormField label="Packed Qty">
              <Input
                type="number"
                value={packingForm.packed_quantity}
                onChange={(e) => setPackingForm((f) => ({ ...f, packed_quantity: e.target.value }))}
                disabled={!card?.editable}
              />
            </FormField>
            <FormField label="Transporter">
              <Input
                value={packingForm.courier}
                onChange={(e) => setPackingForm((f) => ({ ...f, courier: e.target.value }))}
                disabled={!card?.editable}
              />
            </FormField>
            <FormField label="LR / AWB No.">
              <Input
                value={packingForm.lr_number}
                onChange={(e) => setPackingForm((f) => ({ ...f, lr_number: e.target.value }))}
                disabled={!card?.editable}
              />
            </FormField>
          </div>
          <JobCardActions actions={card?.allowed_actions} loading={submitting} onAction={runAction} />
        </article>
      );
    }
    if (stage === "billing") {
      const bill = card?.billing || {};
      return (
        <article className="ui-card overflow-hidden">
          <CardSectionHeader title="Billing Information" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <FormField label="Invoice No.">
              <Input value={bill.invoice_no || "—"} readOnly />
            </FormField>
            <FormField label="Total Amount">
              <Input value={bill.total_amount != null ? `₹ ${bill.total_amount}` : "—"} readOnly className="ui-num" />
            </FormField>
          </div>
          <JobCardActions actions={card?.allowed_actions} loading={submitting} onAction={runAction} />
        </article>
      );
    }

    if (stage === "completed" || card?.workflow_status === "completed") {
      return (
        <CompletedJobCardAllStagesReport
          card={card}
          form={detailsForm}
          salesOrder={salesOrder}
          orderId={orderId}
        />
      );
    }
    return null;
  };

  if (loading || (detailsLoading && !card)) {
    return (
      <div className="ui-page flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-[var(--color-text-muted)]">Loading job card…</p>
      </div>
    );
  }

  if (permissionDenied) {
    return (
      <div className="ui-page">
        <PermissionDeniedState
          title="Permission denied"
          description={`Your role does not have access to the ${STAGE_TITLES[stage] || stage} stage for this job card.`}
          onBack={() => navigate("/my-job-cards?dept=inventory")}
          backLabel="Back to My Job Cards"
        />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="ui-page ui-stack">
        <p className="text-sm text-[var(--color-danger)]">Job card not found.</p>
        <Button variant="outline" to="/my-job-cards">
          Back to My Job Cards
        </Button>
      </div>
    );
  }

  const displayForm = detailsForm || formFromStageCard(card);
  const selectedProduct = products.find((p) => String(p.id) === String(displayForm?.product_id));
  const productCode = selectedProduct?.product_code || selectedProduct?.sku || displayForm?.product_code || "";

  const stageActions = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StageNavLinks
          orderId={orderId}
          currentStage={stage === "inventory_check" ? "inventory" : routeStage}
        />
        <Button variant="outline" size="sm" onClick={() => load()} loading={loading}>
          Refresh
        </Button>
      </div>
      {stageBody()}
    </div>
  );

  return (
    <>
      <JobCardDetailsShell
        orderId={orderId}
        card={detailsCard || card}
        form={displayForm}
        salesOrder={salesOrder}
        productLines={productLines}
        customers={customers}
        products={products}
        salesPeople={salesPeople}
        errors={errors}
        mode="view"
        readOnly
        linesReadOnly
        selectedProduct={selectedProduct}
        productCode={productCode}
        onPatchField={() => {}}
        onAddLine={() => {}}
        onRemoveLine={() => {}}
        onUpdateLine={() => {}}
        isCreated
        canEditSales={false}
        backTo="/my-job-cards"
        stageTitle={STAGE_TITLES[stage]}
        stageActions={stageActions}
        showWorkflowTracker={true}
        productionDetailsEditable={stage === "store" && editableSections.length > 0}
        onSaveProductionDetails={handleSaveDetailsOnly}
        savingProductionDetails={savingDetails}
        details={details}
        machines={detailMachines}
        operators={detailOperators}
        editableSections={editableSections}
        onPatchDetailsSection={patchDetailsSection}
        onPatchRawMaterial={patchRawMaterial}
        onAddRawMaterial={addRawMaterial}
        onRemoveRawMaterial={removeRawMaterial}
      />
      {isAdmin && (
        <>
          <AddUserModal
            open={showAddOperatorModal}
            onClose={() => setShowAddOperatorModal(false)}
            onSuccess={handleOperatorCreated}
            defaultRole="Operator"
            defaultDept="Production"
            defaultDesignation="Operator"
            title="Add Operator"
            subtitle="Create a new operator user and assign to production."
          />
          <CreateMachineModal
            open={showAddMachineModal}
            onClose={() => setShowAddMachineModal(false)}
            onSaved={handleMachineCreated}
            placement="modal"
          />
        </>
      )}
    </>
  );
}
