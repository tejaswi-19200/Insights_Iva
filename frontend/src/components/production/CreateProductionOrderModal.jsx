import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CheckCircle, ClipboardList, Cpu, User as UserIcon, X } from "lucide-react";

import { createProductionOrder, getMachines, getOperators, updateProductionOrder } from "../../api/productionApi";
import useTenantId from "../../hooks/useTenantId";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../utils/apiError";
import { fetchFinishedGoodsWithFallback } from "../../utils/productOptions";
import AddNewItemModal from "../sales/AddNewItemModal";
import CreateMachineModal from "./CreateMachineModal";
import AddUserModal from "../admin/AddUserModal";
import Button, { IconButton } from "../common/Button";
import ShorthandQuantityInput from "../common/ShorthandQuantityInput";

const SHIFT_OPTIONS = [
  { id: "General Shift (9:00 AM – 6:00 PM)", label: "General Shift (9:00 AM – 6:00 PM)" },
  { id: "Morning Shift (6:00 AM – 2:00 PM)", label: "Morning Shift (6:00 AM – 2:00 PM)" },
  { id: "Evening Shift (2:00 PM – 10:00 PM)", label: "Evening Shift (2:00 PM – 10:00 PM)" },
  { id: "Night Shift (10:00 PM – 6:00 AM)", label: "Night Shift (10:00 PM – 6:00 AM)" },
];

const PRIORITY_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

const STATUS_OPTIONS = [
  { id: "planned", label: "Planned" },
  { id: "draft", label: "Draft" },
  { id: "in_progress", label: "In Progress" },
  { id: "on_hold", label: "On Hold" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const EMPTY_FORM = {
  product_id: "",
  machine_id: "",
  operator_name: "",
  operator_id: "",
  planned_quantity: "",
  size: "",
  priority: "medium",
  shift: "General Shift (9:00 AM – 6:00 PM)",
  status: "planned",
  start_date: "",
  due_date: "",
};

/** Stable defaults — inline `= []` recreates a new array every render and loops effects. */
const EMPTY_LIST = [];

function DateTimeField({ value, onChange, error }) {
  const inputRef = useRef(null);

  return (
    <span className="relative block">
      <input
        ref={inputRef}
        type="datetime-local"
        value={value}
        onChange={onChange}
        className={`ui-input w-full !pr-10 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:w-0 [&::-webkit-calendar-picker-indicator]:pointer-events-none ${error ? "border-[var(--color-danger)]" : ""}`}
      />
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.showPicker?.();
        }}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
        aria-label="Open date and time picker"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
      </button>
    </span>
  );
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length >= 16 && s[10] === "T") return s.slice(0, 16);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateProductionOrderModal({
  open,
  onClose,
  onSaved,
  initialOrder = null,
  productsList = EMPTY_LIST,
  machinesList = EMPTY_LIST,
}) {
  const tenantId = useTenantId();
  const { addToast } = useToast();

  const [machines, setMachines] = useState([]);
  const [products, setProducts] = useState([]);
  const [operators, setOperators] = useState([]);
  const [customProductMode, setCustomProductMode] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showAddMachineModal, setShowAddMachineModal] = useState(false);
  const [customMachineMode, setCustomMachineMode] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [customOperatorMode, setCustomOperatorMode] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  // Load options once when the modal opens (not on every parent re-render).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingOptions(true);

    const hasMachines = Array.isArray(machinesList) && machinesList.length > 0;
    const hasProducts = Array.isArray(productsList) && productsList.length > 0;

    const loadMachines = hasMachines
      ? Promise.resolve(machinesList)
      : getMachines()
          .then((res) => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []))
          .catch(() => []);

    const loadProducts = hasProducts
      ? Promise.resolve(productsList)
      : fetchFinishedGoodsWithFallback().catch(() => []);

    const loadOperators = getOperators()
      .then((res) => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []))
      .catch(() => []);

    Promise.all([loadMachines, loadProducts, loadOperators])
      .then(([m, p, ops]) => {
        if (cancelled) return;
        setMachines(Array.isArray(m) ? m : []);
        setProducts(Array.isArray(p) ? p : []);
        setOperators(Array.isArray(ops) ? ops : []);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only when open toggles
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialOrder) {
      const hasProductId = Boolean(initialOrder.product_id);
      const isCustomProduct = !hasProductId && Boolean(initialOrder.product_name);
      setCustomProductMode(isCustomProduct);

      const hasMachineId = Boolean(initialOrder.machine_id);
      const isCustomMachine =
        !hasMachineId && Boolean(initialOrder.machine_name && initialOrder.machine_name !== "—");
      setCustomMachineMode(isCustomMachine);

      setForm({
        product_id: initialOrder.product_id ? String(initialOrder.product_id) : "",
        product_name: initialOrder.product_name || "",
        machine_id: initialOrder.machine_id ? String(initialOrder.machine_id) : "",
        machine_name: initialOrder.machine_name || "",
        operator_name: initialOrder.operator_name || "",
        operator_id: initialOrder.operator_id || "",
        planned_quantity:
          initialOrder.planned_quantity != null && initialOrder.planned_quantity !== ""
            ? String(initialOrder.planned_quantity)
            : "",
        size: initialOrder.size || initialOrder.output_quantity_size || initialOrder.release_size_nos || "",
        priority: (initialOrder.priority || "medium").toLowerCase(),
        shift: initialOrder.shift || "General Shift (9:00 AM – 6:00 PM)",
        status: (initialOrder.status || "planned").toLowerCase(),
        start_date: toDateTimeLocal(initialOrder.start_date),
        due_date: toDateTimeLocal(initialOrder.due_date),
      });
    } else {
      setForm(EMPTY_FORM);
      setCustomProductMode(false);
      setCustomMachineMode(false);
      setCustomOperatorMode(false);
    }
    setErrors({});
  }, [initialOrder, open]);

  if (!open) return null;

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validate = () => {
    const errs = {};
    if (!customProductMode && !form.product_id && !form.product_name) {
      errs.product_id = "Select a product";
    }
    if (customProductMode && !form.product_name?.trim()) {
      errs.product_id = "Enter a product name";
    }
    if (!form.planned_quantity || Number(form.planned_quantity) <= 0) {
      errs.planned_quantity = "Planned quantity is required and must be greater than 0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate() || submitting) return;

    let productId = null;
    let productName = "";

    if (customProductMode) {
      productName = form.product_name?.trim() || "";
    } else {
      const selectedProduct = products.find((p) => String(p.id) === String(form.product_id));
      if (selectedProduct?.id) {
        productId = Number(selectedProduct.id);
        productName = selectedProduct.name || selectedProduct.sku;
      } else if (form.product_id) {
        productId = Number(form.product_id);
        productName = form.product_name || initialOrder?.product_name || `Product #${form.product_id}`;
      } else if (form.product_name || initialOrder?.product_name) {
        productName = form.product_name || initialOrder?.product_name || "";
      } else {
        setErrors((prev) => ({ ...prev, product_id: "Select a valid product" }));
        return;
      }
    }

    setSubmitting(true);
    const isEdit = Boolean(initialOrder?.id);
    try {
      const toIsoOrNull = (local) => {
        if (!local) return null;
        // datetime-local → ISO-ish value backends accept
        return local.length === 16 ? `${local}:00` : local;
      };

      const payload = {
        tenant_id: Number(tenantId),
        ...(productId ? { product_id: productId } : { product_name: productName }),
        order_number: initialOrder?.order_number || "",
        planned_quantity: Number(form.planned_quantity),
        machine_id: !customMachineMode && form.machine_id ? Number(form.machine_id) : null,
        machine_name: customMachineMode ? (form.machine_name?.trim() || null) : null,
        operator_name: form.operator_name?.trim() || null,
        operator_id: form.operator_id?.trim() || null,
        priority: form.priority || "medium",
        shift: form.shift || null,
        status: form.status || "planned",
        start_date: toIsoOrNull(form.start_date),
        due_date: toIsoOrNull(form.due_date),
        release_size_nos: form.size?.trim() || null,
      };

      let res;
      if (isEdit) {
        res = await updateProductionOrder(initialOrder.id, payload);
      } else {
        res = await createProductionOrder(payload);
      }

      const savedOrder = {
        ...(initialOrder || {}),
        ...(res?.data || {}),
        product_name: productName,
        operator_name: form.operator_name || null,
        operator_id: form.operator_id || null,
      };

      addToast(
        isEdit
          ? `Production Order ${savedOrder.order_number || initialOrder?.order_number || ""} updated successfully`
          : `Production Order ${savedOrder.order_number || ""} created successfully`,
        "success"
      );
      onSaved?.(savedOrder, { isEdit });
      onClose();
    } catch (err) {
      addToast(
        apiErrorMessage(err, isEdit ? "Failed to update production order" : "Failed to create production order"),
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modalPortal = createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-po-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.();
      }}
    >
      <div
        className="flex max-h-[96vh] sm:max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl sm:rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-[var(--color-success-soft)] text-[var(--color-success)]">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h2 id="create-po-title" className="text-base sm:text-lg font-bold tracking-tight text-[var(--color-text)]">
                {initialOrder ? "Edit Production Order" : "New Production Order"}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Select a product and enter planning details
              </p>
            </div>
          </div>
          <IconButton
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="ui-label">
                Product <span className="text-[var(--color-danger)]">*</span>
              </span>
              {customProductMode ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={form.product_name || ""}
                    onChange={(e) => handleChange("product_name", e.target.value)}
                    placeholder="Enter product name…"
                    autoFocus
                    className={`ui-input flex-1 ${errors.product_id ? "border-[var(--color-danger)]" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomProductMode(false);
                      handleChange("product_name", "");
                      handleChange("product_id", "");
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <select
                  value={form.product_id}
                  onChange={(e) => {
                    if (e.target.value === "__custom__" || e.target.value === "__add_product__") {
                      setShowAddProductModal(true);
                    } else {
                      handleChange("product_id", e.target.value);
                    }
                  }}
                  disabled={loadingOptions}
                  className={`ui-select w-full ${errors.product_id ? "border-[var(--color-danger)]" : ""}`}
                >
                  <option value="">{loadingOptions ? "Loading products" : "Select Product"}</option>
                  <option
                    value="__add_product__"
                    className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                    style={{ color: "#036f71", fontWeight: "600" }}
                  >
                    + Add new Product
                  </option>
                  {form.product_id && !products.some((p) => String(p.id) === String(form.product_id)) && (
                    <option value={form.product_id}>
                      {form.product_name || initialOrder?.product_name || `Product #${form.product_id}`}
                    </option>
                  )}
                  {products
                    .filter((p) => p?.id != null && p.id !== "")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name && p.name !== "—" ? p.name : p.sku || `Product #${p.id}`}
                        {p.sku && p.sku !== "—" && p.name && p.name !== "—" ? ` (${p.sku})` : ""}
                      </option>
                    ))}
                </select>
              )}
              {errors.product_id ? <p className="text-xs text-[var(--color-danger)]">{errors.product_id}</p> : null}
              {!loadingOptions && products.length === 0 && !customProductMode ? (
                <p className="text-xs text-[var(--color-text-muted)]">No products found. Add products in Masters first.</p>
              ) : null}
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Machine</span>
              {customMachineMode ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={form.machine_name || ""}
                    onChange={(e) => handleChange("machine_name", e.target.value)}
                    placeholder="Enter machine name"
                    autoFocus
                    className="ui-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMachineMode(false);
                      handleChange("machine_name", "");
                      handleChange("machine_id", "");
                    }}
                    className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)]"
                  >
                    Select
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Cpu className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-[var(--color-text-icon)]" />
                  <select
                    value={form.machine_id}
                    onChange={(e) => {
                      if (e.target.value === "__custom__" || e.target.value === "__add_machine__") {
                        setShowAddMachineModal(true);
                      } else {
                        const mId = e.target.value;
                        handleChange("machine_id", mId);
                        const selM = machines.find((m) => String(m.id) === String(mId));
                        if (selM) {
                          handleChange("machine_name", selM.name || selM.code);
                          if (selM.assigned_operator && !form.operator_name) {
                            handleChange("operator_name", selM.assigned_operator);
                          }
                        }
                      }
                    }}
                    disabled={loadingOptions}
                    className="ui-select pl-10 w-full"
                  >
                    <option value="">Select Machine</option>
                    <option
                      value="__add_machine__"
                      className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                      style={{ color: "#036f71", fontWeight: "600" }}
                    >
                      + Add new Machine
                    </option>
                    {form.machine_id && !machines.some((m) => String(m.id) === String(form.machine_id)) && (
                      <option value={form.machine_id}>
                        {form.machine_name || initialOrder?.machine_name || `Machine #${form.machine_id}`}
                      </option>
                    )}
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.code} ({m.status || "Available"})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </label>

            <div className="space-y-1.5">
              <span className="ui-label">Operator</span>
              {customOperatorMode ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={form.operator_name || ""}
                    onChange={(e) => handleChange("operator_name", e.target.value)}
                    placeholder="Enter operator name"
                    autoFocus
                    className="ui-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomOperatorMode(false);
                      handleChange("operator_name", "");
                      handleChange("operator_id", "");
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
                    value={form.operator_name || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setCustomOperatorMode(true);
                      } else if (val === "__add_operator__" || val === "__add_user__") {
                        setShowAddUserModal(true);
                      } else {
                        handleChange("operator_name", val);
                        const selOp = operators.find(
                          (op) => (op.full_name || op.name || op.email) === val
                        );
                        if (selOp) {
                          handleChange(
                            "operator_id",
                            selOp.employee_id
                              ? String(selOp.employee_id)
                              : selOp.id
                                ? String(selOp.id)
                                : ""
                          );
                        } else if (!val) {
                          handleChange("operator_id", "");
                        }
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
                          {form.operator_id ? ` (${form.operator_id})` : ""}
                        </option>
                      )}
                    {operators.map((op) => {
                      const opName = op.full_name || op.name || op.email || `User #${op.id}`;
                      return (
                        <option key={op.id} value={opName}>
                          {opName}
                          {op.employee_id ? ` (${op.employee_id})` : op.designation ? ` (${op.designation})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>

            <label className="block space-y-1.5">
              <span className="ui-label">Operator ID</span>
              <input
                type="text"
                value={form.operator_id}
                onChange={(e) => handleChange("operator_id", e.target.value)}
                placeholder="e.g. OP-104"
                className="ui-input w-full"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">
                Planned Quantity <span className="text-[var(--color-danger)]">*</span>
              </span>
              <ShorthandQuantityInput
                value={form.planned_quantity}
                onChange={(val) => handleChange("planned_quantity", val)}
                placeholder="e.g. 500"
                error={Boolean(errors.planned_quantity)}
              />
              {errors.planned_quantity ? (
                <p className="text-xs text-[var(--color-danger)]">{errors.planned_quantity}</p>
              ) : null}
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Output Quantity Size</span>
              <input
                type="text"
                value={form.size}
                onChange={(e) => handleChange("size", e.target.value)}
                placeholder="e.g. Large, XL, 500ml"
                className="ui-input w-full"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Priority</span>
              <select
                value={form.priority}
                onChange={(e) => handleChange("priority", e.target.value)}
                className="ui-select w-full"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Shift</span>
              <select
                value={form.shift}
                onChange={(e) => handleChange("shift", e.target.value)}
                className="ui-select w-full"
              >
                {SHIFT_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 md:col-span-2">
              <span className="ui-label">Status</span>
              <select
                value={form.status}
                onChange={(e) => handleChange("status", e.target.value)}
                className="ui-select w-full"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Start Date & Time</span>
              <DateTimeField
                value={form.start_date}
                onChange={(e) => handleChange("start_date", e.target.value)}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="ui-label">Due Date & Time</span>
              <DateTimeField
                value={form.due_date}
                onChange={(e) => handleChange("due_date", e.target.value)}
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border-soft)] pt-4">
            <Button variant="cancel" type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="success" type="submit" disabled={submitting || loadingOptions} className="inline-flex items-center gap-2">
              <CheckCircle className="h-4 w-4" strokeWidth={2.25} />
              {submitting
                ? "Saving…"
                : initialOrder
                  ? "Save Changes"
                  : "Create Production Order"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {modalPortal}
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
              handleChange("product_id", newId);
              if (product?.name || line?.item_description) {
                handleChange("product_name", product?.name || line?.item_description);
              }
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
              handleChange("machine_id", mId);
              handleChange("machine_name", createdMachine?.name || createdMachine?.code || "");
              if (createdMachine?.assigned_operator && !form.operator_name) {
                handleChange("operator_name", createdMachine.assigned_operator);
              }
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
              handleChange("operator_name", opName);
              if (createdUser.employee_id || createdUser.id) {
                handleChange(
                  "operator_id",
                  createdUser.employee_id ? String(createdUser.employee_id) : String(createdUser.id)
                );
              }
            }
          } catch {
            // fallback
          }
        }}
      />
    </>
  );
}
