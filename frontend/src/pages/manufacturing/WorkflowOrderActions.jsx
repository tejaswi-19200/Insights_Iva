import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";

import Button from "../../components/common/Button";
import Loader from "../../components/common/Loader";
import AddUserModal from "../../components/admin/AddUserModal";
import CreateMachineModal from "../../components/production/CreateMachineModal";
import { useToast } from "../../context/ToastContext";
import useAuth from "../../hooks/useAuth";
import usePermissions from "../../hooks/usePermissions";
import { getTeamDirectory, getUsers } from "../../api/adminApi";
import { getMachines } from "../../api/productionApi";
import { confirmSalesOrder } from "../../api/salesApi";
import {
  assignOperator,
  completePacking,
  completeProduction,
  createBillingInvoice,
  getMaterialCheck,
  getWorkflowContext,
  startProduction,
  submitMaterialCheck,
  submitQualityCheck,
} from "../../api/workflowApi";
import { getUserWorkflowTeams, userHasWorkflowTeam } from "../../config/manufacturingWorkflow";

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "ui-input";

export default function WorkflowOrderActions({ orderId, onSuccess }) {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const teams = useMemo(() => getUserWorkflowTeams(user), [user]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [operators, setOperators] = useState([]);
  const [machines, setMachines] = useState([]);

  const [materialNotes, setMaterialNotes] = useState("");
  const [materialLines, setMaterialLines] = useState([]);

  const [showAddOperatorModal, setShowAddOperatorModal] = useState(false);
  const [showAddMachineModal, setShowAddMachineModal] = useState(false);
  const [assignForm, setAssignForm] = useState({
    operator_user_id: "",
    machine_id: "",
    planned_quantity: "",
  });
  const [producedQty, setProducedQty] = useState("");
  const [productionNotes, setProductionNotes] = useState("");
  const [qualityForm, setQualityForm] = useState({ result: "pass", notes: "", defects: "" });
  const [packingForm, setPackingForm] = useState({
    packing_status: "packed",
    packed_quantity: "",
    package_count: "",
    courier: "",
    lr_number: "",
    remarks: "",
  });
  const [billingRemarks, setBillingRemarks] = useState("");

  const loadOperators = useCallback(async () => {
    try {
      const rawUsers = await getTeamDirectory()
        .then((r) => r?.data ?? r ?? [])
        .catch(() => getUsers().then((r) => r?.data ?? r ?? []))
        .catch(() => []);
      const rows = Array.isArray(rawUsers) ? rawUsers : [];
      const ops = rows.filter((u) => {
        const roleStr = String(u.role || u.role_name || u.designation || u.department || "").toLowerCase();
        if (roleStr.includes("operator") || roleStr.includes("machinist") || roleStr.includes("technician")) return true;
        return (u.roles || []).some((role) => {
          const name = String(typeof role === "string" ? role : role?.name || "").toLowerCase();
          return name.includes("operator") || name.includes("machinist") || name.includes("technician");
        });
      });
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

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await getWorkflowContext(orderId);
      const data = res?.data ?? res;
      setCtx(data);
      if (data?.material_check?.lines) {
        setMaterialLines(
          data.material_check.lines.map((ln) => ({
            id: ln.id,
            material_name: ln.material_name,
            required_qty: ln.required_qty,
            available_qty: ln.available_qty,
            stock_location: ln.stock_location || "",
          }))
        );
      } else {
        const mcRes = await getMaterialCheck(orderId).catch(() => null);
        const mcData = mcRes?.data ?? mcRes;
        if (mcData?.lines) {
          setMaterialLines(
            mcData.lines.map((ln) => ({
              id: ln.id,
              material_name: ln.material_name,
              required_qty: ln.required_qty,
              available_qty: ln.available_qty,
              stock_location: ln.stock_location || "",
            }))
          );
        }
      }
      if (data?.quantity) {
        setAssignForm((f) => ({ ...f, planned_quantity: String(data.quantity) }));
        setProducedQty(String(data.quantity));
        setPackingForm((f) => ({ ...f, packed_quantity: String(data.quantity) }));
      }
    } catch (err) {
      addToast(err?.response?.data?.detail || "Could not load workflow context", "error");
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!teams.includes("production") && !teams.includes("admin")) return;
    Promise.all([
      loadOperators(),
      loadMachines(),
    ]).catch(() => {});
  }, [teams, loadOperators, loadMachines]);

  const ws = (ctx?.workflow_status || "").toUpperCase();
  const primaryWo = ctx?.work_orders?.[0];
  const pendingQc = ctx?.quality_inspections?.find((q) => (q.status || "").toLowerCase() === "pending");

  const runAction = async (fn, successMsg) => {
    setSubmitting(true);
    try {
      await fn();
      addToast(successMsg, "success");
      await load();
      onSuccess?.();
    } catch (err) {
      addToast(err?.response?.data?.detail || "Action failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loader label="Loading actions..." />;
  if (!ctx) return null;

  return (
    <div className="ui-card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Team actions</h3>
          <p className="text-xs text-slate-500">
            {ctx.order_number} · {ctx.workflow_status?.replace(/_/g, " ") || "—"} · Priority:{" "}
            {ctx.priority}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
          Teams: {teams.join(", ") || "—"}
        </span>
      </div>

      {/* Sales — confirm draft order */}
      {(!ws || ws === "DRAFT" || (ctx.order_status || "").toLowerCase() === "draft") &&
      userHasWorkflowTeam(user, "sales") ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Sales — Confirm order</h4>
          <Button
            variant="primary"
            loading={submitting}
            onClick={() =>
              runAction(() => confirmSalesOrder(orderId), "Sales order confirmed — sent to Inventory")
            }
          >
            Confirm sales order
          </Button>
        </section>
      ) : null}

      {/* Inventory — material check */}
      {ws === "MATERIAL_CHECK_PENDING" && userHasWorkflowTeam(user, "inventory") ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Inventory — Material verification
          </h4>
          {materialLines.length ? (
            <div className="mb-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="ui-table-head">
                  <tr>
                    <th className="px-2 py-1">Material</th>
                    <th className="px-2 py-1">Required</th>
                    <th className="px-2 py-1">Available</th>
                    <th className="px-2 py-1">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {materialLines.map((ln, idx) => (
                    <tr key={ln.id || idx} className="border-b border-slate-100">
                      <td className="px-2 py-1.5">{ln.material_name}</td>
                      <td className="px-2 py-1.5">{ln.required_qty}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          className={inputCls}
                          value={ln.available_qty}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMaterialLines((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, available_qty: val } : r))
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className={inputCls}
                          value={ln.stock_location}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMaterialLines((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, stock_location: val } : r))
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mb-3 text-xs text-slate-500">No BOM lines — verify order has products with BOM.</p>
          )}
          <Field label="Notes">
            <textarea
              className={inputCls}
              rows={2}
              value={materialNotes}
              onChange={(e) => setMaterialNotes(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            className="mt-3"
            loading={submitting}
            onClick={() =>
              runAction(
                () =>
                  submitMaterialCheck(orderId, {
                    notes: materialNotes || null,
                    lines: materialLines.map((ln) => ({
                      id: ln.id,
                      available_qty: parseFloat(ln.available_qty) || 0,
                      stock_location: ln.stock_location || null,
                    })),
                  }),
                "Material check submitted"
              )
            }
          >
            Submit material check
          </Button>
        </section>
      ) : null}

      {/* Production Manager — assign operator */}
      {["READY_FOR_PRODUCTION", "PRODUCTION_REWORK"].includes(ws) &&
      userHasWorkflowTeam(user, "production") &&
      primaryWo ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Production — Assign operator · {primaryWo.work_order_number}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Operator">
              <select
                className={inputCls}
                value={assignForm.operator_user_id}
                onChange={(e) => {
                  if (e.target.value === "__add_operator__") {
                    setShowAddOperatorModal(true);
                    return;
                  }
                  setAssignForm((f) => ({ ...f, operator_user_id: e.target.value }));
                }}
              >
                <option value="">Select operator</option>
                {isAdmin ? (
                  <option value="__add_operator__">+ Add Operator</option>
                ) : null}
                {operators.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.full_name || op.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Machine">
              <select
                className={inputCls}
                value={assignForm.machine_id}
                onChange={(e) => {
                  if (e.target.value === "__add_machine__") {
                    setShowAddMachineModal(true);
                    return;
                  }
                  setAssignForm((f) => ({ ...f, machine_id: e.target.value }));
                }}
              >
                <option value="">Select Machine</option>
                {isAdmin ? (
                  <option value="__add_machine__">+ Add new Machine</option>
                ) : null}
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.machine_name || m.code || m.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Production quantity">
              <input
                type="number"
                className={inputCls}
                value={assignForm.planned_quantity}
                onChange={(e) => setAssignForm((f) => ({ ...f, planned_quantity: e.target.value }))}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            className="mt-3"
            loading={submitting}
            disabled={!assignForm.operator_user_id}
            onClick={() =>
              runAction(
                () =>
                  assignOperator(primaryWo.id, {
                    operator_user_id: Number(assignForm.operator_user_id),
                    machine_id: assignForm.machine_id ? Number(assignForm.machine_id) : null,
                    planned_quantity: assignForm.planned_quantity
                      ? parseFloat(assignForm.planned_quantity)
                      : null,
                  }),
                "Operator assigned"
              )
            }
          >
            Assign operator
          </Button>
        </section>
      ) : null}

      {/* Operator — start / complete production */}
      {ws === "PRODUCTION_ASSIGNED" && userHasWorkflowTeam(user, "operator") && primaryWo ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Operator — Start production · {primaryWo.work_order_number}
          </h4>
          <Button
            variant="primary"
            loading={submitting}
            onClick={() => runAction(() => startProduction(primaryWo.id), "Production started")}
          >
            Start production
          </Button>
        </section>
      ) : null}

      {ws === "PRODUCTION_IN_PROGRESS" && userHasWorkflowTeam(user, "operator") && primaryWo ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Operator — Complete production · {primaryWo.work_order_number}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Produced quantity">
              <input
                type="number"
                className={inputCls}
                value={producedQty}
                onChange={(e) => setProducedQty(e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <input
                className={inputCls}
                value={productionNotes}
                onChange={(e) => setProductionNotes(e.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            className="mt-3"
            loading={submitting}
            onClick={() =>
              runAction(
                () =>
                  completeProduction(primaryWo.id, {
                    produced_qty: producedQty ? parseFloat(producedQty) : null,
                    notes: productionNotes || null,
                  }),
                "Production completed — sent to Quality"
              )
            }
          >
            Complete production
          </Button>
        </section>
      ) : null}

      {/* Quality */}
      {ws === "QUALITY_CHECK_PENDING" && userHasWorkflowTeam(user, "quality") && pendingQc ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Quality — Final inspection · {pendingQc.inspection_number}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Result">
              <select
                className={inputCls}
                value={qualityForm.result}
                onChange={(e) => setQualityForm((f) => ({ ...f, result: e.target.value }))}
              >
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="partial">Partial</option>
              </select>
            </Field>
            <Field label="Defects">
              <input
                className={inputCls}
                value={qualityForm.defects}
                onChange={(e) => setQualityForm((f) => ({ ...f, defects: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Inspection notes">
            <textarea
              className={`${inputCls} mt-3`}
              rows={2}
              value={qualityForm.notes}
              onChange={(e) => setQualityForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <Button
            variant="primary"
            className="mt-3"
            loading={submitting}
            onClick={() =>
              runAction(
                () =>
                  submitQualityCheck(pendingQc.id, {
                    result: qualityForm.result,
                    notes: qualityForm.notes || null,
                    defects: qualityForm.defects || null,
                  }),
                "Quality check submitted"
              )
            }
          >
            Submit quality result
          </Button>
        </section>
      ) : null}

      {/* Packing & Dispatch */}
      {["QUALITY_APPROVED", "PACKING_PENDING", "PACKING_IN_PROGRESS", "PACKING_ISSUE"].includes(ws) &&
      userHasWorkflowTeam(user, "packing") ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            Packing & Dispatch
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Packing status">
              <select
                className={inputCls}
                value={packingForm.packing_status}
                onChange={(e) => setPackingForm((f) => ({ ...f, packing_status: e.target.value }))}
              >
                <option value="in_progress">In progress</option>
                <option value="packed">Packed</option>
                <option value="dispatched">Dispatched</option>
              </select>
            </Field>
            <Field label="Packed quantity">
              <input
                type="number"
                className={inputCls}
                value={packingForm.packed_quantity}
                onChange={(e) => setPackingForm((f) => ({ ...f, packed_quantity: e.target.value }))}
              />
            </Field>
            <Field label="Package count">
              <input
                type="number"
                className={inputCls}
                value={packingForm.package_count}
                onChange={(e) => setPackingForm((f) => ({ ...f, package_count: e.target.value }))}
              />
            </Field>
            <Field label="Courier / transport">
              <input
                className={inputCls}
                value={packingForm.courier}
                onChange={(e) => setPackingForm((f) => ({ ...f, courier: e.target.value }))}
              />
            </Field>
            <Field label="LR / Tracking number">
              <input
                className={inputCls}
                value={packingForm.lr_number}
                onChange={(e) => setPackingForm((f) => ({ ...f, lr_number: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Remarks">
            <textarea
              className={`${inputCls} mt-3`}
              rows={2}
              value={packingForm.remarks}
              onChange={(e) => setPackingForm((f) => ({ ...f, remarks: e.target.value }))}
            />
          </Field>
          <Button
            variant="primary"
            className="mt-3"
            loading={submitting}
            onClick={() =>
              runAction(
                () =>
                  completePacking(orderId, {
                    packing_status: packingForm.packing_status,
                    packed_quantity: packingForm.packed_quantity
                      ? parseFloat(packingForm.packed_quantity)
                      : null,
                    package_count: packingForm.package_count
                      ? parseInt(packingForm.package_count, 10)
                      : null,
                    courier: packingForm.courier || null,
                    lr_number: packingForm.lr_number || null,
                    remarks: packingForm.remarks || null,
                  }),
                "Packing updated"
              )
            }
          >
            Update packing / dispatch
          </Button>
        </section>
      ) : null}

      {/* Billing */}
      {["BILLING_PENDING", "BILLING_HOLD", "PACKED"].includes(ws) &&
      userHasWorkflowTeam(user, "billing") ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Billing — Create invoice</h4>
          {ctx.invoice ? (
            <p className="text-sm text-emerald-700">
              Invoice {ctx.invoice.invoice_number} already created (₹
              {ctx.invoice.grand_total?.toLocaleString?.() ?? ctx.invoice.grand_total})
            </p>
          ) : (
            <>
              <Field label="Billing remarks">
                <textarea
                  className={inputCls}
                  rows={2}
                  value={billingRemarks}
                  onChange={(e) => setBillingRemarks(e.target.value)}
                />
              </Field>
              <Button
                variant="primary"
                className="mt-3"
                loading={submitting}
                onClick={() =>
                  runAction(
                    () => createBillingInvoice(orderId, { remarks: billingRemarks || null }),
                    "Invoice created — workflow completed"
                  )
                }
              >
                Create GST invoice
              </Button>
            </>
          )}
        </section>
      ) : null}

      {ws === "COMPLETED" ? (
        <p className="text-sm font-medium text-emerald-700">This order has completed the manufacturing workflow.</p>
      ) : null}

      {ws &&
      ws !== "COMPLETED" &&
      !(
        ((!ws || ws === "DRAFT" || (ctx.order_status || "").toLowerCase() === "draft") &&
          userHasWorkflowTeam(user, "sales")) ||
        (ws === "MATERIAL_CHECK_PENDING" && userHasWorkflowTeam(user, "inventory")) ||
        (["READY_FOR_PRODUCTION", "PRODUCTION_REWORK"].includes(ws) &&
          userHasWorkflowTeam(user, "production") &&
          primaryWo) ||
        (ws === "PRODUCTION_ASSIGNED" && userHasWorkflowTeam(user, "operator") && primaryWo) ||
        (ws === "PRODUCTION_IN_PROGRESS" && userHasWorkflowTeam(user, "operator") && primaryWo) ||
        (ws === "QUALITY_CHECK_PENDING" && userHasWorkflowTeam(user, "quality") && pendingQc) ||
        (["QUALITY_APPROVED", "PACKING_PENDING", "PACKING_IN_PROGRESS", "PACKING_ISSUE"].includes(ws) &&
          userHasWorkflowTeam(user, "packing")) ||
        (["BILLING_PENDING", "BILLING_HOLD", "PACKED"].includes(ws) && userHasWorkflowTeam(user, "billing"))
      ) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">No action available for your team at this stage.</p>
          <p className="mt-1 text-xs">
            Current status: <strong>{ws.replace(/_/g, " ")}</strong>. Your teams: {teams.join(", ") || "—"}.
            {teams.includes("admin")
              ? " As admin you can perform any team action when the order reaches that stage."
              : " Wait for the previous team to complete their step, or sign in with the responsible role."}
          </p>
        </div>
      ) : null}
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
    </div>
  );
}
