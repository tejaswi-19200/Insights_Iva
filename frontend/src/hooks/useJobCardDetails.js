import { useCallback, useState } from "react";

import { getTeamDirectory } from "../api/adminApi";
import { getMachines } from "../api/productionApi";
import { getSalesOrderDetail } from "../api/salesApi";
import {
  createSalesJobCard,
  getSalesJobCard,
  saveSalesJobCard,
} from "../api/workflowApi";
import { useToast } from "../context/ToastContext";
import { fetchCustomersWithFallback } from "../utils/customerOptions";
import { fetchProductsWithFallback } from "../utils/productOptions";
import { NOTES_MAX } from "../components/manufacturing/jobCardUiShared";
import {
  emptyProductionDetails,
  emptyRawMaterialRow,
  mergeProductionDetails,
  serializeDetailsForApi,
  validateProductionDetails,
} from "../utils/jobCardProductionDetails";

const EMPTY_LINE = () => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  product_id: "",
  product_name: "",
  quantity: "",
  unit: "Nos",
  unit_price: "",
  description: "",
});

function mapSoLine(line) {
  return {
    id: line.id ?? line.line_id ?? `so-${line.product_id}-${line.quantity}`,
    product_id: line.product_id ?? "",
    product_name: line.item_description || line.product_name || "",
    quantity: line.quantity ?? "",
    unit: line.unit || "Nos",
    unit_price: line.unit_price ?? line.rate ?? "",
    description: line.description || line.item_description || "",
    fromSalesOrder: true,
  };
}

export function useJobCardDetails(orderId, tenantId) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [card, setCard] = useState(null);
  const [form, setForm] = useState(null);
  const [details, setDetails] = useState(() => emptyProductionDetails());
  const [dirtyDetailSections, setDirtyDetailSections] = useState(() => new Set());
  const [salesOrder, setSalesOrder] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [productLines, setProductLines] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [salesPeople, setSalesPeople] = useState([]);
  const [machines, setMachines] = useState([]);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const catalogTasks = [
        fetchCustomersWithFallback(tenantId),
        fetchProductsWithFallback(tenantId),
        getTeamDirectory().catch(() => ({ data: [] })),
        getMachines().catch(() => ({ data: [] })),
      ];
      const cardTasks = orderId
        ? [getSalesJobCard(orderId), getSalesOrderDetail(orderId).catch(() => null)]
        : [];

      const results = await Promise.all([...cardTasks, ...catalogTasks]);
      const custList = results[cardTasks.length];
      const prodList = results[cardTasks.length + 1];
      const usersRes = results[cardTasks.length + 2];
      const machinesRes = results[cardTasks.length + 3];

      if (orderId) {
        const cardRes = results[0];
        const soRes = results[1];
        const data = cardRes?.data ?? cardRes;
        setCard(data);
        setForm({ ...(data?.form || {}), notes: data?.form?.notes || "" });
        setDetails(mergeProductionDetails(null, data?.details || data?.form?.details || {}));
        setDirtyDetailSections(new Set());

        const soData = soRes?.data ?? soRes;
        const order = soData?.order ?? null;
        const cust = soData?.customer ?? null;
        const lines = Array.isArray(soData?.line_items) ? soData.line_items : [];
        setSalesOrder(order);
        setCustomer(cust);
        setProductLines(lines.length ? lines.map(mapSoLine) : [{ ...EMPTY_LINE(), quantity: 1 }]);
      } else {
        setCard(null);
        setForm(null);
        setDetails(emptyProductionDetails());
        setDirtyDetailSections(new Set());
        setSalesOrder(null);
        setCustomer(null);
        setProductLines([{ ...EMPTY_LINE(), quantity: 1, unit: "pcs" }]);
      }

      setCustomers(Array.isArray(custList) ? custList : []);
      setProducts(Array.isArray(prodList) ? prodList : []);
      const users = usersRes?.data?.items ?? usersRes?.data ?? [];
      setSalesPeople(Array.isArray(users) ? users : []);
      const machineList = machinesRes?.data?.items ?? machinesRes?.data ?? [];
      setMachines(Array.isArray(machineList) ? machineList : []);
      setErrors({});
    } catch (err) {
      if (orderId) {
        addToast(err?.response?.data?.detail || "Could not load job card", "error");
        setCard(null);
        setForm(null);
        setSalesOrder(null);
        setCustomer(null);
        setProductLines([]);
      }
    } finally {
      setLoading(false);
    }
  }, [orderId, tenantId, addToast]);

  const patchField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const patchDetailsSection = (section, value) => {
    setDetails((prev) => mergeProductionDetails(prev, { [section]: value }));
    setDirtyDetailSections((prev) => new Set(prev).add(section));
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`details.${section}`)) delete next[k];
      });
      return next;
    });
  };

  const patchRawMaterial = (index, patch) => {
    setDetails((prev) => {
      const rows = [...(prev.raw_materials || [])];
      rows[index] = { ...rows[index], ...patch };
      return mergeProductionDetails(prev, { raw_materials: rows });
    });
    setDirtyDetailSections((prev) => new Set(prev).add("raw_materials"));
  };

  const addRawMaterial = () => {
    setDetails((prev) => {
      const rows = [...(prev.raw_materials || [])];
      rows.push(emptyRawMaterialRow(rows.length + 1));
      return mergeProductionDetails(prev, { raw_materials: rows });
    });
    setDirtyDetailSections((prev) => new Set(prev).add("raw_materials"));
  };

  const removeRawMaterial = (index) => {
    setDetails((prev) => {
      const rows = (prev.raw_materials || []).filter((_, i) => i !== index);
      return mergeProductionDetails(prev, {
        raw_materials: rows.map((r, i) => ({ ...r, sl_no: i + 1 })),
      });
    });
    setDirtyDetailSections((prev) => new Set(prev).add("raw_materials"));
  };

  const validate = (opts = {}) => {
    const next = {};
    const isCreated = Boolean(form?.is_created || card?.job_card_created);
    const editableSections = card?.editable_sections || [];

    if (!isCreated || opts.includeSales) {
      if (!form?.customer_id) next.customer_id = "Customer is required";
      if (!form?.product_id) next.product_id = "Product is required";
      if (!form?.quantity || Number(form.quantity) <= 0) next.quantity = "Quantity must be greater than 0";
      if (!form?.required_delivery_date) next.required_delivery_date = "Required delivery date is required";
      if (!form?.priority) next.priority = "Priority is required";
    }

    const detailErrors = validateProductionDetails(details, {
      editableSections,
      isCreated,
      finalize: Boolean(opts.finalize),
    });
    Object.assign(next, detailErrors);

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildPayload = () => ({
    customer_id: form.customer_id ? Number(form.customer_id) : null,
    product_id: form.product_id ? Number(form.product_id) : null,
    quantity: Number(form.quantity),
    unit: form.unit || "Nos",
    required_delivery_date: form.required_delivery_date || null,
    priority: form.priority || "medium",
    sales_person_id: form.sales_person_id ? Number(form.sales_person_id) : null,
    sales_person_name: form.sales_person_name || null,
    notes: (form.notes || "").slice(0, NOTES_MAX),
    details: serializeDetailsForApi(details),
  });

  const applySavedCard = (data) => {
    setCard(data);
    setForm({ ...(data?.form || {}), notes: data?.form?.notes || "" });
    setDetails(mergeProductionDetails(null, data?.details || data?.form?.details || {}));
    setDirtyDetailSections(new Set());
  };

  const handleSaveDetailsOnly = async () => {
    const sectionPermissions = {
      job_info: "sales",
      raw_materials: "inventory",
      production: "production",
      output: "quality",
      approval: "sales",
    };
    const dirtySections = [...dirtyDetailSections];
    if (!dirtySections.length) {
      addToast("No production job card changes to save.", "info");
      return false;
    }

    const editableDetailSections = dirtySections
      .map((section) => sectionPermissions[section])
      .filter(Boolean);
    const storeIssueEdit = [
      "MATERIAL_AVAILABLE",
      "STORE_ISSUE_PENDING",
      "STORE_ISSUE_PARTIAL",
    ].includes(String(card?.workflow_status || "").toUpperCase());
    const detailErrors = validateProductionDetails(details, {
      editableSections: editableDetailSections,
      isCreated: Boolean(form?.is_created || card?.job_card_created) && !storeIssueEdit,
    });
    if (Object.keys(detailErrors).length) {
      setErrors(detailErrors);
      return false;
    }

    setSaving(true);
    try {
      const serialized = serializeDetailsForApi(details);
      const detailsPatch = Object.fromEntries(
        dirtySections.map((section) => [section, serialized[section]])
      );
      const res = await saveSalesJobCard(orderId, { details: detailsPatch });
      const data = res?.data ?? res;
      applySavedCard(data);
      addToast("Production job card details saved.", "success");
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail?.errors) setErrors(detail.errors);
      addToast(typeof detail === "string" ? detail : detail?.message || "Save failed", "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const isCreated = Boolean(form?.is_created || card?.job_card_created);
    if (!validate({ includeSales: !isCreated })) return false;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isCreated) {
        delete payload.customer_id;
        delete payload.product_id;
        delete payload.quantity;
        delete payload.unit;
        delete payload.required_delivery_date;
      }
      const res = await saveSalesJobCard(orderId, payload);
      const data = res?.data ?? res;
      applySavedCard(data);
      addToast("Job card saved.", "success");
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail?.errors) setErrors(detail.errors);
      addToast(typeof detail === "string" ? detail : detail?.message || "Save failed", "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!validate({ finalize: true, includeSales: true })) return false;
    setCreating(true);
    try {
      const res = await createSalesJobCard(orderId, buildPayload());
      const data = res?.data ?? res;
      applySavedCard(data);
      addToast("Job card created successfully.", "success");
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail?.errors) setErrors(detail.errors);
      addToast(typeof detail === "string" ? detail : detail?.message || "Create failed", "error");
      return false;
    } finally {
      setCreating(false);
    }
  };

  const addProductLine = () => {
    setProductLines((prev) => [...prev, EMPTY_LINE()]);
    setErrors((prev) => ({ ...prev, product_lines: undefined }));
  };

  const removeProductLine = (index) => {
    setProductLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const updateProductLine = (index, patch) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        if (patch.product_id != null) {
          const prod = products.find((p) => String(p.id) === String(patch.product_id));
          if (prod) next.product_name = prod.name || next.product_name;
        }
        return next;
      })
    );
    if (index === 0) {
      if (patch.product_id != null) patchField("product_id", patch.product_id);
      if (patch.quantity != null) patchField("quantity", patch.quantity);
      if (patch.unit != null) patchField("unit", patch.unit);
    }
  };

  const isCreated = Boolean(form?.is_created || card?.job_card_created);
  const editableSections = card?.editable_sections || [];
  const canEditDetails = editableSections.length > 0;

  return {
    loading,
    saving,
    creating,
    card,
    form,
    details,
    salesOrder,
    customer,
    productLines,
    customers,
    products,
    salesPeople,
    machines,
    errors,
    isCreated,
    editableSections,
    canEditDetails,
    load,
    patchField,
    patchDetailsSection,
    patchRawMaterial,
    addRawMaterial,
    removeRawMaterial,
    handleSave,
    handleSaveDetailsOnly,
    handleCreate,
    addProductLine,
    removeProductLine,
    updateProductLine,
    setProductLines,
  };
}

export default useJobCardDetails;
