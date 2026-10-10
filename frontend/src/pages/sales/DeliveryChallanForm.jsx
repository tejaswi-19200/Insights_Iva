import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Building2, ChevronDown, FileText, Grid2x2, GripVertical, ImagePlus, MapPin, Package, PenLine, Plane, Plus, Ban, Search, Ship, TrainFront, Trash2, Truck, User, X } from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import AddBankAccountModal from "../../components/sales/AddBankAccountModal";
import AddCustomFieldModal from "../../components/sales/AddCustomFieldModal";
import AddNewItemModal from "../../components/sales/AddNewItemModal";
import AddNewPartyModal from "../../components/sales/AddNewPartyModal";
import AddInvoiceDiscountModal from "../../components/sales/AddInvoiceDiscountModal";
import AddOtherChargesModal, {
  computeOtherChargeTotal,
} from "../../components/sales/AddOtherChargesModal";
import AddNoteModal from "../../components/sales/AddNoteModal";
import AddPrefixModal from "../../components/sales/AddPrefixModal";
import AddTermsAndConditionsModal from "../../components/sales/AddTermsAndConditionsModal";
import AddTransporterDetailsModal from "../../components/sales/AddTransporterDetailsModal";
import DispatchAddressPicker from "../../components/sales/DispatchAddressPicker";
import EditCompanyDetailsModal from "../../components/sales/EditCompanyDetailsModal";
import SignatureAndStampPanel from "../../components/sales/SignatureAndStampPanel";
import TermsAndConditionsPicker, {
  DEFAULT_TERMS_BODY,
} from "../../components/sales/TermsAndConditionsPicker";
import { createInvoice, getInvoiceDetail, updateInvoice } from "../../api/salesApi";
import { apiErrorMessage } from "../../utils/apiError";
import { getCompanySettings, updateCompanySettings } from "../../api/settingsApi";
import useTenantId from "../../hooks/useTenantId";
import { useToast } from "../../context/ToastContext";
import {
  customerToConsigneeFields,
  fetchCustomersWithFallback,
  filterCustomers,
  resolveCustomerId,
} from "../../utils/customerOptions";
import {
  MANUFACTURING_EVENTS,
  notifyManufacturingSpine,
} from "../../utils/manufacturingEvents";
import {
  ERP_PRIMARY,
  ERP_PRIMARY_SOFT,
  FieldLabel,
  SoftInput,
  SoftSelect,
  Pill,
} from "../../design-system/erpFormControls";

const YELLOW = "var(--color-primary)";
const PREFIX_STORAGE_KEY = "gns_invoice_prefixes";
const DEFAULT_PREFIXES = ["DC", "DC-"];
const ADD_PREFIX_VALUE = "__add_prefix__";

function loadCustomPrefixes() {
  try {
    const raw = localStorage.getItem(PREFIX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomPrefixes(list) {
  try {
    localStorage.setItem(PREFIX_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

const emptyItem = () => ({
  item_description: "",
  hsn: "",
  qty: "",
  unit: "",
  rate: "",
  tax_type: "Exclusive",
  discount: "",
  discount_type: "₹",
  gst_pct: "",
  amount: 0,
});

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineTotals(row) {
  const qty = Number(row.qty) || 0;
  const rate = Number(row.rate) || 0;
  let discount = Number(row.discount) || 0;
  if (row.discount_type === "%" && discount > 0) {
    discount = money((qty * rate * discount) / 100);
  }
  const gstPct = Number(row.gst_pct) || 0;
  let taxable = money(qty * rate - discount);
  if (String(row.tax_type).toLowerCase() === "inclusive" && gstPct > 0) {
    taxable = money(taxable / (1 + gstPct / 100));
  }
  const gst = money((taxable * gstPct) / 100);
  return { taxable, gst, total: money(taxable + gst) };
}

const TRANSPORT_MODES = [
  { id: "Road", label: "Road", Icon: Truck },
  { id: "Rail", label: "Rail", Icon: TrainFront },
  { id: "Air", label: "Air", Icon: Plane },
  { id: "Ship/Road Cum Ship", label: "Ship/Road Cum Ship", Icon: Ship },
  { id: "Not Applicable", label: "Not-Applicable", Icon: Ban },
];

function transportDocLabels(mode) {
  if (mode === "Rail") {
    return { number: "RR Number", numberPh: "Enter RR Number", date: "RR Date" };
  }
  if (mode === "Air") {
    return {
      number: "Airway Bill Number",
      numberPh: "Enter Airway Bill Number",
      date: "Airway Bill Date",
    };
  }
  if (mode === "Ship/Road Cum Ship") {
    return {
      number: "Lading Number",
      numberPh: "Enter Lading Number",
      date: "Lading Date",
    };
  }
  return { number: "LR Number", numberPh: "Enter LR Number", date: "LR Date" };
}

function showsVehicleNo(mode) {
  return mode === "Road" || mode === "Ship/Road Cum Ship" || mode === "Not Applicable";
}

function SectionHeader({ icon: Icon, title, children, className = "", collapsible, open, onToggle }) {
  const titleRow = (
    <div className="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-slate-800">
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span className="truncate">{title}</span>
      {collapsible ? (
        <ChevronDown
          className={`ml-0.5 h-4 w-4 shrink-0 text-[#6b6b76] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      ) : null}
    </div>
  );

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b border-[#d0d0d8] px-4 py-3 ${className}`}
      style={{ background: ERP_PRIMARY_SOFT }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center text-left"
          aria-expanded={Boolean(open)}
        >
          {titleRow}
        </button>
      ) : (
        titleRow
      )}
      {children ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Delhi",
  "Gujarat",
  "Karnataka",
  "Maharashtra",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "West Bengal",
];

export default function DeliveryChallanForm() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [company, setCompany] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showBuyerPicker, setShowBuyerPicker] = useState(false);
  const [dispatchAddress, setDispatchAddress] = useState(null);
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [addBuyerOpen, setAddBuyerOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [otherChargeOpen, setOtherChargeOpen] = useState(false);
  const [otherChargeMeta, setOtherChargeMeta] = useState(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMeta, setDiscountMeta] = useState(null);
  const [transportOpen, setTransportOpen] = useState(true);
  const [otherDetailsOpen, setOtherDetailsOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);
  const [termsAttached, setTermsAttached] = useState(true);
  const [termsPickerOpen, setTermsPickerOpen] = useState(false);
  const [termsAddOpen, setTermsAddOpen] = useState(false);
  const [transporterModalOpen, setTransporterModalOpen] = useState(false);
  const [customFieldOpen, setCustomFieldOpen] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [bankAccount, setBankAccount] = useState(null);
  const [challanType, setChallanType] = useState("");
  const [notesText, setNotesText] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [prefixModalOpen, setPrefixModalOpen] = useState(false);
  const [customPrefixes, setCustomPrefixes] = useState(loadCustomPrefixes);
  const [signatureOn, setSignatureOn] = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_signature_data") || null; } catch { return null; }
  });
  const [stampDataUrl, setStampDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_stamp_data") || null; } catch { return null; }
  });
  const [form, setForm] = useState({
    tenant_id: tenantId,
    customer_id: "",
    sales_order_id: searchParams.get("sales_order_id")
      ? Number(searchParams.get("sales_order_id"))
      : null,
    invoice_prefix: "",
    invoice_number: "1",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    discount: 0,
    other_charge: 0,
    round_off: 0,
    consignee_name: "",
    consignee_address1: "",
    consignee_address2: "",
    consignee_state: "",
    consignee_state_code: "",
    consignee_gstin: "",
    notes: DEFAULT_TERMS_BODY,
    transport_mode: "Road",
    lr_number: "",
    lr_date: "",
    vehicle_no: "",
    distance_km: 0,
    transporter_name: "",
    transporter_id: "",
    place_of_supply: "",
    date_of_supply: "",
    supply_type: "Job work",
    po_number: "",
    po_date: "",
    challan_number: "",
    ewaybill_number: "",
    sales_person: "",
    reverse_charge: false,
  });
  const [items, setItems] = useState([emptyItem(), emptyItem(), emptyItem()]);
  const [dragRowIdx, setDragRowIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [custRes, companyRes] = await Promise.allSettled([
          fetchCustomersWithFallback(),
          getCompanySettings(),
        ]);
        if (cancelled) return;
        setCustomers(custRes.status === "fulfilled" ? custRes.value || [] : []);
        const co = companyRes.status === "fulfilled" ? companyRes.value?.data || null : null;
        setCompany(co);
        if (co) {
          if (co.stamp_url) {
            setStampDataUrl((prev) => prev || co.stamp_url);
            try {
              if (!localStorage.getItem("gns_invoice_stamp_data")) {
                localStorage.setItem("gns_invoice_stamp_data", co.stamp_url);
              }
            } catch {}
          }
          if (co.signature_url) {
            setSignatureDataUrl((prev) => prev || co.signature_url);
            try {
              if (!localStorage.getItem("gns_invoice_signature_data")) {
                localStorage.setItem("gns_invoice_signature_data", co.signature_url);
              }
            } catch {}
          }
        }
        if (co?.invoice_prefix) {
          setForm((f) => (f.invoice_prefix ? f : { ...f, invoice_prefix: co.invoice_prefix }));
        }
        if (co?.bank_name) {
          setBankAccount({
            ifsc: co.bank_ifsc || "",
            bank_name: co.bank_name || "",
            account_holder: "",
            account_number: co.bank_account_number || "",
            branch_name: co.bank_branch || "",
            upi_id: "",
            show_upi_qr: true,
            notes: null,
          });
        }
        if (editId) {
          const detail = await getInvoiceDetail(editId);
          const inv = detail?.data?.invoice || detail?.data;
          if (!inv) throw new Error("Document not found");
          const num = String(inv.invoice_number || "");
          const prefix = inv.invoice_prefix || "";
          const numberOnly =
            prefix && num.startsWith(prefix)
              ? num.slice(prefix.length)
              : num.replace(/^[A-Za-z-]+/, "") || num;
          setSignatureOn(Boolean(inv.show_signature));
          if (inv.stamp_url) setStampDataUrl(inv.stamp_url);
          if (inv.signature_url) setSignatureDataUrl(inv.signature_url);
          if (inv.terms_and_conditions) setTermsAttached(true);
          setForm((f) => ({
            ...f,
            customer_id: inv.customer_id || "",
            sales_order_id: inv.sales_order_id || null,
            invoice_prefix: prefix,
            invoice_number: numberOnly || "1",
            issue_date: inv.issue_date ? String(inv.issue_date).slice(0, 10) : f.issue_date,
            due_date: inv.due_date ? String(inv.due_date).slice(0, 10) : "",
            discount: Number(inv.discount || 0),
            other_charge: Number(inv.other_charge || 0),
            round_off: Number(inv.round_off || 0),
            notes: inv.terms_and_conditions || inv.notes || f.notes,
            transport_mode: inv.transport_mode || "Road",
            lr_number: inv.lr_number || "",
            lr_date: inv.lr_date ? String(inv.lr_date).slice(0, 10) : "",
            vehicle_no: inv.vehicle_no || "",
            distance_km: inv.distance_km || 0,
            transporter_name: inv.transporter_name || "",
            place_of_supply: inv.place_of_supply || "",
            date_of_supply: inv.date_of_supply ? String(inv.date_of_supply).slice(0, 10) : "",
            supply_type: inv.supply_type || f.supply_type || "B2B",
            po_number: inv.po_number || "",
            po_date: inv.po_date ? String(inv.po_date).slice(0, 10) : "",
            challan_number: inv.challan_number || "",
            ewaybill_number: inv.ewaybill_number || "",
            sales_person: inv.sales_person || "",
            reverse_charge: Boolean(inv.reverse_charge),
          }));
          const lineItems = (inv.items || [])
            .filter((it) => String(it.item_description || "").toLowerCase() !== "other charge")
            .map((it) => ({
              ...emptyItem(),
              item_description: it.item_description || "",
              hsn: it.hsn || "",
              qty: it.qty ?? 0,
              unit: it.unit || "pcs",
              rate: it.rate ?? 0,
              tax_type: it.tax_type || "Exclusive",
              discount: it.discount ?? 0,
              discount_type: it.discount_type || "₹",
              gst_pct: it.gst_pct ?? 0,
            }));
          setItems(lineItems.length ? lineItems : [emptyItem(), emptyItem(), emptyItem()]);
        }
      } catch (err) {
        if (!cancelled) {
          addToast(apiErrorMessage(err, "Failed to load document"), "error");
          if (editId) navigate("/sales/delivery-challans");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, addToast, navigate]);

  const filteredCustomers = useMemo(
    () => filterCustomers(customers, customerSearch),
    [customers, customerSearch]
  );

  const selectedBuyer = customers.find((c) => String(c.id) === String(form.customer_id));

  const prefixOptions = useMemo(() => {
    const set = new Set([
      ...DEFAULT_PREFIXES,
      ...customPrefixes,
      ...(company?.invoice_prefix ? [company.invoice_prefix] : []),
      ...(form.invoice_prefix ? [form.invoice_prefix] : []),
    ]);
    return [...set].filter(Boolean);
  }, [customPrefixes, company?.invoice_prefix, form.invoice_prefix]);

  const resetInvoiceData = () => {
    setCustomerSearch("");
    setShowBuyerPicker(false);
    setDispatchAddress(null);
    setOtherChargeMeta(null);
    setDiscountMeta(null);
    setCustomFields([]);
    setSignatureDataUrl(() => {
      try { return localStorage.getItem("gns_invoice_signature_data") || company?.signature_url || null; } catch { return null; }
    });
    setStampDataUrl(() => {
      try { return localStorage.getItem("gns_invoice_stamp_data") || company?.stamp_url || null; } catch { return null; }
    });
    setSignatureOn(true);
    setTermsAttached(true);
    setTermsOpen(true);
    setNotesText("");
    setChallanType("");
    setItems([emptyItem(), emptyItem(), emptyItem()]);
    setForm((f) => ({
      ...f,
      customer_id: "",
      sales_order_id: null,
      discount: 0,
      other_charge: 0,
      round_off: 0,
      consignee_name: "",
      consignee_address1: "",
      consignee_address2: "",
      consignee_state: "",
      consignee_state_code: "",
      consignee_gstin: "",
      notes: DEFAULT_TERMS_BODY,
      transport_mode: "Road",
      lr_number: "",
      lr_date: "",
      vehicle_no: "",
      distance_km: 0,
      transporter_name: "",
      transporter_id: "",
      place_of_supply: "",
      date_of_supply: "",
      supply_type: "Job work",
      po_number: "",
      po_date: "",
      challan_number: "",
      ewaybill_number: "",
      sales_person: "",
      reverse_charge: false,
    }));
  };

  const handleCustomerChange = (customerId) => {
    const customer = customers.find((c) => String(c.id) === String(customerId));
    setForm((f) => ({
      ...f,
      customer_id: customerId,
      ...customerToConsigneeFields(customer),
    }));
    setShowBuyerPicker(false);
  };

  const updateItem = (idx, field, val) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      next[idx].amount = lineTotals(next[idx]).total;
      return next;
    });
  };

  const removeItem = (idx) => {
    setItems((prev) => (prev.length <= 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx)));
  };

  const filledItems = items.filter((i) => i.item_description?.trim());
  const taxableAmount = filledItems.reduce((s, i) => s + lineTotals(i).taxable, 0);
  const gstAmount = filledItems.reduce((s, i) => s + lineTotals(i).gst, 0);
  const itemsTotal = filledItems.reduce((s, i) => s + lineTotals(i).total, 0);
  const otherCharge = Number(form.other_charge) || 0;
  const invoiceDiscount = Number(form.discount) || 0;
  const finalAmount = money(itemsTotal + otherCharge - invoiceDiscount + (Number(form.round_off) || 0));

  const useIgst = false;
  const sgstPct = useIgst ? 0 : 9;
  const cgstPct = useIgst ? 0 : 9;
  const igstPct = useIgst ? 18 : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer_id) {
      addToast("Please select a buyer", "error");
      setShowBuyerPicker(true);
      return;
    }
    if (filledItems.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    setSaving(true);
    try {
      const customerId = await resolveCustomerId(form.customer_id, customers, tenantId);
      const payload = {
        tenant_id: form.tenant_id,
        customer_id: customerId,
        sales_order_id: form.sales_order_id || null,
        document_type: "delivery_challan",
        invoice_prefix: form.invoice_prefix || null,
        invoice_number: form.invoice_number || String(Date.now()).slice(-6),
        issue_date: form.issue_date,
        due_date: form.due_date || null,
        discount: invoiceDiscount,
        other_charge: otherCharge,
        round_off: Number(form.round_off) || 0,
        sgst_pct: sgstPct,
        cgst_pct: cgstPct,
        igst_pct: igstPct,
        status: "issued",
        transport_mode: form.transport_mode || null,
        lr_number: form.lr_number || null,
        lr_date: form.lr_date || null,
        vehicle_no: form.vehicle_no || null,
        distance_km: form.distance_km ? Number(form.distance_km) : null,
        transporter_name: form.transporter_name || null,
        place_of_supply: form.place_of_supply || null,
        date_of_supply: form.date_of_supply || null,
        supply_type: form.supply_type || null,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        challan_number: form.challan_number || null,
        ewaybill_number: form.ewaybill_number || null,
        sales_person: form.sales_person || null,
        reverse_charge: Boolean(form.reverse_charge),
        terms_and_conditions: termsAttached ? form.notes || null : null,
        show_signature: Boolean(signatureOn),
        custom_fields: [
          ...(challanType ? [{ label: "Challan Type", value: challanType }] : []),
          ...customFields.map((f) => ({ label: f.label, value: f.value })),
        ],
        notes: [
          ...(challanType ? [`Challan Type: ${challanType}`] : []),
          ...(notesText ? [`Notes:\n${notesText}`] : []),
          ...customFields.map((f) => `${f.label}: ${f.value}`),
          bankAccount
            ? [
                "Bank Details:",
                bankAccount.bank_name,
                bankAccount.account_holder,
                bankAccount.account_number
                  ? `A/C: ${bankAccount.account_number}`
                  : null,
                [bankAccount.ifsc, bankAccount.branch_name].filter(Boolean).join(" · ") ||
                  null,
                bankAccount.upi_id
                  ? `UPI: ${bankAccount.upi_id}${
                      bankAccount.show_upi_qr ? " (QR on invoice)" : ""
                    }`
                  : null,
                bankAccount.notes,
              ]
                .filter(Boolean)
                .join("\n")
            : null,
        ]
          .filter(Boolean)
          .join("\n") || null,
        items: filledItems.map((i) => {
          const t = lineTotals(i);
          return {
            item_description: i.item_description.trim(),
            hsn: i.hsn || null,
            qty: Number(i.qty) || 0,
            unit: i.unit || "pcs",
            rate: Number(i.rate) || 0,
            tax_type: i.tax_type || "Exclusive",
            discount: Number(i.discount) || 0,
            discount_type: i.discount_type || "₹",
            gst_pct: Number(i.gst_pct) || 0,
            taxable_value: t.taxable,
            gst_amount: t.gst,
            amount: t.total,
          };
        }),
      };
      if (isEdit) {
        await updateInvoice(editId, payload);
        addToast("Delivery challan updated");
      } else {
        const res = await createInvoice(payload);
        notifyManufacturingSpine(MANUFACTURING_EVENTS.INVOICE_CREATED, {
          invoice_id: res.data?.id,
          sales_order_id: form.sales_order_id,
        });
        addToast("Delivery challan created");
      }
      navigate("/sales/delivery-challans");
    } catch (err) {
      console.error(err);
      addToast(apiErrorMessage(err, "Failed to save invoice"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center bg-[#F5F5F5]">
        <Loader label="Loading…" />
      </div>
    );
  }

  const companyName = company?.company_name || company?.name || "My Company";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full min-h-0 flex-col bg-[#F5F5F5]"
    >
      {/* Sticky header — matches screenshot */}
      <div className="flex shrink-0 items-center justify-end gap-3 border-b border-[#e4e4ea] bg-white px-5 py-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/sales/delivery-challans")}
            className="rounded-lg border border-[#d0d0d8] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a4a55] hover:bg-[#F5F5F5]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg px-5 py-2 text-[13px] font-semibold text-white shadow-sm disabled:opacity-60"
            style={{ background: YELLOW }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] space-y-4 p-5 pb-10">
          {/* Top: invoice type + supplier */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
          <section className="rounded-xl border border-[#d0d0d8] bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>Delivery Challan Prefix</FieldLabel>
                <SoftSelect
                  value={form.invoice_prefix}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === ADD_PREFIX_VALUE) {
                      setPrefixModalOpen(true);
                      return;
                    }
                    setForm((f) => ({ ...f, invoice_prefix: v }));
                  }}
                >
                  <option value="">No Prefix</option>
                  {prefixOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option
                    value={ADD_PREFIX_VALUE}
                    className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4] dark:text-[#2dd4bf] dark:bg-[#0d3d38]"
                    style={{ color: "#036f71", fontWeight: "600" }}
                  >
                    + Add New Prefix
                  </option>
                </SoftSelect>
              </label>
              <label className="block">
                <FieldLabel>Delivery Challan No.</FieldLabel>
                <SoftInput
                  value={form.invoice_number}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
                />
              </label>
              <label className="block">
                <FieldLabel>Delivery Challan Date</FieldLabel>
                <SoftInput
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
                />
              </label>
              <label className="block">
                <FieldLabel>Challan Type</FieldLabel>
                <SoftSelect
                  value={challanType}
                  onChange={(e) => setChallanType(e.target.value)}
                >
                  <option value="">Select Challan Type</option>
                  <option value="Job Work">Job Work</option>
                  <option value="Sales On Approval">Sales On Approval</option>
                  <option value="Return">Return</option>
                  <option value="Others">Others</option>
                </SoftSelect>
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={Building2} title="Supplier Details" />
            <div className="flex items-start justify-between gap-4 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-[#1a1a1f]">{companyName}</p>
                  <button
                    type="button"
                    onClick={() => setEditCompanyOpen(true)}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    Edit Company Details
                  </button>
                </div>
                <DispatchAddressPicker value={dispatchAddress} onChange={setDispatchAddress} />
                {dispatchAddress ? (
                  <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-[#6b6b76]">
                    {[dispatchAddress.address, dispatchAddress.city, dispatchAddress.state, dispatchAddress.pincode]
                      .filter(Boolean)
                      .join(", ")}
                    {dispatchAddress.gstin ? ` · ${dispatchAddress.gstin}` : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setEditCompanyOpen(true)}
                className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-full border border-dashed border-[#c4c4cc] bg-[#fafafa] text-[10px] text-[#9a9aa5]"
              >
                {company?.logo_url ? (
                  <img
                    src={company.logo_url}
                    alt="Logo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <ImagePlus className="mb-1 h-5 w-5" />
                    Add Logo
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* Buyer */}
        <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
          <SectionHeader icon={User} title="Buyer Details">
            <button
              type="button"
              onClick={() => setShowBuyerPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
              style={{ background: ERP_PRIMARY }}
            >
              <User className="h-3.5 w-3.5" />
              Select Buyer
            </button>
            <button
              type="button"
              onClick={() => setAddBuyerOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-[#d0d0d8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4a4a55]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Buyer
            </button>
          </SectionHeader>
          <div className="min-h-[88px] border-t-0 p-4">
            {showBuyerPicker && (
              <div className="mb-3 rounded-lg border border-[#e4e4ea] bg-[#fafafa] p-3">
                <SearchBar
                  size="compact"
                  value={customerSearch}
                  onChange={setCustomerSearch}
                  placeholder="Search"
                  className="mb-2 w-full"
                />
                <div className="max-h-44 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <p className="p-2 text-[13px] text-[#8a8a95]">
                      No buyers found.{" "}
                      <button
                        type="button"
                        onClick={() => setAddBuyerOpen(true)}
                        className="font-medium"
                        style={{ color: ERP_PRIMARY }}
                      >
                        Add a buyer
                      </button>
                    </p>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCustomerChange(c.id)}
                        className={`block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-white ${
                          String(form.customer_id) === String(c.id) ? "bg-white font-semibold" : ""
                        }`}
                      >
                        {c.name}
                        {c.gstin ? ` · ${c.gstin}` : ""}
                        {c.state ? ` · ${c.state}` : ""}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            {selectedBuyer ? (
              <div className="grid gap-1 text-[13px] sm:grid-cols-2">
                <p className="font-semibold text-[#1a1a1f]">{selectedBuyer.name}</p>
                <p className="text-[#6b6b76]">{selectedBuyer.gstin || "—"}</p>
                <p className="text-[#6b6b76] sm:col-span-2">
                  {[form.consignee_address1, form.consignee_address2, form.consignee_state]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
            ) : (
              <p className="py-4 text-center text-[13px] text-[#a0a0ab]">Select a buyer to continue</p>
            )}
          </div>
        </section>

        {/* Items */}
        <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
          <SectionHeader icon={Package} title="Item Details">
            <button
              type="button"
              onClick={() => setAddItemOpen(true)}
              className="rounded-lg border border-[#d0d0d8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4a4a55]"
            >
              + Add New Item
            </button>
          </SectionHeader>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-[12px]">
              <thead className="ui-table-head">
                <tr>
                  {["S.No", "Item Name", "HSN", "Qty Unit", "Price", "Tax Type", "Discount", "Taxable Value", "GST", "Total Amt", ""].map(
                    (h, hi) => (
                      <th key={`${h}-${hi}`} className="whitespace-nowrap border-b border-r border-[#d0d0d8] px-2 py-2.5 font-semibold last:border-r-0">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => {
                  const t = lineTotals(row);
                  const hasDesc = Boolean(row.item_description?.trim());
                  return (
                    <tr
                      key={idx}
                      draggable
                      onDragStart={(e) => {
                        setDragRowIdx(idx);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(idx));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceIdx = dragRowIdx !== null ? dragRowIdx : parseInt(e.dataTransfer.getData("text/plain"), 10);
                        if (isNaN(sourceIdx) || sourceIdx === idx) return;
                        setItems((prev) => {
                          const updated = [...prev];
                          const [removed] = updated.splice(sourceIdx, 1);
                          updated.splice(idx, 0, removed);
                          return updated;
                        });
                        setDragRowIdx(null);
                      }}
                      onDragEnd={() => setDragRowIdx(null)}
                      className={`transition-colors ${dragRowIdx === idx ? "opacity-40 bg-blue-50/50" : ""}`}
                    >
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 text-[#9a9aa5]">
                        <div className="flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder row">
                          <GripVertical className="h-3.5 w-3.5 text-[#a0a0ab] hover:text-blue-600 shrink-0" />
                          <span>{idx + 1}</span>
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <div className="relative min-w-[160px]">
                          <SearchBar
                            size="compact"
                            value={row.item_description}
                            onChange={(v) => updateItem(idx, "item_description", v)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                              }
                            }}
                            placeholder="Select Item"
                            clearable={false}
                            className="w-full"
                          />
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <input
                          value={row.hsn}
                          onChange={(e) => updateItem(idx, "hsn", e.target.value)}
                          className="w-16 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        />
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            value={row.qty}
                            onChange={(e) => updateItem(idx, "qty", e.target.value)}
                            placeholder="0"
                            className="w-14 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                          />
                          <select
                            value={row.unit}
                            onChange={(e) => updateItem(idx, "unit", e.target.value)}
                            className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5"
                          >
                            <option value="">Unit</option>
                            <option value="pcs">pcs</option>
                            <option value="KGS">KGS</option>
                            <option value="MT">MT</option>
                          </select>
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <span className="text-[#9a9aa5]">₹</span>
                          <input
                            type="number"
                            value={row.rate}
                            onChange={(e) => updateItem(idx, "rate", e.target.value)}
                            className="w-20 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                          />
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <select
                          value={row.tax_type}
                          onChange={(e) => updateItem(idx, "tax_type", e.target.value)}
                          className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        >
                          <option>Exclusive</option>
                          <option>Inclusive</option>
                        </select>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <div className="flex gap-1">
                          <input
                            type="number"
                            value={row.discount}
                            onChange={(e) => updateItem(idx, "discount", e.target.value)}
                            className="w-14 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                          />
                          <select
                            value={row.discount_type}
                            onChange={(e) => updateItem(idx, "discount_type", e.target.value)}
                            className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5"
                          >
                            <option value="₹">₹</option>
                            <option value="%">%</option>
                          </select>
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 tabular-nums text-[#6b6b76]">
                        {hasDesc ? t.taxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <select
                          value={row.gst_pct}
                          onChange={(e) => updateItem(idx, "gst_pct", e.target.value)}
                          className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        >
                          <option value="">—</option>
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 font-semibold tabular-nums">
                        {hasDesc ? t.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <button type="button" onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 border-t border-[#d0d0d8] p-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() => setAddItemOpen(true)}
              className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-[13px] font-semibold"
              style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY, background: "#f8f5ff" }}
            >
              + Add More Item
            </button>

            <div className="min-w-[260px] overflow-hidden rounded-lg border border-[#d0d0d8] text-[13px]">
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 text-[#6b6b76]">
                <span>Taxable Amount</span>
                <span className="tabular-nums">₹ {taxableAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 text-[#6b6b76]">
                <span>GST Amount</span>
                <span className="tabular-nums">₹ {gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 font-medium text-[#1a1a1f]">
                <span>Total Amount</span>
                <span className="tabular-nums">₹ {itemsTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-b border-[#d0d0d8] bg-[#fafafa] px-3 py-2.5 text-[16px] font-bold text-[#1a1a1f]">
                <span>Final Amount</span>
                <span className="tabular-nums">₹ {finalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex flex-col gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOtherChargeOpen(true)}
                  className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  {otherChargeMeta?.charge_name
                    ? `${otherChargeMeta.charge_name} · ₹ ${otherCharge.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "+ Add Other Charge"}
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountOpen(true)}
                  className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  {invoiceDiscount > 0
                    ? `Discount · ₹ ${invoiceDiscount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "+ Add Delivery Challan Level Discount"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* OPTIONAL FIELDS */}
        <div className="space-y-3">
          <p className="text-center text-[12px] font-bold uppercase tracking-[0.12em] text-[#6b6b76]">
            Optional Fields
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Transportation */}
            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={Truck}
                title="Transportation Details"
                collapsible
                open={transportOpen}
                onToggle={() => setTransportOpen((v) => !v)}
              />
              {transportOpen ? (
              <div className="space-y-4 p-4">
                <div>
                  <FieldLabel>Transportation Mode</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {TRANSPORT_MODES.map(({ id, label, Icon }) => (
                      <Pill
                        key={id}
                        soft
                        active={form.transport_mode === id}
                        onClick={() => setForm((f) => ({ ...f, transport_mode: id }))}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        {label}
                      </Pill>
                    ))}
                  </div>
                </div>

                {(() => {
                  const docs = transportDocLabels(form.transport_mode);
                  const withVehicle = showsVehicleNo(form.transport_mode);
                  return (
                    <div className={`grid gap-3 ${withVehicle ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
                      <label className="block">
                        <FieldLabel>{docs.number}</FieldLabel>
                        <SoftInput
                          placeholder={docs.numberPh}
                          value={form.lr_number}
                          onChange={(e) => setForm((f) => ({ ...f, lr_number: e.target.value }))}
                        />
                      </label>
                      <label className="block">
                        <FieldLabel>{docs.date}</FieldLabel>
                        <SoftInput
                          type="date"
                          value={form.lr_date}
                          onChange={(e) => setForm((f) => ({ ...f, lr_date: e.target.value }))}
                        />
                      </label>
                      {withVehicle ? (
                        <label className="block">
                          <FieldLabel>Vehicle No.</FieldLabel>
                          <SoftInput
                            placeholder="Enter Vehicle No."
                            value={form.vehicle_no}
                            onChange={(e) => setForm((f) => ({ ...f, vehicle_no: e.target.value }))}
                          />
                        </label>
                      ) : null}
                      <label className={`block ${withVehicle ? "" : "sm:col-span-2"}`}>
                        <FieldLabel>Approximate Distance (in km)</FieldLabel>
                        <div className="relative">
                          <SoftInput
                            type="number"
                            value={form.distance_km}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, distance_km: e.target.value }))
                            }
                            className="pr-28"
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[12px] font-semibold text-[var(--color-primary)]"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Calculate
                          </button>
                        </div>
                      </label>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between border-t border-[#ececf0] pt-3">
                  <div className="min-w-0">
                    <span className="text-[13px] font-semibold text-[#1a1a1f]">Transporter Details</span>
                    {form.transporter_name ? (
                      <p className="truncate text-[12px] text-[#6b6b76]">
                        {form.transporter_name}
                        {form.transporter_id ? ` · ${form.transporter_id}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTransporterModalOpen(true)}
                    className="shrink-0 text-[13px] font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    {form.transporter_name ? "Edit Transporter" : "+ Add New Transporter"}
                  </button>
                </div>

                <div className="space-y-3 border-t border-[#ececf0] pt-3">
                  <p className="text-[13px] font-semibold text-[#1a1a1f]">Other Details</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel>Place of Supply</FieldLabel>
                      <SoftSelect
                        value={form.place_of_supply}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, place_of_supply: e.target.value }))
                        }
                      >
                        <option value="">Select State</option>
                        {INDIAN_STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </SoftSelect>
                    </label>
                    <label className="block">
                      <FieldLabel>Date of Supply</FieldLabel>
                      <SoftInput
                        type="date"
                        value={form.date_of_supply}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, date_of_supply: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <FieldLabel>Supply Type</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Job work",
                        "SKD/CKD/Lots",
                        "Recipient Not Known",
                        "For Own Use",
                        "Exhibition or Fairs",
                        "Line Sales",
                        "Others",
                      ].map((t) => (
                        <Pill
                          key={t}
                          soft
                          active={form.supply_type === t}
                          onClick={() => setForm((f) => ({ ...f, supply_type: t }))}
                        >
                          {t}
                        </Pill>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              ) : null}
            </section>

            {/* Other details */}
            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={Grid2x2}
                title="Other Details"
                collapsible
                open={otherDetailsOpen}
                onToggle={() => setOtherDetailsOpen((v) => !v)}
              />
              {otherDetailsOpen ? (
              <div className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel>PO Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter PO Number"
                      value={form.po_number}
                      onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>PO Date</FieldLabel>
                    <SoftInput
                      type="date"
                      value={form.po_date}
                      onChange={(e) => setForm((f) => ({ ...f, po_date: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Challan Reference No</FieldLabel>
                    <SoftInput
                      placeholder="Enter Challan Reference No"
                      value={form.challan_number}
                      onChange={(e) => setForm((f) => ({ ...f, challan_number: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>E-Waybill Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter E-Waybill Number"
                      value={form.ewaybill_number}
                      onChange={(e) => setForm((f) => ({ ...f, ewaybill_number: e.target.value }))}
                    />
                  </label>
                </div>
                {customFields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-[#e8e8ee] bg-[#fafafa] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#1a1a1f]">
                        {field.label}
                      </p>
                      {field.value ? (
                        <p className="mt-0.5 truncate text-[12px] text-[#6b6b76]">{field.value}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomFields((rows) => rows.filter((x) => x.id !== field.id))
                      }
                      className="rounded p-1 text-[#9a9aa5] hover:bg-[#f0f0f4] hover:text-[#e11d48]"
                      aria-label={`Remove ${field.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomFieldOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-primary)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add Custom Field
                </button>
              </div>
              ) : null}
            </section>
          </div>

          {/* Bank — optional, hidden for delivery challan layout */}

          {/* Terms */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader
              icon={FileText}
              title="Terms and Conditions"
              collapsible
              open={termsOpen}
              onToggle={() => setTermsOpen((v) => !v)}
            >
              {termsAttached ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTermsAttached(false);
                    setForm((f) => ({ ...f, notes: "" }));
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white"
                  style={{ background: ERP_PRIMARY }}
                >
                  <X className="h-3.5 w-3.5" /> Remove
                </button>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTermsPickerOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white"
                style={{ background: ERP_PRIMARY }}
              >
                <User className="h-3.5 w-3.5" /> Select Terms and Conditions
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTermsAddOpen(true);
                }}
                className="rounded-full border border-[#d8d8e0] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#4a4a55]"
              >
                + Add New Terms and Conditions
              </button>
            </SectionHeader>
            {termsOpen && termsAttached && form.notes ? (
              <div className="p-4">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-[#e4e4ea] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#1a1a1f] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                />
              </div>
            ) : null}
          </section>

          {/* Notes */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={FileText} title="Notes">
              <button
                type="button"
                onClick={() => setNoteModalOpen(true)}
                className="rounded-full border border-[#d8d8e0] bg-white px-3.5 py-1.5 text-[12px] font-semibold"
                style={{ color: ERP_PRIMARY, borderColor: ERP_PRIMARY }}
              >
                + Add New Note
              </button>
            </SectionHeader>
            {notesText ? (
              <div className="border-t border-[#ececf0] p-4 text-[13px] leading-relaxed text-[#4a4a55] whitespace-pre-wrap">
                {notesText}
              </div>
            ) : null}
          </section>

          {/* Signature */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={User} title="Signature and Stamp">
              <button
                type="button"
                role="switch"
                aria-checked={signatureOn}
                onClick={() => setSignatureOn((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  signatureOn ? "bg-[var(--color-primary)]" : "bg-[#d4d4d8]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                    signatureOn ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </SectionHeader>
            <SignatureAndStampPanel
              companyName={companyName}
              enabled={signatureOn}
              signatureDataUrl={signatureDataUrl}
              stampDataUrl={stampDataUrl}
              onSignatureChange={setSignatureDataUrl}
              onStampChange={setStampDataUrl}
            />
          </section>
        </div>
        </div>
      </div>

      <EditCompanyDetailsModal
        open={editCompanyOpen}
        onClose={() => setEditCompanyOpen(false)}
        onSaved={(data) => setCompany(data)}
      />
      <AddNewPartyModal
        open={addBuyerOpen}
        onClose={() => setAddBuyerOpen(false)}
        onSaved={(buyer) => {
          if (!buyer) return;
          setCustomers((rows) => [buyer, ...rows.filter((c) => c.id !== buyer.id)]);
          setForm((f) => ({
            ...f,
            customer_id: buyer.id,
            ...customerToConsigneeFields(buyer),
          }));
          setShowBuyerPicker(false);
        }}
      />
      <AddNewItemModal
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onSaved={(line) => {
          if (!line) return;
          const withAmount = {
            ...emptyItem(),
            ...line,
            amount: lineTotals(line).total,
          };
          setItems((prev) => {
            const blankIdx = prev.findIndex((r) => !r.item_description?.trim());
            if (blankIdx >= 0) {
              const next = [...prev];
              next[blankIdx] = withAmount;
              return next;
            }
            return [...prev, withAmount];
          });
        }}
      />
      <AddOtherChargesModal
        open={otherChargeOpen}
        onClose={() => setOtherChargeOpen(false)}
        initial={otherChargeMeta}
        onSave={(charge) => {
          setOtherChargeMeta(charge);
          setForm((f) => ({
            ...f,
            other_charge: computeOtherChargeTotal(charge),
          }));
        }}
      />
      <AddInvoiceDiscountModal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        initial={discountMeta}
        baseAmount={itemsTotal}
        onSave={(disc) => {
          setDiscountMeta(disc);
          setForm((f) => ({ ...f, discount: disc.amount || 0 }));
        }}
      />
      <AddTransporterDetailsModal
        open={transporterModalOpen}
        onClose={() => setTransporterModalOpen(false)}
        initial={{
          transporter_name: form.transporter_name,
          transporter_id: form.transporter_id,
        }}
        onSave={(data) => {
          setForm((f) => ({
            ...f,
            transporter_name: data.transporter_name || "",
            transporter_id: data.transporter_id || "",
          }));
        }}
      />
      <AddCustomFieldModal
        open={customFieldOpen}
        onClose={() => setCustomFieldOpen(false)}
        onSave={(field) => setCustomFields((rows) => [...rows, field])}
      />
      <AddBankAccountModal
        open={bankModalOpen}
        onClose={() => setBankModalOpen(false)}
        initial={bankAccount}
        onSave={(data) => {
          setBankAccount(data);
          updateCompanySettings({
            bank_name: data.bank_name || null,
            bank_account_number: data.account_number || null,
            bank_ifsc: data.ifsc || null,
            bank_branch: data.branch_name || null,
          }).catch(() => {});
        }}
      />
      <TermsAndConditionsPicker
        open={termsPickerOpen}
        onClose={() => setTermsPickerOpen(false)}
        value={form.notes}
        onChange={(body) => {
          setTermsAttached(true);
          setTermsOpen(true);
          setForm((f) => ({ ...f, notes: body }));
        }}
        onRemove={() => {
          setTermsAttached(false);
          setForm((f) => ({ ...f, notes: "" }));
        }}
      />
      <AddTermsAndConditionsModal
        open={termsAddOpen}
        onClose={() => setTermsAddOpen(false)}
        onSave={(item) => {
          try {
            const raw = localStorage.getItem("gns_invoice_terms_templates");
            const list = raw ? JSON.parse(raw) : [];
            const next = Array.isArray(list) ? [...list, item] : [item];
            localStorage.setItem("gns_invoice_terms_templates", JSON.stringify(next));
          } catch {
            /* ignore */
          }
          setTermsAttached(true);
          setTermsOpen(true);
          setForm((f) => ({ ...f, notes: item.body }));
        }}
      />
      <AddPrefixModal
        open={prefixModalOpen}
        onClose={() => setPrefixModalOpen(false)}
        onSubmit={(value) => {
          setCustomPrefixes((prev) => {
            const next = prev.includes(value) ? prev : [...prev, value];
            saveCustomPrefixes(next);
            return next;
          });
          setForm((f) => ({ ...f, invoice_prefix: value }));
          if (company && !company.invoice_prefix) {
            updateCompanySettings({ invoice_prefix: value }).catch(() => {});
          }
        }}
      />
      <AddNoteModal
        open={noteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        initial={notesText}
        onSave={(text) => setNotesText(text)}
      />
    </form>
  );
}
