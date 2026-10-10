import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Cpu, User as UserIcon, X } from "lucide-react";

import { SHIFTS } from "../../data/productionPlanningMasterData";
import { getMachines, getOperators, quickCreateWorkOrder } from "../../api/productionApi";
import { fetchFinishedGoodsWithFallback } from "../../utils/productOptions";
import { fetchCustomersWithFallback } from "../../utils/customerOptions";
import { apiErrorMessage } from "../../utils/apiError";
import AddNewItemModal from "../sales/AddNewItemModal";
import AddNewPartyModal from "../sales/AddNewPartyModal";
import CreateMachineModal from "./CreateMachineModal";
import AddUserModal from "../admin/AddUserModal";
import Button from "../common/Button";
import ShorthandQuantityInput from "../common/ShorthandQuantityInput";

function toDateTimeLocal(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length >= 16 && s[10] === "T") return s.slice(0, 16);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DateTimeField({ name, value, onChange, label }) {
  const inputRef = useRef(null);

  return (
    <label className="block space-y-1">
      <span className="ui-label">{label}</span>
      <span className="relative block">
        <input
          ref={inputRef}
          type="datetime-local"
          name={name}
          value={value}
          onChange={onChange}
          className="ui-input w-full !pr-10 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:w-0 [&::-webkit-calendar-picker-indicator]:pointer-events-none"
        />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.focus();
            inputRef.current?.showPicker?.();
          }}
          className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
          aria-label={`Open ${label.toLowerCase()} picker`}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </label>
  );
}

export default function QuickWorkOrderModal({ order, onClose, onSuccess, addToast }) {
  const [machines, setMachines] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [operators, setOperators] = useState([]);
  const [customCustomerMode, setCustomCustomerMode] = useState(false);
  const [customProductMode, setCustomProductMode] = useState(false);
  const [customOperatorMode, setCustomOperatorMode] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showAddMachineModal, setShowAddMachineModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [customMachineMode, setCustomMachineMode] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);

  const poNumber = order?.order_number || order?.id || "";
  const initialWoNumber = poNumber ? `WO-${poNumber}` : `WO-${Date.now().toString().slice(-6)}`;

  const [form, setForm] = useState({
    work_order_number: initialWoNumber,
    product_name: order?.product_name || "",
    product_id: order?.product_id ? String(order.product_id) : "",
    planned_quantity: order?.planned_quantity || 100,
    customer_id: order?.customer_id ? String(order.customer_id) : "",
    customer_name: order?.buyer_company || order?.customer_name || "",
    machine_id: order?.machine_id ? String(order.machine_id) : "",
    operator_name: order?.operator_name || "",
    shift: typeof order?.shift === "object" ? order?.shift?.id || "General" : order?.shift || "General",
    priority: order?.priority || "medium",
    start_date: toDateTimeLocal(order?.start_date),
    due_date: toDateTimeLocal(order?.due_date),
  });

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([
      getMachines().catch(() => ({ data: [] })),
      fetchFinishedGoodsWithFallback().catch(() => []),
      fetchCustomersWithFallback().catch(() => []),
      getOperators().catch(() => ({ data: [] })),
    ])
      .then(([mRes, pRes, cRes, opRes]) => {
        if (cancelled) return;
        setMachines(Array.isArray(mRes?.data) ? mRes.data : []);
        const prods = Array.isArray(pRes) ? pRes : [];
        setProducts(prods);
        const custs = Array.isArray(cRes) ? cRes : [];
        setCustomers(custs);
        const ops = Array.isArray(opRes?.data) ? opRes.data : Array.isArray(opRes) ? opRes : [];
        setOperators(ops);

        if (order?.product_id) {
          const selected = prods.find((p) => String(p.id) === String(order.product_id));
          setForm((prev) => ({
            ...prev,
            product_id: String(order.product_id),
            product_name: selected?.name || order.product_name || prev.product_name,
          }));
        }

        const prefilledCustomer = order?.buyer_company || order?.customer_name;
        if (prefilledCustomer) {
          const cName = String(prefilledCustomer).toLowerCase().trim();
          const matched = custs.find(
            (c) =>
              (c.name || c.company || "").toLowerCase().trim() === cName ||
              (order.customer_id && String(c.id) === String(order.customer_id))
          );
          if (matched) {
            setForm((prev) => ({
              ...prev,
              customer_id: String(matched.id),
              customer_name: matched.name || matched.company || prev.customer_name,
            }));
          } else {
            setCustomCustomerMode(true);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order?.product_id, order?.product_name, order?.customer_id, order?.customer_name, order?.buyer_company]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "product_id") {
      const selected = products.find((p) => String(p.id) === String(value));
      setForm((prev) => ({
        ...prev,
        product_id: value,
        product_name: selected?.name || selected?.sku || prev.product_name,
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCustomerChange = (e) => {
    const val = e.target.value;
    if (val === "__custom__" || val === "__add_customer__") {
      setShowAddCustomerModal(true);
      return;
    }
    const selected = customers.find((c) => String(c.id) === String(val));
    setForm((prev) => ({
      ...prev,
      customer_id: val,
      customer_name: selected?.name || selected?.company || "",
    }));
  };

  const handleProductChange = (e) => {
    const val = e.target.value;
    if (val === "__custom__" || val === "__add_product__") {
      setShowAddProductModal(true);
      return;
    }
    const selected = products.find((p) => String(p.id) === String(val));
    setForm((prev) => ({
      ...prev,
      product_id: val,
      product_name: selected?.name || selected?.sku || "",
    }));
  };

  const handleMachineChange = (e) => {
    const val = e.target.value;
    if (val === "__custom__" || val === "__add_machine__") {
      setShowAddMachineModal(true);
      return;
    }
    setForm((prev) => ({ ...prev, machine_id: val }));
  };


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!form.product_id) {
      addToast?.("Select a product to create the work order", "error");
      return;
    }
    setSaving(true);
    const woNum = form.work_order_number?.trim() || `WO-${Date.now().toString().slice(-6)}`;
    const shiftVal =
      typeof form.shift === "object" ? form.shift?.label || form.shift?.id || "General" : form.shift || "General";

    try {
      const res = await quickCreateWorkOrder({
        production_order_id: order?.id ? Number(order.id) : null,
        work_order_number: woNum,
        product_id: Number(form.product_id),
        planned_quantity: Number(form.planned_quantity || 0),
        customer_name: form.customer_name || null,
        machine_id: form.machine_id ? Number(form.machine_id) : null,
        shift: shiftVal,
        operator_name: form.operator_name || null,
        priority: form.priority || "medium",
        planned_start: form.start_date || null,
        planned_end: form.due_date || null,
      });
      const created = res?.data || {};
      addToast?.(`Work Order ${created.work_order_number || woNum} created successfully`, "success");
      onSuccess?.({
        id: created.id,
        work_order_number: created.work_order_number || woNum,
        status: created.status || "planned",
      });
      onClose?.();
    } catch (err) {
      addToast?.(apiErrorMessage(err, "Failed to create work order"), "error");
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-wo-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-action-teal)]/15 text-[var(--color-action-teal)]">
              <Cpu className="h-5 w-5" />
            </div>
            <h3 id="quick-wo-title" className="text-base font-bold text-[var(--color-text)]">
              New Work Order
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="ui-label">Work Order Number</span>
              <input
                name="work_order_number"
                value={form.work_order_number}
                onChange={handleChange}
                required
                className="ui-input"
              />
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Product</span>
              {order?.product_id ? (
                <input value={form.product_name} readOnly className="ui-input bg-[var(--color-surface-muted)]" />
              ) : customProductMode ? (
                <div className="flex gap-1.5">
                  <input
                    name="product_name"
                    value={form.product_name}
                    onChange={handleChange}
                    placeholder="Enter product name…"
                    className="ui-input flex-1"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomProductMode(false);
                      setForm((prev) => ({ ...prev, product_id: "", product_name: "" }));
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <select
                  name="product_id"
                  value={form.product_id}
                  onChange={handleProductChange}
                  required={!customProductMode}
                  disabled={loadingOptions}
                  className="ui-select"
                >
                  <option value="">{loadingOptions ? "Loading products" : "Select Product"}</option>
                  <option
                    value="__add_product__"
                    className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                    style={{ color: "#036f71", fontWeight: "600" }}
                  >
                    + Add new Product
                  </option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.sku}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="ui-label">Planned Quantity</span>
              <ShorthandQuantityInput
                value={form.planned_quantity}
                onChange={(val) => setForm((prev) => ({ ...prev, planned_quantity: val }))}
                placeholder="e.g. 500"
              />
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Machine</span>
              {customMachineMode ? (
                <div className="flex gap-1.5">
                  <input
                    name="machine_name"
                    value={form.machine_name || ""}
                    onChange={handleChange}
                    placeholder="Enter machine name"
                    className="ui-input flex-1"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMachineMode(false);
                      setForm((prev) => ({ ...prev, machine_id: "", machine_name: "" }));
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <select name="machine_id" value={form.machine_id} onChange={handleMachineChange} className="ui-select">
                  <option value="">Select Machine</option>
                  <option
                    value="__add_machine__"
                    className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                    style={{ color: "#036f71", fontWeight: "600" }}
                  >
                    + Add new Machine
                  </option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.code}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="ui-label">Customer</span>
              {order?.customer_name && order?.customer_id ? (
                <input value={form.customer_name} readOnly className="ui-input bg-[var(--color-surface-muted)]" />
              ) : customCustomerMode ? (
                <div className="flex gap-1.5">
                  <input
                    name="customer_name"
                    value={form.customer_name}
                    onChange={handleChange}
                    placeholder="Enter customer name"
                    className="ui-input flex-1"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomCustomerMode(false);
                      setForm((prev) => ({ ...prev, customer_id: "", customer_name: "" }));
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <select
                  name="customer_id"
                  value={form.customer_id}
                  onChange={handleCustomerChange}
                  disabled={loadingOptions}
                  className="ui-select"
                >
                  <option value="">{loadingOptions ? "Loading customers" : "Select Customer"}</option>
                  <option
                    value="__add_customer__"
                    className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                    style={{ color: "#036f71", fontWeight: "600" }}
                  >
                    + Add new Customer
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.company}{c.customer_code ? ` (${c.customer_code})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Operator</span>
              {customOperatorMode ? (
                <div className="flex gap-1.5">
                  <input
                    name="operator_name"
                    value={form.operator_name || ""}
                    onChange={handleChange}
                    placeholder="Enter operator name"
                    className="ui-input flex-1"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomOperatorMode(false);
                      setForm((prev) => ({ ...prev, operator_name: "" }));
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-[var(--color-text-icon)]" />
                  <select
                    name="operator_name"
                    value={form.operator_name || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setCustomOperatorMode(true);
                      } else if (val === "__add_operator__" || val === "__add_user__") {
                        setShowAddUserModal(true);
                      } else {
                        setForm((prev) => ({ ...prev, operator_name: val }));
                      }
                    }}
                    disabled={loadingOptions}
                    className="ui-select pl-10 w-full"
                  >
                    <option value="">Select Operator</option>
                    <option
                      value="__add_operator__"
                      className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                      style={{ color: "#036f71", fontWeight: "600" }}
                    >
                      + Add new User
                    </option>
                    {form.operator_name &&
                      !operators.some(
                        (op) => (op.full_name || op.name || op.email) === form.operator_name
                      ) && (
                        <option value={form.operator_name}>
                          {form.operator_name}
                        </option>
                      )}
                    {operators.map((op) => {
                      const opName = op.full_name || op.name || op.email || `User #${op.id}`;
                      const empId = op.employee_id || op.id;
                      return (
                        <option key={op.id} value={opName}>
                          {opName}{empId ? ` (${empId})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="ui-label">Shift</span>
              <select name="shift" value={form.shift} onChange={handleChange} className="ui-select">
                {SHIFTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Priority</span>
              <select name="priority" value={form.priority} onChange={handleChange} className="ui-select">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateTimeField name="start_date" value={form.start_date} onChange={handleChange} label="Start" />
            <DateTimeField name="due_date" value={form.due_date} onChange={handleChange} label="Due" />
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
            <Button variant="cancel" type="button" onClick={onClose}  disabled={saving}>
              Cancel
            </Button>
            <Button variant="success" type="submit" disabled={saving || loadingOptions}>
              {saving ? "Creating…" : "Create Work Order"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modal, document.body)}
      <AddNewItemModal
        open={showAddProductModal}
        placement="drawer"
        onClose={() => setShowAddProductModal(false)}
        onSaved={async (line, product) => {
          setShowAddProductModal(false);
          try {
            const refreshed = await fetchFinishedGoodsWithFallback();
            setProducts(Array.isArray(refreshed) ? refreshed : []);
            const newId = String(product?.id || line?.product_id || "");
            if (newId) {
              setForm((prev) => ({
                ...prev,
                product_id: newId,
                product_name: product?.name || line?.item_description || prev.product_name,
              }));
            }
          } catch {
            // fallback
          }
        }}
      />
      <CreateMachineModal
        open={showAddMachineModal}
        placement="drawer"
        onClose={() => setShowAddMachineModal(false)}
        onSaved={async (createdMachine) => {
          setShowAddMachineModal(false);
          try {
            const mRes = await getMachines().catch(() => ({ data: [] }));
            const refreshed = Array.isArray(mRes?.data) ? mRes.data : Array.isArray(mRes) ? mRes : [];
            const list = refreshed.length > 0 ? refreshed : (createdMachine ? [createdMachine] : []);
            setMachines(list);
            const mId = String(createdMachine?.id || list[0]?.id || "");
            if (mId) {
              setForm((prev) => ({ ...prev, machine_id: mId }));
            }
          } catch {
            // fallback
          }
        }}
      />
      <AddNewPartyModal
        open={showAddCustomerModal}
        placement="drawer"
        onClose={() => setShowAddCustomerModal(false)}
        onSaved={async (createdCust) => {
          setShowAddCustomerModal(false);
          try {
            const refreshed = await fetchCustomersWithFallback();
            setCustomers(Array.isArray(refreshed) ? refreshed : []);
            const newId = String(createdCust?.id || "");
            if (newId) {
              setForm((prev) => ({
                ...prev,
                customer_id: newId,
                customer_name: createdCust?.name || createdCust?.company || prev.customer_name,
              }));
            }
          } catch {
            // fallback
          }
        }}
      />
      <AddUserModal
        open={showAddUserModal}
        onClose={() => setShowAddUserModal(false)}
        defaultRole="Operator"
        title="New User"
        onSuccess={async (createdUser) => {
          setShowAddUserModal(false);
          try {
            const opRes = await getOperators().catch(() => ({ data: [] }));
            const refreshed = Array.isArray(opRes?.data)
              ? opRes.data
              : Array.isArray(opRes)
                ? opRes
                : [];
            const list = refreshed.length > 0 ? refreshed : (createdUser ? [createdUser] : []);
            setOperators(list);
            if (createdUser?.full_name || createdUser?.name) {
              const opName = createdUser.full_name || createdUser.name;
              setForm((prev) => ({ ...prev, operator_name: opName }));
            }
          } catch {
            // fallback
          }
        }}
      />
    </>
  );
}
