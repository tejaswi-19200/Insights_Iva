import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PenLine, Plus, Save, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Button from "../common/Button";
import SearchableSelect from "../common/SearchableSelect";
import { Input, Select, Textarea } from "../common/FormField";
import { DatePicker } from "../../design-system/dateControls";
import { LoadingState, ErrorState } from "../common/states";
import useAuth from "../../hooks/useAuth";
import usePermissions from "../../hooks/usePermissions";
import useManualJobCardMasters from "../../hooks/useManualJobCardMasters";
import { getCompanySettings } from "../../api/settingsApi";
import { getSalesOrderDetail } from "../../api/salesApi";
import {
  createManualJobCard,
  getManualJobCard,
  updateManualJobCard,
} from "../../api/workflowApi";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage, extractApiErrorDetail } from "../../utils/apiError";
import {
  ADD_CUSTOMER_VALUE,
  ADD_PRODUCT_VALUE,
  buildManualPayload,
  emptyManualForm,
  emptyProductLine,
  emptySpecLine,
  formatCustomerAddress,
  getUomOptions,
  MANUAL_JOB_CARD_SAVED_STATUS,
  manualFormFromApi,
  manualFormHasEmptyProductLines,
  mergeSalesOrderIntoManualForm,
  mapApiErrors,
  productLinesFromSalesOrderItems,
  PAYMENT_TERMS_OPTIONS,
  PRIORITY_OPTIONS,
  PRODUCT_CATEGORY_OPTIONS,
  scrollToFirstManualFormError,
  SPEC_PARAMETER_OPTIONS,
  manualFormLineTotals,
  validateManualForm,
} from "../../utils/manualSalesJobCard";
import {
  applyProductMasterToLine,
  findDuplicateProductLineIndex,
  recalcProductLine,
} from "../../utils/jobCardLineTotals";
import { formatInr } from "../../data/salesMasterData";
import { formatCompanyAddress, resolveCompanyLogoUrl, resolveCompanyTagline } from "../../utils/salesJobCardDocument";
import QuickAddCustomerModal from "./QuickAddCustomerModal";
import QuickAddProductModal from "./QuickAddProductModal";
import EditCompanyDetailsModal from "../sales/EditCompanyDetailsModal";
import AddContactPersonModal from "../sales/AddContactPersonModal";
import "../../styles/sales-job-card-document.css";
import "../../styles/manual-sales-job-card-form.css";

const ADD_CONTACT_PERSON_VALUE = "__add_contact_person__";

function FieldError({ error }) {
  if (!error) return null;
  return <p className="manual-sjc__error">{error}</p>;
}

function FormGridField({ label, required, error, children, fieldKey, className = "" }) {
  return (
    <div className={`manual-sjc__grid-field ${className}`.trim()}>
      <label className="manual-sjc__grid-label">
        {label}
        {required ? " *" : ""}
      </label>
      <div className="manual-sjc__grid-control" data-manual-field={fieldKey || undefined}>
        {children}
        <FieldError error={error} />
      </div>
    </div>
  );
}

function workflowStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (!normalized || normalized === "SAVED") return MANUAL_JOB_CARD_SAVED_STATUS;
  if (normalized === "RETURNED_TO_SALES") return "Returned to Sales";
  if (normalized === "SENT") return "Sent";
  return status || MANUAL_JOB_CARD_SAVED_STATUS;
}

const compactSelectClass = "manual-sjc__select";

export default function ManualSalesJobCardForm({ jobCardId = null, backTo = "/my-job-cards?dept=sales" }) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEdit = Boolean(jobCardId);
  const billingAddressRef = useRef(null);
  const dispatchAddressRef = useRef(null);

  const {
    customers,
    products,
    salesOrders = [],
    loading: mastersLoading,
    error: mastersError,
    reloadCustomers,
    reloadProducts,
    reloadAll,
  } = useManualJobCardMasters();

  const canAddCustomer = can("sales") || can("masters");
  const canAddProduct = can("sales");

  const [form, setForm] = useState(() => emptyManualForm(user?.full_name || user?.name || ""));
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  // NEW: was used (setSelectedSalesOrderId) but never declared — this is the second latent bug.
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState("");
  const [workflowStatus, setWorkflowStatus] = useState("SAVED");
  const [recordVersion, setRecordVersion] = useState(null);
  const [readOnlySales, setReadOnlySales] = useState(false);
  const [canEditCard, setCanEditCard] = useState(true);
  const [activeDetailTab, setActiveDetailTab] = useState("other");
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddContactPerson, setShowAddContactPerson] = useState(false);
  const [showPaymentTermsDescription, setShowPaymentTermsDescription] = useState(false);
  const [contactPersons, setContactPersons] = useState([]);
  const [addProductRowIndex, setAddProductRowIndex] = useState(null);
  const [customerFromOrder, setCustomerFromOrder] = useState(false);

  const uomOptions = useMemo(() => getUomOptions().map((u) => ({ value: u, label: u })), []);
  const paymentTermsOptions = useMemo(
    () => PAYMENT_TERMS_OPTIONS.map((t) => ({ value: t, label: t })),
    []
  );
  const categoryOptions = useMemo(
    () => PRODUCT_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
    []
  );
  const specParameterOptions = useMemo(
    () => SPEC_PARAMETER_OPTIONS.map((p) => ({ value: p, label: p })),
    []
  );

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: String(c.id),
        label: c.name || c.company || c.customer_name || `Customer #${c.id}`,
      })),
    [customers]
  );

  const customerFooterOptions = useMemo(
    () => (canAddCustomer ? [{ value: ADD_CUSTOMER_VALUE, label: "Add Company" }] : []),
    [canAddCustomer]
  );

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p.id),
        label: [p.name, p.sku || p.product_code].filter(Boolean).join(" · ") || `Product #${p.id}`,
      })),
    [products]
  );

  const productFooterOptions = useMemo(
    () => (canAddProduct ? [{ value: ADD_PRODUCT_VALUE, label: "+ Add Product" }] : []),
    [canAddProduct]
  );

  const contactPersonOptions = useMemo(
    () => contactPersons.map(({ name }) => ({ value: name, label: name })),
    [contactPersons]
  );
  const contactPersonFooterOptions = useMemo(
    () => [{ value: ADD_CONTACT_PERSON_VALUE, label: "Add Person" }],
    []
  );

  useEffect(() => {
    const name = String(form.customer.contact_person || "").trim();
    if (!name) return;
    setContactPersons((current) => {
      const existing = current.findIndex(
        (contact) => contact.name.toLowerCase() === name.toLowerCase()
      );
      if (existing < 0) {
        return [...current, { name, email: form.customer.email || "", phone: form.customer.phone || "" }];
      }
      return current.map((contact, index) =>
        index === existing
          ? { ...contact, email: form.customer.email || "", phone: form.customer.phone || "" }
          : contact
      );
    });
  }, [form.customer.contact_person, form.customer.email, form.customer.phone]);

  const salesOrdersForSelect = useMemo(() => {
    if (!selectedCustomerId) return salesOrders;
    const customer = customers.find((c) => String(c.id) === String(selectedCustomerId));
    if (!customer) return salesOrders;
    const customerId = String(customer.id);
    const customerNames = new Set(
      [customer.name, customer.company, customer.customer_name]
        .map((name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean)
    );
    if (!customerNames.size) return salesOrders;
    return salesOrders.filter((order) => {
      if (order.customer_id != null) return String(order.customer_id) === customerId;
      const orderNames = [order.customer_name, order.buyer_name, order.buyer_company]
        .map((name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean);
      return orderNames.some((name) => customerNames.has(name));
    });
  }, [salesOrders, selectedCustomerId, customers]);

  const salesOrderOptions = useMemo(
    () =>
      salesOrdersForSelect.map((o) => {
        const soNo = o.order_number || `SO-${o.id}`;
        return {
          value: String(o.id),
          label: soNo,
        };
      }),
    [salesOrdersForSelect]
  );

  // NEW: mirrors customerSelectValue's fallback pattern so the SearchableSelect
  const customerSelectValue = useMemo(() => {
    if (selectedCustomerId) return selectedCustomerId;
    const name = form.customer.customer_name?.trim();
    if (!name) return "";
    const match = customers.find(
      (c) => String(c.name || c.company || "").toLowerCase() === name.toLowerCase()
    );
    return match ? String(match.id) : name;
  }, [selectedCustomerId, form.customer.customer_name, customers]);

  const salesOrderSelectValue = useMemo(() => {
    if (selectedSalesOrderId) return selectedSalesOrderId;
    const soNo = form.header.sales_order_no?.trim();
    if (!soNo) return "";
    const match = salesOrders.find((o) => {
      const num = String(o.order_number || "").trim();
      const idLabel = o.id != null ? `SO-${o.id}` : "";
      const hay = soNo.toLowerCase();
      return (
        (num && num.toLowerCase() === hay) ||
        (idLabel && idLabel.toLowerCase() === hay) ||
        (o.id != null && String(o.id) === soNo)
      );
    });
    return match ? String(match.id) : soNo;
  }, [selectedSalesOrderId, form.header.sales_order_no, salesOrders]);

  const lineTotals = useMemo(() => manualFormLineTotals(form), [form.product_lines]);

  const patch = useCallback((path, value) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev };
      const [section, key] = path.includes(".") ? path.split(".") : [null, path];
      if (section && key) {
        next[section] = { ...prev[section], [key]: value };
      } else {
        next[path] = value;
      }
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const applyCustomerFromMaster = useCallback((customer) => {
    if (!customer) return;
    setDirty(true);
    setSelectedCustomerId(String(customer.id));
    setForm((prev) => ({
      ...prev,
      customer: {
        ...prev.customer,
        customer_name: customer.name || customer.company || customer.customer_name || "",
        contact_person: customer.contact_name || customer.contact_person || prev.customer.contact_person,
        phone: customer.phone || prev.customer.phone,
        email: customer.email || prev.customer.email,
        billing_address: formatCustomerAddress(customer) || prev.customer.billing_address,
        dispatch_address:
          customer.shipping_address || customer.dispatch_address || prev.customer.dispatch_address,
      },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next["customer.customer_name"];
      return next;
    });
  }, []);

  const applyProductToRow = useCallback((index, product) => {
    if (!product) return;
    setDirty(true);
    setForm((prev) => {
      const lines = [...prev.product_lines];
      lines[index] = applyProductMasterToLine(lines[index], product);
      return { ...prev, product_lines: lines };
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`product_lines.${index}.product_name`];
      delete next[`product_lines.${index}.uom`];
      delete next[`product_lines.${index}.unit_price`];
      return next;
    });
  }, []);

  const resolveCustomerForOrder = useCallback(
    (order, detail) => {
      const customerId = detail?.customer_id;
      if (customerId != null) {
        const byId = customers.find((c) => String(c.id) === String(customerId));
        if (byId) return byId;
      }
      const name = String(order?.customer_name || detail?.customer_name || "").trim().toLowerCase();
      if (!name) return null;
      return customers.find(
        (c) => String(c.name || c.company || "").toLowerCase() === name
      );
    },
    [customers]
  );

  const handleCustomerSelect = useCallback(
    (val) => {
      if (val === ADD_CUSTOMER_VALUE) {
        setShowAddCustomer(true);
        return;
      }
      setCustomerFromOrder(false);
      const customer = customers.find((c) => String(c.id) === String(val));
      if (customer) {
        applyCustomerFromMaster(customer);
      } else {
        setSelectedCustomerId("");
        patch("customer.customer_name", val);
      }
    },
    [customers, applyCustomerFromMaster, patch]
  );

  const handleSalesOrderSelect = useCallback(
    async (val) => {
      const order = salesOrders.find((o) => String(o.id) === String(val));
      if (!order) {
        setSelectedSalesOrderId("");
        setCustomerFromOrder(false);
        patch("header.sales_order_no", val);
        return;
      }

      setSelectedSalesOrderId(String(order.id));
      setDirty(true);

      let detailBody = null;
      try {
        const res = await getSalesOrderDetail(order.id);
        detailBody = res?.data?.data ?? res?.data ?? res;
      } catch {
        detailBody = null;
      }

      const detailOrder = detailBody?.order ?? detailBody;
      const detailCustomerRecord = detailBody?.customer ?? null;

      const mergedOrder = {
        ...order,
        reference_number: detailOrder?.reference_number ?? order.reference_number,
        priority: detailOrder?.priority ?? order.priority,
        payment_terms: detailOrder?.payment_terms ?? order.payment_terms,
        delivery_date: detailOrder?.delivery_date ?? order.delivery_date,
        order_date: detailOrder?.order_date ?? order.order_date,
        customer_name:
          detailCustomerRecord?.name ?? detailOrder?.customer_name ?? order.customer_name,
      };

      let customer = null;
      if (detailCustomerRecord?.id != null) {
        customer =
          customers.find((c) => String(c.id) === String(detailCustomerRecord.id)) ||
          detailCustomerRecord;
      } else {
        customer = resolveCustomerForOrder(mergedOrder, detailOrder);
      }
      if (customer) {
        setSelectedCustomerId(String(customer.id));
        setCustomerFromOrder(true);
      } else if (mergedOrder.customer_name) {
        setSelectedCustomerId("");
        setCustomerFromOrder(true);
      }

      const lineSource =
        (Array.isArray(detailBody?.line_items) && detailBody.line_items.length
          ? detailBody.line_items
          : Array.isArray(detailOrder?.line_items) && detailOrder.line_items.length
            ? detailOrder.line_items
            : order.line_items) || [];
      const mappedLines = productLinesFromSalesOrderItems(lineSource, products);
      const replaceProductLines = manualFormHasEmptyProductLines(form.product_lines);

      setForm((prev) =>
        mergeSalesOrderIntoManualForm(prev, mergedOrder, {
          customer,
          productLines: mappedLines,
          replaceProductLines: replaceProductLines && Boolean(mappedLines?.length),
        })
      );
      setErrors((prev) => {
        const next = { ...prev };
        delete next["header.sales_order_no"];
        delete next["customer.customer_name"];
        return next;
      });
    },
    [salesOrders, products, form.product_lines, resolveCustomerForOrder, customers, patch]
  );

  const handleProductSelect = useCallback(
    (index, val) => {
      if (val === ADD_PRODUCT_VALUE) {
        setAddProductRowIndex(index);
        setShowAddProduct(true);
        return;
      }
      const product = products.find((p) => String(p.id) === String(val));
      if (product) {
        const dupIdx = findDuplicateProductLineIndex(
          form.product_lines,
          product.id,
          index
        );
        if (dupIdx >= 0) {
          setErrors((prev) => ({
            ...prev,
            [`product_lines.${index}.product_name`]:
              "Product already added. Update the quantity instead.",
          }));
          addToast("Product already added. Update the quantity instead.", "warning");
          return;
        }
        applyProductToRow(index, product);
      } else {
        setDirty(true);
        setForm((prev) => {
          const lines = [...prev.product_lines];
          lines[index] = { ...lines[index], product_id: "", product_name: val };
          return { ...prev, product_lines: lines };
        });
      }
    },
    [products, applyProductToRow, form.product_lines, addToast]
  );

  const getProductSelectValue = useCallback(
    (row) => {
      if (row.product_id) return row.product_id;
      const name = row.product_name?.trim();
      if (!name) return "";
      const match = products.find((p) => String(p.name || "").toLowerCase() === name.toLowerCase());
      return match ? String(match.id) : name;
    },
    [products]
  );

  useEffect(() => {
    getCompanySettings()
      .then((res) => setCompanyProfile(res?.data?.data ?? res?.data ?? null))
      .catch(() => setCompanyProfile(null));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    setLoadError("");
    getManualJobCard(jobCardId)
      .then((res) => {
        const data = res?.data ?? res;
        setForm(manualFormFromApi(data));
        setWorkflowStatus(data?.workflow_status || data?.workflow_stage || "SAVED");
        setRecordVersion(data?.version ?? null);
        const readOnly = Boolean(data?.read_only_sales);
        setReadOnlySales(readOnly);
        const actions = Array.isArray(data?.allowed_actions) ? data.allowed_actions : [];
        setCanEditCard(!readOnly && (actions.length === 0 || actions.includes("edit")));
      })
      .catch((err) => setLoadError(apiErrorMessage(err, "Could not load job card.")))
      .finally(() => setLoading(false));
  }, [isEdit, jobCardId]);

  const addProductLine = () => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      product_lines: [...prev.product_lines, emptyProductLine(prev.product_lines.length)],
    }));
  };

  const removeProductLine = (index) => {
    setDirty(true);
    setForm((prev) => {
      const lines = prev.product_lines.filter((_, i) => i !== index);
      return {
        ...prev,
        product_lines: lines.length ? lines.map((r, i) => ({ ...r, sl_no: i + 1 })) : [emptyProductLine(0)],
      };
    });
  };

  const patchProductLine = (index, key, value) => {
    setDirty(true);
    setForm((prev) => {
      const lines = [...prev.product_lines];
      const nextRow = { ...lines[index], [key]: value };
      lines[index] =
        key === "quantity" || key === "unit_price" ? recalcProductLine(nextRow) : nextRow;
      return { ...prev, product_lines: lines };
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`product_lines.${index}.${key}`];
      delete next.product_lines;
      return next;
    });
  };

  const addSpecLine = () => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      technical_specifications: [
        ...prev.technical_specifications,
        emptySpecLine(prev.technical_specifications.length),
      ],
    }));
  };

  const removeSpecLine = (index) => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      technical_specifications: prev.technical_specifications
        .filter((_, i) => i !== index)
        .map((r, i) => ({ ...r, sl_no: i + 1 })),
    }));
  };

  const patchSpecLine = (index, key, value) => {
    setDirty(true);
    setForm((prev) => {
      const specs = [...prev.technical_specifications];
      specs[index] = { ...specs[index], [key]: value };
      return { ...prev, technical_specifications: specs };
    });
  };

  const handleCustomerCreated = async (created) => {
    await reloadCustomers();
    if (created) applyCustomerFromMaster(created);
  };

  const handleProductCreated = async (created) => {
    await reloadProducts();
    const idx = addProductRowIndex ?? 0;
    if (created) applyProductToRow(idx, created);
    setAddProductRowIndex(null);
  };

  const handleCancel = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    navigate(backTo);
  };

  const handleSave = async () => {
    if (saving) return;
    if (isEdit && !canEditCard) {
      addToast(
        readOnlySales
          ? "This job card is read-only while it is with Store Manager. Request a correction via Return to Sales."
          : "This job card cannot be edited in its current status.",
        "error"
      );
      return;
    }
    const validation = validateManualForm(form);
    if (Object.keys(validation).length) {
      setErrors(validation);
      scrollToFirstManualFormError(validation);
      addToast("Please fix the highlighted fields.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = buildManualPayload(form, { expectedVersion: recordVersion });
      const res = isEdit
        ? await updateManualJobCard(jobCardId, payload)
        : await createManualJobCard(payload);
      const data = res?.data ?? res;
      if (data?.version != null) setRecordVersion(data.version);
      addToast(
        isEdit
          ? "Job card saved. Use Actions → Send when ready to route it."
          : "Job card created. Status: Saved. Use Actions → Send to route to Store Manager.",
        "success"
      );
      navigate(backTo, { replace: true });
    } catch (err) {
      const detail = extractApiErrorDetail(err);
      const apiErrors = mapApiErrors(detail);
      if (Object.keys(apiErrors).length) {
        setErrors(apiErrors);
        scrollToFirstManualFormError(apiErrors);
      }
      addToast(apiErrorMessage(err, "Failed to save job card."), "error");
    } finally {
      setSaving(false);
    }
  };

  const companyName =
    companyProfile?.company_name || companyProfile?.legal_name || companyProfile?.name || "";
  const companyAddress = formatCompanyAddress(companyProfile);

  useEffect(() => {
    [billingAddressRef.current, dispatchAddressRef.current].forEach((textarea) => {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }, [activeDetailTab, form.customer.billing_address, form.customer.dispatch_address]);

  if (loading) {
    return <LoadingState label="Loading job card…" className="py-16" />;
  }
  if (loadError) {
    return (
      <ErrorState title="Could not load job card" description={loadError} onRetry={() => window.location.reload()} />
    );
  }

  const logoUrl = resolveCompanyLogoUrl(companyProfile);
  const tagline = resolveCompanyTagline(companyProfile);
  const statusDisplay = isEdit ? workflowStatusLabel(workflowStatus) : MANUAL_JOB_CARD_SAVED_STATUS;

  const customerEmptyLabel =
    !mastersLoading && customerOptions.length === 0
      ? canAddCustomer
        ? "No companies found — use Add Company"
        : "No companies found"
      : "Select company…";

  const productEmptyLabel =
    !mastersLoading && productOptions.length === 0
      ? canAddProduct
        ? "No products found — use + Add Product"
        : "No products found"
      : "Select product…";
  const detailTabs = [
    { id: "other", label: "Other Details" },
    { id: "addresses", label: "Addresses" },
    { id: "specifications", label: "Technical Specifications" },
    { id: "approval", label: "Approval" },
  ];

  return (
    <div className="manual-sjc-page ui-stack">
      <QuickAddCustomerModal
        open={showAddCustomer}
        onClose={() => setShowAddCustomer(false)}
        onSaved={handleCustomerCreated}
      />
      <QuickAddProductModal
        open={showAddProduct}
        onClose={() => {
          setShowAddProduct(false);
          setAddProductRowIndex(null);
        }}
        onSaved={handleProductCreated}
      />
      <EditCompanyDetailsModal
        open={editCompanyOpen}
        onClose={() => setEditCompanyOpen(false)}
        onSaved={setCompanyProfile}
      />
      <AddContactPersonModal
        open={showAddContactPerson}
        onClose={() => setShowAddContactPerson(false)}
        onSave={(contact) => {
          setContactPersons((current) => {
            const existing = current.findIndex(
              (person) => person.name.toLowerCase() === contact.name.toLowerCase()
            );
            if (existing < 0) return [...current, contact];
            return current.map((person, index) => (index === existing ? contact : person));
          });
          patch("customer.contact_person", contact.name);
          patch("customer.email", contact.email || "");
          patch("customer.phone", contact.phone || "");
        }}
      />

      <div className="ui-card manual-sjc-page__card">
        <header className="manual-sjc-page__toolbar">
          <div className="manual-sjc-page__toolbar-text">
            <h1 className="manual-sjc-page__toolbar-title">
              {isEdit ? "Edit Sales Job Card" : "Create Sales Job Card"}
            </h1>
            {!isEdit ? (
              <div className="manual-sjc-page__company">
                {companyName || companyAddress || logoUrl ? (
                  <>
                    {logoUrl ? <img src={logoUrl} alt="" className="manual-sjc-page__company-logo" /> : null}
                    <div className="manual-sjc-page__company-text">
                      {companyName ? <span className="manual-sjc-page__company-name">{companyName}</span> : null}
                      {companyAddress ? <span className="manual-sjc-page__company-address">{companyAddress}</span> : null}
                    </div>
                  </>
                ) : null}
                <button
                  type="button"
                  className="manual-sjc-page__company-edit"
                  onClick={() => setEditCompanyOpen(true)}
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden />
                  Edit Company Details
                </button>
              </div>
            ) : null}
            {isEdit && form.job_card_no ? (
              <p className="manual-sjc-page__toolbar-meta">
                {form.job_card_no}
                <span className="manual-sjc__status-pill">{statusDisplay}</span>
              </p>
            ) : null}
          </div>
        </header>

        {mastersError ? (
          <div className="border-b border-[var(--color-border-soft)] bg-red-50 px-4 py-2 text-xs text-red-700">
            {mastersError}
            <Button type="button" variant="ghost" size="sm" className="ml-2 !h-auto !min-h-0 !px-1" onClick={reloadAll}>
              Retry
            </Button>
          </div>
        ) : null}

        {isEdit && !canEditCard ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">
            {readOnlySales
              ? "This job card is with Store Manager and is read-only here. Ask Store Manager to return it to Sales before editing."
              : "This job card cannot be edited in its current workflow status."}
          </div>
        ) : null}

        <div className="manual-sjc-page__body">
          <div className="sjc-doc sjc-doc--screen manual-sjc-form">
            <div className="sjc-doc__paper manual-sjc-page__form-inner">
              {isEdit && (companyName || logoUrl) ? (
                <div className="manual-sjc__company-strip">
                  {logoUrl ? <img src={logoUrl} alt="" className="manual-sjc__company-strip-logo" /> : null}
                  <div className="manual-sjc__company-strip-text">
                    <span className="manual-sjc__company-strip-name">{companyName || "Company"}</span>
                    {companyAddress ? (
                      <span className="manual-sjc__company-strip-address">{companyAddress}</span>
                    ) : null}
                    {tagline ? <span className="manual-sjc__company-strip-tagline">{tagline}</span> : null}
                  </div>
                  {form.job_card_no ? (
                    <span className="manual-sjc__company-strip-jc">{form.job_card_no}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="manual-sjc__form-sections">
              <section
                className="manual-sjc__section manual-sjc__section--block manual-sjc__basic-section"
                aria-labelledby="manual-sjc-customer-order"
              >
                <h3 id="manual-sjc-customer-order" className="manual-sjc__section-title">
                  Customer &amp; Order
                </h3>
                <p className="manual-sjc__section-hint">
                  Select a sales order to automatically fill related information.
                </p>
                <div className="manual-sjc__primary-grid">
                  <FormGridField
                    label="Company Name"
                    required
                    error={errors["customer.customer_name"]}
                    fieldKey="customer.customer_name"
                  >
                    {customerFromOrder && form.customer.customer_name ? (
                      <Input
                        value={form.customer.customer_name}
                        readOnly
                        disabled={!canEditCard}
                        className="sjc-doc__input manual-sjc__input-readonly"
                        title="Filled from the selected sales order"
                      />
                    ) : (
                      <SearchableSelect
                        value={customerSelectValue}
                        onChange={handleCustomerSelect}
                        options={customerOptions}
                        footerOptions={customerFooterOptions}
                        placeholder={mastersLoading ? "Loading companies…" : customerEmptyLabel}
                        searchPlaceholder="Search companies…"
                        allowCustom
                        disabled={mastersLoading || !canEditCard}
                        error={Boolean(errors["customer.customer_name"])}
                        className={compactSelectClass}
                      />
                    )}
                  </FormGridField>

                  <FormGridField
                    label="Sales Order No."
                    required
                    error={errors["header.sales_order_no"]}
                    fieldKey="header.sales_order_no"
                  >
                    <SearchableSelect
                      value={salesOrderSelectValue}
                      onChange={handleSalesOrderSelect}
                      options={salesOrderOptions}
                      placeholder={mastersLoading ? "Loading sales orders…" : "Choose a sales order…"}
                      searchPlaceholder="Search by order number…"
                      menuClassName="!max-h-56"
                      allowCustom
                      disabled={mastersLoading || !canEditCard}
                      error={Boolean(errors["header.sales_order_no"])}
                      className={compactSelectClass}
                    />
                  </FormGridField>

                  <FormGridField
                    label="Job Card Date"
                    required
                    error={errors["header.job_card_date"]}
                    fieldKey="header.job_card_date"
                  >
                    <DatePicker
                      compact
                      value={form.header.job_card_date}
                      onChange={(v) => patch("header.job_card_date", v)}
                      error={errors["header.job_card_date"]}
                      disabled={!canEditCard}
                    />
                  </FormGridField>

                  <FormGridField label="Delivery Date" error={errors["order.delivery_date"]}>
                    <DatePicker
                      compact
                      value={form.order.delivery_date}
                      onChange={(v) => patch("order.delivery_date", v)}
                      error={errors["order.delivery_date"]}
                      disabled={!canEditCard}
                    />
                  </FormGridField>

                  <FormGridField label="Product Category">
                    <SearchableSelect
                      value={form.order.product_category}
                      onChange={(v) => patch("order.product_category", v)}
                      options={categoryOptions}
                      placeholder="Select category…"
                      searchPlaceholder="Search category…"
                      allowCustom
                      disabled={!canEditCard}
                      className={compactSelectClass}
                    />
                  </FormGridField>

                  <FormGridField label="Priority">
                    <Select
                      value={form.order.priority}
                      onChange={(e) => patch("order.priority", e.target.value)}
                      className="sjc-doc__input"
                      disabled={!canEditCard}
                    >
                      {PRIORITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </FormGridField>
                </div>
              </section>

              <div className="manual-sjc__detail-tabs manual-sjc__details-tabs-section" role="tablist" aria-label="Additional job card details">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.id}
                    id={`manual-sjc-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === tab.id}
                    aria-controls={`manual-sjc-panel-${tab.id}`}
                    className={`manual-sjc__detail-tab${activeDetailTab === tab.id ? " is-active" : ""}`}
                    onClick={() => setActiveDetailTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeDetailTab === "other" ? (
              <section
                id="manual-sjc-panel-other"
                role="tabpanel"
                aria-labelledby="manual-sjc-tab-other"
                className="manual-sjc__section manual-sjc__section--block manual-sjc__detail-panel"
              >
                <h3 id="manual-sjc-order-info" className="manual-sjc__section-title">
                  Order Information
                </h3>
                <p className="manual-sjc__section-hint manual-sjc__section-hint--compact">
                  Values from the selected sales order or customer. Adjust if needed before saving.
                </p>
                <div className="manual-sjc__primary-grid manual-sjc__primary-grid--details">
                  <FormGridField label="Customer PO No.">
                    <Input
                      value={form.header.customer_po_no}
                      onChange={(e) => patch("header.customer_po_no", e.target.value)}
                      className="sjc-doc__input"
                      placeholder="From sales order or enter manually"
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Sales Order Date" error={errors["order.sales_order_date"]}>
                    <DatePicker
                      compact
                      value={form.order.sales_order_date}
                      onChange={(v) => patch("order.sales_order_date", v)}
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Contact Person" error={errors["customer.contact_person"]}>
                    <SearchableSelect
                      value={form.customer.contact_person}
                      onChange={(value) => {
                        const selected = contactPersons.find((person) => person.name === value);
                        patch("customer.contact_person", value);
                        if (selected) {
                          if (selected.email) patch("customer.email", selected.email);
                          if (selected.phone) patch("customer.phone", selected.phone);
                        }
                      }}
                      options={contactPersonOptions}
                      footerOptions={contactPersonFooterOptions}
                      onFooterPick={(option) => {
                        if (option.value === ADD_CONTACT_PERSON_VALUE) {
                          setShowAddContactPerson(true);
                        }
                      }}
                      placeholder="Select or enter contact person…"
                      searchPlaceholder="Search contact person…"
                      allowCustom
                      disabled={!canEditCard}
                      className={compactSelectClass}
                    />
                  </FormGridField>
                  <FormGridField label="Phone" error={errors["customer.phone"]}>
                    <Input
                      value={form.customer.phone}
                      onChange={(e) => patch("customer.phone", e.target.value)}
                      className="sjc-doc__input"
                      placeholder="Phone number"
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Company Email" error={errors["customer.email"]}>
                    <Input
                      type="email"
                      value={form.customer.email}
                      onChange={(e) => patch("customer.email", e.target.value)}
                      className="sjc-doc__input"
                      placeholder="Company email address"
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Payment Terms">
                    <div className="manual-sjc__payment-terms-field">
                      <SearchableSelect
                        value={form.order.payment_terms}
                        onChange={(v) => patch("order.payment_terms", v)}
                        options={paymentTermsOptions}
                        placeholder="Payment terms…"
                        searchPlaceholder="Search payment terms…"
                        placement="top"
                        menuClassName="!max-h-56"
                        allowCustom
                        disabled={!canEditCard}
                        className={compactSelectClass}
                      />
                      {showPaymentTermsDescription || form.order.payment_terms_description ? (
                        <div className="manual-sjc__payment-terms-description">
                          <Input
                            value={form.order.payment_terms_description}
                            onChange={(e) => patch("order.payment_terms_description", e.target.value)}
                            className="sjc-doc__input"
                            placeholder="Add payment terms description"
                            disabled={!canEditCard}
                          />
                          {canEditCard ? (
                            <button
                              type="button"
                              className="manual-sjc__description-toggle"
                              onClick={() => {
                                patch("order.payment_terms_description", "");
                                setShowPaymentTermsDescription(false);
                              }}
                            >
                              Remove Description
                            </button>
                          ) : null}
                        </div>
                      ) : canEditCard ? (
                        <button
                          type="button"
                          className="manual-sjc__description-toggle"
                          onClick={() => setShowPaymentTermsDescription(true)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                          Add Description
                        </button>
                      ) : null}
                    </div>
                  </FormGridField>
                </div>
              </section>
              ) : null}

              {activeDetailTab === "addresses" ? (
              <section
                id="manual-sjc-panel-addresses"
                role="tabpanel"
                aria-labelledby="manual-sjc-tab-addresses"
                className="manual-sjc__section manual-sjc__section--block manual-sjc__detail-panel"
              >
                <h3 className="manual-sjc__section-title">Addresses</h3>
                <div className="manual-sjc__address-grid">
                  <FormGridField label="Billing Address">
                    <Textarea
                      inputRef={billingAddressRef}
                      rows={2}
                      wrap="soft"
                      value={form.customer.billing_address}
                      onChange={(e) => patch("customer.billing_address", e.target.value)}
                      className="sjc-doc__input manual-sjc__textarea"
                      placeholder="Billing address"
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Dispatch Address">
                    <Textarea
                      inputRef={dispatchAddressRef}
                      rows={2}
                      wrap="soft"
                      value={form.customer.dispatch_address}
                      onChange={(e) => patch("customer.dispatch_address", e.target.value)}
                      className="sjc-doc__input manual-sjc__textarea"
                      placeholder="Dispatch address"
                      disabled={!canEditCard}
                    />
                  </FormGridField>
                  <FormGridField label="Company Address">
                    <div className="sjc-doc__input manual-sjc__company-address-value">
                      {companyAddress || "Company address from settings"}
                    </div>
                  </FormGridField>
                </div>
              </section>
              ) : null}

              <section className="manual-sjc__section manual-sjc__section--lines manual-sjc__product-section" aria-labelledby="manual-sjc-products">
                <h3 id="manual-sjc-products" className="manual-sjc__section-title">
                  Product / Job Details*
                </h3>
              <div className="sjc-doc__table-wrap manual-sjc__pricing-table-wrap" data-manual-field="product_lines">
                {errors.product_lines ? <FieldError error={errors.product_lines} /> : null}
                <table className="sjc-doc__table manual-sjc__editable-table manual-sjc__pricing-table">
                  <colgroup>
                    <col className="manual-sjc__pricing-col--number" />
                    <col className="manual-sjc__pricing-col--product" />
                    <col className="manual-sjc__pricing-col--quantity" />
                    <col className="manual-sjc__pricing-col--uom" />
                    <col className="manual-sjc__pricing-col--price" />
                    <col className="manual-sjc__pricing-col--amount" />
                    <col className="manual-sjc__pricing-col--action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Sl. No.</th>
                      <th>Product</th>
                      <th className="num">Quantity</th>
                      <th>UOM</th>
                      <th className="num">Price</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.product_lines.map((row, index) => {
                      const calc = lineTotals.rows[index] || recalcProductLine(row);
                      return (
                        <tr key={index}>
                          <td className="num">{index + 1}</td>
                          <td data-manual-field={`product_lines.${index}.product_name`}>
                            <SearchableSelect
                              value={getProductSelectValue(row)}
                              onChange={(val) => handleProductSelect(index, val)}
                              options={productOptions}
                              footerOptions={productFooterOptions}
                              placeholder={mastersLoading ? "Loading…" : productEmptyLabel}
                              searchPlaceholder="Search product…"
                              clearable
                              clearAriaLabel="Clear selected product"
                              allowCustom
                              disabled={mastersLoading || !canEditCard}
                              error={Boolean(errors[`product_lines.${index}.product_name`])}
                              className={compactSelectClass}
                            />
                            <FieldError error={errors[`product_lines.${index}.product_name`]} />
                          </td>
                          <td className="num">
                            <Input
                              type="number"
                              min="0.001"
                              step="any"
                              value={row.quantity}
                              onWheel={(e) => e.currentTarget.blur()}
                              onChange={(e) => patchProductLine(index, "quantity", e.target.value)}
                              error={errors[`product_lines.${index}.quantity`]}
                              className="sjc-doc__input"
                              disabled={!canEditCard}
                            />
                          </td>
                          <td>
                            <SearchableSelect
                              value={row.uom}
                              onChange={(v) => patchProductLine(index, "uom", v)}
                              options={uomOptions}
                              placeholder="Select UOM…"
                              searchPlaceholder="Search UOM…"
                              menuClassName="manual-sjc__uom-menu"
                              allowCustom
                              disabled={!canEditCard}
                              error={Boolean(errors[`product_lines.${index}.uom`])}
                              className={compactSelectClass}
                            />
                            <FieldError error={errors[`product_lines.${index}.uom`]} />
                          </td>
                          <td className="num" data-manual-field={`product_lines.${index}.unit_price`}>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.unit_price}
                              onWheel={(e) => e.currentTarget.blur()}
                              onChange={(e) => patchProductLine(index, "unit_price", e.target.value)}
                              error={errors[`product_lines.${index}.unit_price`]}
                              className="sjc-doc__input"
                              disabled={!canEditCard}
                            />
                          </td>
                          <td className="num manual-sjc__amount-cell manual-sjc__amount-cell--total">
                            {formatInr(calc.line_amount)}
                          </td>
                          <td>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="manual-sjc__remove-product-button"
                              onClick={() => removeProductLine(index)}
                              aria-label="Remove product row"
                              disabled={!canEditCard}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="manual-sjc__line-summary">
                  <div className="manual-sjc__line-summary-row">
                    <span>Total Quantity</span>
                    <span>{lineTotals.totalQuantity}</span>
                  </div>
                  <div className="manual-sjc__line-summary-row manual-sjc__line-summary-row--total">
                    <span>Total Amount</span>
                    <span>{formatInr(lineTotals.totalAmount)}</span>
                  </div>
                </div>
                <div className="manual-sjc__add-row">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addProductLine}
                    leftIcon={<Plus className="h-4 w-4" />}
                    disabled={!canEditCard}
                  >
                    Add New Row
                  </Button>
                </div>
              </div>
              </section>

              {activeDetailTab === "specifications" ? (
              <section
                id="manual-sjc-panel-specifications"
                role="tabpanel"
                aria-labelledby="manual-sjc-tab-specifications"
                className="manual-sjc__section manual-sjc__section--lines manual-sjc__detail-panel"
              >
                <h3 id="manual-sjc-specs" className="manual-sjc__section-title">
                  Technical Specifications
                </h3>
              <div className="sjc-doc__table-wrap">
                <table className="sjc-doc__table manual-sjc__editable-table">
                  <thead>
                    <tr>
                      <th>Sl. No.</th>
                      <th>Parameter</th>
                      <th>Specification</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.technical_specifications.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="manual-sjc__empty-spec">
                          No specifications added yet.
                        </td>
                      </tr>
                    ) : (
                      form.technical_specifications.map((row, index) => (
                        <tr key={index}>
                          <td className="num">{index + 1}</td>
                          <td>
                            <SearchableSelect
                              value={row.parameter}
                              onChange={(v) => patchSpecLine(index, "parameter", v)}
                              options={specParameterOptions}
                              placeholder="Select / enter parameter…"
                              searchPlaceholder="Search parameter…"
                              allowCustom
                              className={compactSelectClass}
                            />
                          </td>
                          <td>
                            <Input
                              value={row.specification}
                              onChange={(e) => patchSpecLine(index, "specification", e.target.value)}
                              className="sjc-doc__input"
                              placeholder="Enter specification"
                            />
                          </td>
                          <td>
                            <Button
                              type="button"
                              variant="danger"
                              size="icon"
                              onClick={() => removeSpecLine(index)}
                              aria-label="Remove specification"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="manual-sjc__add-row">
                  <Button variant="outline" size="sm" onClick={addSpecLine} leftIcon={<Plus className="h-4 w-4" />}>
                    Add Specification
                  </Button>
                </div>
              </div>
              </section>
              ) : null}

              {activeDetailTab === "approval" ? (
              <section
                id="manual-sjc-panel-approval"
                role="tabpanel"
                aria-labelledby="manual-sjc-tab-approval"
                className="manual-sjc__section manual-sjc__section--approval manual-sjc__detail-panel"
              >
                <h3 id="manual-sjc-approval" className="manual-sjc__section-title">
                  Approval
                </h3>
              <div className="sjc-doc__approval manual-sjc__approval-edit">
                <table className="sjc-doc__table">
                  <thead>
                    <tr>
                      <th>Prepared By</th>
                      <th>Checked By</th>
                      <th>Approved By</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <Input
                          value={form.approval.prepared_by}
                          onChange={(e) => patch("approval.prepared_by", e.target.value)}
                          className="sjc-doc__input"
                        />
                      </td>
                      <td>
                        <Input
                          value={form.approval.checked_by}
                          onChange={(e) => patch("approval.checked_by", e.target.value)}
                          className="sjc-doc__input"
                        />
                      </td>
                      <td>
                        <Input
                          value={form.approval.approved_by}
                          onChange={(e) => patch("approval.approved_by", e.target.value)}
                          className="sjc-doc__input"
                        />
                      </td>
                      <td>
                        <DatePicker
                          compact
                          value={form.approval.prepared_date}
                          onChange={(v) => patch("approval.prepared_date", v)}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              </section>
              ) : null}

              </div>

              <div className="manual-sjc__form-actions" aria-label="Job card actions">
                <div className="manual-sjc__form-actions-row">
                  <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={saving}
                    disabled={saving || (isEdit && !canEditCard)}
                    onClick={handleSave}
                    leftIcon={<Save className="h-4 w-4" aria-hidden />}
                  >
                    {saving
                      ? isEdit
                        ? "Saving…"
                        : "Creating…"
                      : isEdit
                        ? "Save Job Card"
                        : "Create Job Card"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}