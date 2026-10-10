import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, ChevronDown, FileText, Grid2x2, GripVertical, ImagePlus, MapPin, Package, PenLine, Plane, Plus, Ban, Search, Ship, TrainFront, Trash2, Truck, User, X } from "lucide-react";

import Button from "../../components/common/Button";
import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import AddBankAccountModal from "../../components/sales/AddBankAccountModal";
import AddCustomFieldModal from "../../components/sales/AddCustomFieldModal";
import AddNewItemModal from "../../components/sales/AddNewItemModal";
import ItemPickerDropdown from "../../components/sales/ItemPickerDropdown";
import AddNewPartyModal from "../../components/sales/AddNewPartyModal";
import AddInvoiceDiscountModal from "../../components/sales/AddInvoiceDiscountModal";
import AddOtherChargesModal, {
  computeOtherChargeTotal,
} from "../../components/sales/AddOtherChargesModal";
import AddPrefixModal from "../../components/sales/AddPrefixModal";
import AddTermsAndConditionsModal from "../../components/sales/AddTermsAndConditionsModal";
import AddTransporterDetailsModal from "../../components/sales/AddTransporterDetailsModal";
import ChangeInvoiceTypeModal from "../../components/sales/ChangeInvoiceTypeModal";
import DispatchAddressPicker from "../../components/sales/DispatchAddressPicker";
import EditCompanyDetailsModal from "../../components/sales/EditCompanyDetailsModal";
import SignatureAndStampPanel from "../../components/sales/SignatureAndStampPanel";
import TermsAndConditionsPicker, {
  DEFAULT_TERMS_BODY,
} from "../../components/sales/TermsAndConditionsPicker";
import { createInvoice, getInvoiceDetail, updateInvoice } from "../../api/salesApi";
import { getProducts } from "../../api/productsApi";
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

const STATE_CODES = {
  "Andhra Pradesh": "37",
  Telangana: "36",
  Karnataka: "29",
  Maharashtra: "27",
  "Tamil Nadu": "33",
  Gujarat: "24",
  Delhi: "07",
  "Uttar Pradesh": "09",
  "West Bengal": "19",
  Rajasthan: "08",
  Kerala: "32",
  "Madhya Pradesh": "23",
  Punjab: "03",
  Haryana: "06",
  Bihar: "10",
  Odisha: "21",
  Assam: "18",
  Jharkhand: "20",
  Chhattisgarh: "22",
  Uttarakhand: "05",
  "Himachal Pradesh": "02",
  Goa: "30",
};

const PREFIX_STORAGE_KEY = "gns_invoice_prefixes";
const DEFAULT_PREFIXES = ["INV-", "TI-"];
const ADD_PREFIX_VALUE = "__add_prefix__";

/** GST dropdown options matching the Create Invoice reference UI. */
const GST_RATE_OPTIONS = [
  { value: "na", label: "Not Applicable", pct: 0 },
  { value: "0", label: "GST @ 0%", pct: 0 },
  { value: "exempted", label: "Exempted", pct: 0 },
  { value: "non_gst", label: "Non-GST", pct: 0 },
  { value: "0.1", label: "GST @ 0.1%", pct: 0.1 },
  { value: "0.25", label: "GST @ 0.25%", pct: 0.25 },
  { value: "1.5", label: "GST @ 1.5%", pct: 1.5 },
  { value: "3", label: "GST @ 3%", pct: 3 },
  { value: "5", label: "GST @ 5%", pct: 5 },
  { value: "6", label: "GST @ 6%", pct: 6 },
  { value: "12", label: "GST @ 12%", pct: 12 },
  { value: "18", label: "GST @ 18%", pct: 18 },
  { value: "28", label: "GST @ 28%", pct: 28 },
];

function gstOptionFromPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0) return "na";
  const exact = GST_RATE_OPTIONS.find((o) => o.pct === n && ["0", "0.1", "0.25", "1.5", "3", "5", "6", "12", "18", "28"].includes(o.value));
  if (exact) return exact.value;
  if (n === 0) return "0";
  return String(n);
}

function mapDocumentTypeToUi(doc) {
  const d = String(doc || "").toLowerCase();
  if (d === "tax_invoice" || d === "tax" || d === "sale_invoice") return "tax";
  if (d === "export_invoice" || d === "export") return "export";
  if (d === "bill_of_supply" || d === "bos") return "bill_of_supply";
  return d || "tax";
}

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
  product_id: null,
  item_description: "",
  hsn: "",
  qty: "",
  unit: "",
  rate: "",
  tax_type: "Exclusive",
  discount: "",
  discount_type: "₹",
  gst_pct: "",
  gst_option: "18",
  stock: null,
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
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export default function TaxInvoiceForm() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [company, setCompany] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showBuyerPicker, setShowBuyerPicker] = useState(false);
  const [sameAsBuyer, setSameAsBuyer] = useState(true);
  const [showConsigneePicker, setShowConsigneePicker] = useState(false);
  const [consigneeSearch, setConsigneeSearch] = useState("");
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
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAttached, setTermsAttached] = useState(false);
  const [termsPickerOpen, setTermsPickerOpen] = useState(false);
  const [termsAddOpen, setTermsAddOpen] = useState(false);
  const [transporterModalOpen, setTransporterModalOpen] = useState(false);
  const [customFieldOpen, setCustomFieldOpen] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [bankAccount, setBankAccount] = useState(null);
  const [invoiceType, setInvoiceType] = useState("tax");
  const [pendingInvoiceType, setPendingInvoiceType] = useState(null);
  const [prefixModalOpen, setPrefixModalOpen] = useState(false);
  const [customPrefixes, setCustomPrefixes] = useState(loadCustomPrefixes);
  // Tax mode: "auto" detects from buyer state, "cgst_sgst" forces CGST+SGST, "igst" forces IGST
  const [taxModeOverride, setTaxModeOverride] = useState("auto");
  const [declarationText, setDeclarationText] = useState(() => {
    try { return localStorage.getItem("gns_invoice_declaration") || ""; } catch { return ""; }
  });
  const [rejectionPolicyText, setRejectionPolicyText] = useState(() => {
    try { return localStorage.getItem("gns_invoice_rejection_policy") || ""; } catch { return ""; }
  });
  const [declOpen, setDeclOpen] = useState(false);
  const [signatureOn, setSignatureOn] = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_signature_data") || null; } catch { return null; }
  });
  const [stampDataUrl, setStampDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_stamp_data") || null; } catch { return null; }
  });
  const [products, setProducts] = useState([]);
  const [itemPickerIdx, setItemPickerIdx] = useState(null);
  const [itemSearch, setItemSearch] = useState("");
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [numberManual, setNumberManual] = useState(false);
  const [erpFieldsOpen, setErpFieldsOpen] = useState(true);
  const [form, setForm] = useState({
    tenant_id: tenantId,
    customer_id: "",
    sales_order_id: searchParams.get("sales_order_id")
      ? Number(searchParams.get("sales_order_id"))
      : null,
    invoice_prefix: "",
    invoice_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    discount: 0,
    other_charge: 0,
    round_off: 0,
    irn: "",
    ack_no: "",
    ack_date: "",
    ewaybill_number: "",
    delivery_note: "",
    delivery_note_date: "",
    payment_terms: "",
    reference_no: "",
    reference_date: "",
    other_references: "",
    po_number: "",
    po_date: "",
    dispatch_doc_no: "",
    transporter_name: "DTDC",
    destination: "",
    terms_of_delivery: "",
    consignee_name: "",
    consignee_address1: "",
    consignee_address2: "",
    consignee_state: "",
    consignee_state_code: "",
    consignee_gstin: "",
    consignee_phone: "",
    consignee_email: "",
    notes: "",
    transport_mode: "Road",
    lr_number: "",
    lr_date: "",
    vehicle_no: "",
    distance_km: 0,
    transporter_id: "",
    place_of_supply: "",
    date_of_supply: "",
    supply_type: "B2B",
    challan_number: "",
    sales_person: "",
    reverse_charge: false,
  });
  const [items, setItems] = useState([emptyItem(), emptyItem(), emptyItem()]);
  const [dragRowIdx, setDragRowIdx] = useState(null);
  const [itemToEdit, setItemToEdit] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [custRes, companyRes, productsRes] = await Promise.allSettled([
          fetchCustomersWithFallback(),
          getCompanySettings(),
          getProducts(),
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
        const prodRaw =
          productsRes.status === "fulfilled"
            ? productsRes.value?.data ?? productsRes.value ?? []
            : [];
        setProducts(Array.isArray(prodRaw) ? prodRaw : []);
        if (co && !editId) {
          const nextNum = co.invoice_next_number != null ? String(co.invoice_next_number) : "1";
          setForm((f) => ({
            ...f,
            invoice_prefix: f.invoice_prefix || co.invoice_prefix || "",
            invoice_number: f.invoice_number || nextNum,
          }));
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

        const proformaId = searchParams.get("proforma_id");
        const targetId = editId || proformaId;
        if (targetId) {
          const detail = await getInvoiceDetail(targetId);
          const inv = detail?.data?.invoice || detail?.data;
          if (!inv) throw new Error("Invoice not found");
          const num = String(inv.invoice_number || "");
          const prefix = inv.invoice_prefix || "";
          const numberOnly =
            prefix && num.startsWith(prefix) ? num.slice(prefix.length) : num.replace(/^[A-Za-z-]+/, "") || num;
          if (editId) {
            setInvoiceType(mapDocumentTypeToUi(inv.document_type));
            setNumberManual(true);
          } else {
            setInvoiceType("tax");
          }
          setSignatureOn(Boolean(inv.show_signature));
          if (inv.stamp_url) {
            setStampDataUrl(inv.stamp_url);
          }
          if (inv.signature_url) {
            setSignatureDataUrl(inv.signature_url);
          }
          if (inv.terms_and_conditions) {
            setTermsAttached(true);
          }
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
            payment_terms: inv.payment_terms || inv.meta?.payment_terms || inv.meta?.modeTerms || inv.meta?.payment_mode || inv.payment_mode || "",
            delivery_note: inv.delivery_note || inv.meta?.delivery_note || inv.meta?.deliveryNote || inv.challan_number || "",
            delivery_note_date: inv.delivery_note_date || inv.meta?.delivery_note_date || inv.meta?.deliveryNoteDate || (inv.lr_date ? String(inv.lr_date).slice(0, 10) : ""),
            reference_no: inv.reference_no || inv.meta?.reference_no || inv.meta?.referenceNo || "",
            reference_date: inv.reference_date ? String(inv.reference_date).slice(0, 10) : (inv.meta?.reference_date ? String(inv.meta.reference_date).slice(0, 10) : ""),
            other_references: inv.other_references || inv.meta?.other_references || inv.meta?.otherReferences || "",
            po_number: inv.po_number || inv.meta?.po_number || inv.meta?.buyers_order_no || inv.meta?.buyersOrderNo || "",
            po_date: inv.po_date ? String(inv.po_date).slice(0, 10) : (inv.meta?.po_date ? String(inv.meta.po_date).slice(0, 10) : ""),
            dispatch_doc_no: inv.dispatch_doc_no || inv.lr_number || inv.meta?.dispatch_doc_no || inv.meta?.dispatchDocNo || "",
            destination: inv.destination || inv.meta?.destination || "",
            terms_of_delivery: inv.terms_of_delivery || inv.meta?.terms_of_delivery || inv.meta?.termsOfDelivery || "",
            consignee_name: inv.consignee_name || inv.meta?.consignee_name || "",
            consignee_address1: inv.consignee_address1 || inv.meta?.consignee_address1 || "",
            consignee_address2: inv.consignee_address2 || inv.meta?.consignee_address2 || "",
            consignee_state: inv.consignee_state || inv.meta?.consignee_state || "",
            consignee_state_code: inv.consignee_state_code || inv.meta?.consignee_state_code || "",
            consignee_gstin: inv.consignee_gstin || inv.meta?.consignee_gstin || "",
            consignee_phone: inv.consignee_phone || inv.meta?.consignee_phone || "",
            consignee_email: inv.consignee_email || inv.meta?.consignee_email || "",
            notes: inv.terms_and_conditions || inv.notes || DEFAULT_TERMS_BODY,
            transport_mode: inv.transport_mode || "Road",
            lr_number: inv.lr_number || "",
            lr_date: inv.lr_date ? String(inv.lr_date).slice(0, 10) : "",
            vehicle_no: inv.vehicle_no || "",
            distance_km: inv.distance_km || 0,
            transporter_name: inv.transporter_name || "",
            place_of_supply: inv.place_of_supply || "",
            date_of_supply: inv.date_of_supply ? String(inv.date_of_supply).slice(0, 10) : "",
            supply_type: inv.supply_type || "B2B",
            challan_number: inv.challan_number || inv.delivery_note || "",
            ewaybill_number: inv.ewaybill_number || "",
            sales_person: inv.sales_person || "",
            reverse_charge: Boolean(inv.reverse_charge),
          }));
          const lineItems = (inv.items || [])
            .filter((it) => String(it.item_description || "").toLowerCase() !== "other charge")
            .map((it) => {
              const gstPct = Number(it.gst_pct ?? 0);
              return {
                ...emptyItem(),
                item_description: it.item_description || "",
                hsn: it.hsn || "",
                qty: it.qty ?? 0,
                unit: it.unit || "pcs",
                rate: it.rate ?? 0,
                tax_type: it.tax_type || "Exclusive",
                discount: it.discount ?? 0,
                discount_type: it.discount_type || "₹",
                gst_pct: gstPct,
                gst_option: gstOptionFromPct(gstPct),
              };
            });
          setItems(lineItems.length ? lineItems : [emptyItem(), emptyItem(), emptyItem()]);
        }
      } catch (err) {
        if (!cancelled) {
          addToast(apiErrorMessage(err, "Failed to load invoice"), "error");
          if (editId) navigate("/sales/invoices");
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

  const filteredConsignees = useMemo(
    () => filterCustomers(customers, consigneeSearch),
    [customers, consigneeSearch]
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

  const resetInvoiceData = (nextType) => {
    setInvoiceType(nextType);
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
      supply_type: "B2B",
      po_number: "",
      po_date: "",
      challan_number: "",
      ewaybill_number: "",
      sales_person: "",
      reverse_charge: false,
    }));
  };

  const requestInvoiceTypeChange = (nextType) => {
    if (nextType === invoiceType) return;
    setPendingInvoiceType(nextType);
  };

  const handleCustomerChange = (customerId) => {
    const customer = customers.find((c) => String(c.id) === String(customerId));
    setForm((f) => ({
      ...f,
      customer_id: customerId,
      ...customerToConsigneeFields(customer),
      consignee_phone: customer?.phone || customer?.mobile || "",
      consignee_email: customer?.email || "",
      place_of_supply: f.place_of_supply || customer?.state || "",
    }));
    setShowBuyerPicker(false);
  };

  const updateItem = (idx, field, val) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      if (field === "gst_option") {
        const opt = GST_RATE_OPTIONS.find((o) => o.value === val);
        next[idx].gst_pct = opt ? opt.pct : Number(val) || 0;
      }
      next[idx].amount = lineTotals(next[idx]).total;
      return next;
    });
  };

  const selectProductForRow = (idx, product) => {
    const gstPct = Number(product.gst_percent ?? product.gst_pct ?? company?.default_gst_pct ?? 18) || 0;
    setItems((prev) => {
      const next = [...prev];
      const row = {
        ...emptyItem(),
        product_id: product.id,
        item_description: product.name || product.sku || "",
        hsn: product.hsn_code || product.hsn || "",
        qty: next[idx]?.qty || 1,
        unit: product.unit || "pcs",
        rate: product.unit_price ?? product.sale_price ?? product.price_per_unit ?? "",
        tax_type: "Exclusive",
        gst_pct: gstPct,
        gst_option: gstOptionFromPct(gstPct),
        stock: product.current_stock != null ? Number(product.current_stock) : null,
      };
      row.amount = lineTotals(row).total;
      next[idx] = row;
      return next;
    });
    setItemPickerIdx(null);
    setItemSearch("");
    setHighlightedIdx(0);
  };

  const filteredProducts = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const curDesc = (items[itemPickerIdx]?.item_description || "").trim().toLowerCase();
    if (!q || (itemPickerIdx !== null && q === curDesc)) {
      return products.slice(0, 40);
    }
    return products
      .filter((p) =>
        [p.name, p.sku, p.hsn_code, p.product_code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
      .slice(0, 40);
  }, [products, itemSearch, itemPickerIdx, items]);

  const removeItem = (idx) => {
    setItems((prev) => (prev.length <= 1 ? [emptyItem()] : prev.filter((_, i) => i !== idx)));
  };

  const addEmptyItemRow = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const filledItems = items.filter((i) => i.item_description?.trim());
  const taxableAmount = filledItems.reduce((s, i) => s + lineTotals(i).taxable, 0);
  const gstAmount = filledItems.reduce((s, i) => s + lineTotals(i).gst, 0);
  const itemsTotal = filledItems.reduce((s, i) => s + lineTotals(i).total, 0);
  const otherCharge = Number(form.other_charge) || 0;
  const invoiceDiscount = Number(form.discount) || 0;
  const finalAmount = money(itemsTotal + otherCharge - invoiceDiscount + (Number(form.round_off) || 0));

  const useIgst = taxModeOverride === "igst" || invoiceType === "export";
  const useCgstSgst = !useIgst && (taxModeOverride === "cgst_sgst" || taxModeOverride === "auto");

  const avgGstPct =
    filledItems.length > 0
      ? filledItems.reduce((s, i) => s + (Number(i.gst_pct) || 0), 0) / filledItems.length
      : Number(company?.default_gst_pct) || 18;
  const cgstPct = useIgst ? 0 : money(avgGstPct / 2);
  const sgstPct = useIgst ? 0 : money(avgGstPct / 2);
  const igstPct = useIgst ? money(avgGstPct) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.issue_date) {
      addToast("Please select invoice date", "error");
      return;
    }
    if (!form.customer_id) {
      addToast("Please select a buyer", "error");
      setShowBuyerPicker(true);
      return;
    }
    if (filledItems.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    for (const row of filledItems) {
      if (Number(row.qty) < 0 || Number(row.rate) < 0 || Number(row.discount) < 0) {
        addToast("Quantity, price, and discount cannot be negative", "error");
        return;
      }
      if (!(Number(row.qty) > 0)) {
        addToast(`Enter a valid quantity for "${row.item_description}"`, "error");
        return;
      }
    }
    setSaving(true);
    try {
      const customerId = await resolveCustomerId(form.customer_id, customers, tenantId);
      const invoiceNumberPayload =
        !isEdit && !numberManual ? "AUTO" : form.invoice_number || "AUTO";
      const payload = {
        tenant_id: Number(form.tenant_id || tenantId) || 1,
        customer_id: customerId,
        sales_order_id: form.sales_order_id || null,
        document_type: invoiceType,
        invoice_prefix: form.invoice_prefix || null,
        invoice_number: invoiceNumberPayload,
        issue_date: form.issue_date,
        due_date: form.due_date || null,
        discount: invoiceDiscount,
        other_charge: otherCharge,
        round_off: Number(form.round_off) || 0,
        cgst_pct: cgstPct,
        sgst_pct: sgstPct,
        igst_pct: igstPct,
        status: "issued",
        irn: form.irn || null,
        ack_no: form.ack_no || null,
        ack_date: form.ack_date || null,
        delivery_note: form.delivery_note || form.challan_number || null,
        delivery_note_date: form.delivery_note_date || null,
        payment_terms: form.payment_terms || null,
        reference_no: form.reference_no || null,
        reference_date: form.reference_date || null,
        other_references: form.other_references || null,
        po_number: form.po_number || null,
        po_date: form.po_date || null,
        lr_number: form.dispatch_doc_no || form.lr_number || null,
        lr_date: form.delivery_note_date || form.lr_date || null,
        dispatch_doc_no: form.dispatch_doc_no || form.lr_number || null,
        transporter_name: form.transporter_name || "DTDC",
        destination: form.destination || null,
        delivery_terms: form.terms_of_delivery || null,
        terms_of_delivery: form.terms_of_delivery || null,
        consignee_name: form.consignee_name || null,
        consignee_address1: form.consignee_address1 || null,
        consignee_address2: form.consignee_address2 || null,
        consignee_state: form.consignee_state || null,
        consignee_state_code: form.consignee_state_code || null,
        consignee_gstin: form.consignee_gstin || null,
        consignee_phone: form.consignee_phone || null,
        consignee_email: form.consignee_email || null,
        transport_mode: form.transport_mode || "Road",
        vehicle_no: form.vehicle_no || null,
        distance_km: form.distance_km ? Number(form.distance_km) : null,
        place_of_supply: form.place_of_supply || null,
        date_of_supply: form.date_of_supply || null,
        supply_type: form.supply_type || null,
        challan_number: form.delivery_note || form.challan_number || null,
        ewaybill_number: form.ewaybill_number || null,
        sales_person: form.sales_person || null,
        reverse_charge: Boolean(form.reverse_charge),
        terms_and_conditions: termsAttached ? form.notes || null : null,
        rejection_policy: rejectionPolicyText || null,
        stamp_url: stampDataUrl || null,
        signature_url: signatureDataUrl || null,
        show_signature: Boolean(signatureOn),
        bank_details: bankAccount || null,
        meta: {
          payment_terms: form.payment_terms || null,
          modeTerms: form.payment_terms || null,
          payment_mode: form.payment_terms || null,
          delivery_note: form.delivery_note || form.challan_number || null,
          deliveryNote: form.delivery_note || form.challan_number || null,
          delivery_note_date: form.delivery_note_date || null,
          reference_no: form.reference_no || null,
          referenceNo: form.reference_no || null,
          reference_date: form.reference_date || null,
          other_references: form.other_references || null,
          buyers_order_no: form.po_number || null,
          buyersOrderNo: form.po_number || null,
          po_number: form.po_number || null,
          po_date: form.po_date || null,
          dispatch_doc_no: form.dispatch_doc_no || form.lr_number || null,
          dispatchDocNo: form.dispatch_doc_no || form.lr_number || null,
          dispatchedThrough: form.transporter_name || "DTDC",
          destination: form.destination || null,
          terms_of_delivery: form.terms_of_delivery || null,
          consignee_name: form.consignee_name || null,
          consignee_address1: form.consignee_address1 || null,
          consignee_address2: form.consignee_address2 || null,
          consignee_state: form.consignee_state || null,
          consignee_state_code: form.consignee_state_code || null,
          consignee_gstin: form.consignee_gstin || null,
          consignee_phone: form.consignee_phone || null,
          consignee_email: form.consignee_email || null,
        },
        custom_fields: customFields.length
          ? customFields.map((f) => ({ label: f.label, value: f.value }))
          : null,
        notes: customFields.map((f) => `${f.label}: ${f.value}`).filter(Boolean).join("\n") || null,
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
        addToast("Invoice updated");
      } else {
        const res = await createInvoice(payload);
        const saved = res?.data;
        notifyManufacturingSpine(MANUFACTURING_EVENTS.INVOICE_CREATED, {
          invoice_id: saved?.id,
          sales_order_id: form.sales_order_id,
        });
        addToast(
          saved?.invoice_number
            ? `Invoice ${saved.invoice_number} created`
            : "Invoice created"
        );
      }
      navigate("/sales/invoices");
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
  const companyAddress = [
    company?.address_line1,
    company?.address_line2,
    company?.city,
    company?.state,
    company?.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full min-h-0 flex-col bg-[#F5F5F5]"
    >
      {/* Sticky header — matches screenshot */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e4e4ea] bg-white px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/sales/invoices")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#e4e4ea] bg-white text-[#4a4a55] hover:bg-[#f5f5f7]"
            aria-label="Back to invoices"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate("/sales/invoices")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Update" : "Save"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1200px] space-y-4 p-5 pb-10">
          {/* Top: invoice type + supplier */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
          <section className="rounded-xl border border-[#d0d0d8] bg-white p-4">
            <div className="mb-4 flex flex-wrap gap-5">
              {[
                { id: "tax", label: "Tax Invoice" },
                { id: "bill_of_supply", label: "Bill of Supply" },
                { id: "export", label: "Export Invoice" },
              ].map((opt) => (
                <label key={opt.id} className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#1a1a1f]">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      invoiceType === opt.id ? "border-[var(--color-primary)]" : "border-[#c4c4cc]"
                    }`}
                  >
                    {invoiceType === opt.id ? (
                      <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                    ) : null}
                  </span>
                  <input
                    type="radio"
                    name="invoiceType"
                    className="sr-only"
                    checked={invoiceType === opt.id}
                    onChange={() => requestInvoiceTypeChange(opt.id)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <FieldLabel>Invoice Prefix</FieldLabel>
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
                    + Add Prefix
                  </option>
                </SoftSelect>
              </label>
              <label className="block">
                <FieldLabel>Invoice No.</FieldLabel>
                <SoftInput
                  value={form.invoice_number}
                  onChange={(e) => {
                    setNumberManual(true);
                    setForm((f) => ({ ...f, invoice_number: e.target.value }));
                  }}
                  placeholder="AUTO"
                />
              </label>
              <label className="block">
                <FieldLabel>Invoice Date</FieldLabel>
                <SoftInput
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={Building2} title="Supplier Details" />
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
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
                <div className="mt-2 space-y-0.5 text-[12px] leading-relaxed text-[#6b6b76]">
                  {companyAddress ? <p>{companyAddress}</p> : null}
                  {company?.gstin ? <p>GSTIN: {company.gstin}</p> : null}
                  <p>
                    {[company?.phone ? `Phone: ${company.phone}` : null, company?.email ? `Email: ${company.email}` : null]
                      .filter(Boolean)
                      .join(" · ") || null}
                  </p>
                </div>
                <div className="mt-3">
                  <DispatchAddressPicker value={dispatchAddress} onChange={setDispatchAddress} />
                </div>
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
              <div className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">Buyer Name</p>
                  <p className="font-semibold text-[#1a1a1f]">{selectedBuyer.name}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">GSTIN</p>
                  <p className="text-[#4a4a55]">{selectedBuyer.gstin || form.consignee_gstin || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">Billing Address</p>
                  <p className="text-[#4a4a55]">
                    {[form.consignee_address1, form.consignee_address2].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">State / Code</p>
                  <p className="text-[#4a4a55]">
                    {[form.consignee_state, form.consignee_state_code].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">Phone</p>
                  <p className="text-[#4a4a55]">{selectedBuyer.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#9a9aa5]">Email</p>
                  <p className="text-[#4a4a55]">{selectedBuyer.email || "—"}</p>
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-[13px] text-[#a0a0ab]">Select a buyer to continue</p>
            )}
          </div>
        </section>

        {/* Consignee (Ship to) Details */}
        <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
          <SectionHeader icon={MapPin} title="Consignee Details (Ship to)">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-[#4a4a55]">
                <input
                  type="checkbox"
                  checked={sameAsBuyer}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSameAsBuyer(checked);
                    if (checked && selectedBuyer) {
                      setForm((f) => ({
                        ...f,
                        ...customerToConsigneeFields(selectedBuyer),
                        consignee_phone: selectedBuyer.phone || selectedBuyer.mobile || "",
                        consignee_email: selectedBuyer.email || "",
                      }));
                    }
                  }}
                  className="h-4 w-4 rounded border-[#c4c4cc] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
                Same as Buyer (Bill to)
              </label>
              {!sameAsBuyer && (
                <button
                  type="button"
                  onClick={() => setShowConsigneePicker((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white"
                  style={{ background: ERP_PRIMARY }}
                >
                  <User className="h-3.5 w-3.5" />
                  Select Consignee
                </button>
              )}
            </div>
          </SectionHeader>

          <div className="p-4">
            {showConsigneePicker && !sameAsBuyer && (
              <div className="mb-3 rounded-lg border border-[#e4e4ea] bg-[#fafafa] p-3">
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a9aa5]" />
                  <input
                    type="search"
                    placeholder="Search Consignee..."
                    value={consigneeSearch}
                    onChange={(e) => setConsigneeSearch(e.target.value)}
                    className="w-full rounded-lg border border-[#e4e4ea] bg-white py-2 pl-9 pr-3 text-[13px]"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {filteredConsignees.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          consignee_name: c.name || c.company || "",
                          consignee_address1: c.address_line1 || c.address || "",
                          consignee_address2: c.address_line2 || [c.city, c.pincode].filter(Boolean).join(" - ") || "",
                          consignee_state: c.state || "",
                          consignee_state_code: c.state_code || "",
                          consignee_gstin: c.gstin || "",
                          consignee_phone: c.phone || c.mobile || "",
                          consignee_email: c.email || "",
                        }));
                        setShowConsigneePicker(false);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-white"
                    >
                      {c.name || c.company}
                      {c.gstin ? ` · ${c.gstin}` : ""}
                      {c.state ? ` · ${c.state}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sameAsBuyer ? (
              <div className="rounded-lg border border-[#e4e4ea] bg-[#fafafa] p-3 text-[13px] text-[#555]">
                <p className="font-semibold text-[#1a1a1f]">Ship to is set to same as Buyer:</p>
                <p className="mt-1 text-[#333]">
                  <strong>{form.consignee_name || selectedBuyer?.name || "—"}</strong>
                  {form.consignee_address1 ? ` — ${form.consignee_address1}` : ""}
                  {form.consignee_address2 ? `, ${form.consignee_address2}` : ""}
                  {form.consignee_state ? ` · ${form.consignee_state}` : ""}
                  {form.consignee_gstin ? ` (GSTIN: ${form.consignee_gstin})` : ""}
                </p>
                <p className="mt-1 text-[11px] text-[#888]">
                  Uncheck "Same as Buyer" above if goods need to be shipped to a different party, site, or warehouse.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <FieldLabel>Consignee / Company Name</FieldLabel>
                  <SoftInput
                    value={form.consignee_name}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_name: e.target.value }))}
                    placeholder="Enter Consignee Name"
                  />
                </label>
                <label className="block">
                  <FieldLabel>GSTIN / UIN</FieldLabel>
                  <SoftInput
                    value={form.consignee_gstin}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_gstin: e.target.value.toUpperCase() }))}
                    placeholder="Consignee GSTIN"
                  />
                </label>
                <label className="block">
                  <FieldLabel>Contact Phone</FieldLabel>
                  <SoftInput
                    value={form.consignee_phone}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_phone: e.target.value }))}
                    placeholder="Phone number"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <FieldLabel>Shipping Address Line 1</FieldLabel>
                  <SoftInput
                    value={form.consignee_address1}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_address1: e.target.value }))}
                    placeholder="Address Line 1 (Street, Area, Building)"
                  />
                </label>
                <label className="block">
                  <FieldLabel>Shipping Address Line 2</FieldLabel>
                  <SoftInput
                    value={form.consignee_address2}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_address2: e.target.value }))}
                    placeholder="Address Line 2 (City, Pincode)"
                  />
                </label>
                <label className="block">
                  <FieldLabel>State</FieldLabel>
                  <SoftSelect
                    value={form.consignee_state}
                    onChange={(e) => {
                      const st = e.target.value;
                      const code = STATE_CODES[st] || "";
                      setForm((f) => ({ ...f, consignee_state: st, consignee_state_code: code }));
                    }}
                  >
                    <option value="">Select State</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </SoftSelect>
                </label>
                <label className="block">
                  <FieldLabel>State Code</FieldLabel>
                  <SoftInput
                    value={form.consignee_state_code}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_state_code: e.target.value }))}
                    placeholder="e.g. 36"
                  />
                </label>
                <label className="block">
                  <FieldLabel>Email</FieldLabel>
                  <SoftInput
                    value={form.consignee_email}
                    onChange={(e) => setForm((f) => ({ ...f, consignee_email: e.target.value }))}
                    placeholder="Email"
                  />
                </label>
              </div>
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
            <table className="w-full min-w-[1180px] border-collapse text-left text-[12px]">
              <thead className="ui-table-head">
                <tr>
                  {["S.No", "Item Name", "HSN", "Qty", "Unit", "Price", "Tax Type", "Discount", "Taxable Value", "GST", "Total Amt", ""].map(
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
                  const gstValue = row.gst_option || gstOptionFromPct(row.gst_pct);
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
                        <div className="relative min-w-[180px]">
                          <SearchBar
                            size="compact"
                            value={itemPickerIdx === idx ? itemSearch : row.item_description}
                            onFocus={(e) => {
                              setItemPickerIdx(idx);
                              setItemSearch(row.item_description || "");
                              setHighlightedIdx(0);
                              e?.target?.select?.();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                if (filteredProducts.length > 0) {
                                  const selected = filteredProducts[highlightedIdx] || filteredProducts[0];
                                  if (selected) {
                                    selectProductForRow(idx, selected);
                                  }
                                }
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setHighlightedIdx((prev) => Math.min(prev + 1, Math.max(0, filteredProducts.length - 1)));
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setHighlightedIdx((prev) => Math.max(prev - 1, 0));
                              } else if (e.key === "Escape") {
                                setItemPickerIdx(null);
                              }
                            }}
                            onChange={(v) => {
                              setItemPickerIdx(idx);
                              setItemSearch(v);
                              setHighlightedIdx(0);
                              updateItem(idx, "item_description", v);
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setItemPickerIdx((cur) => (cur === idx ? null : cur));
                              }, 180);
                            }}
                            placeholder="Select Item"
                            clearable={false}
                            className="w-full"
                          />
                          {itemPickerIdx === idx ? (
                            <ItemPickerDropdown
                              products={filteredProducts}
                              selectedIndex={highlightedIdx}
                              onSelectProduct={(p) => selectProductForRow(idx, p)}
                              onAddNewItem={() => {
                                setItemToEdit(null);
                                setAddItemOpen(true);
                              }}
                              onEditItem={(p) => {
                                setItemToEdit(p);
                                setAddItemOpen(true);
                              }}
                              onToggleInactive={(p) => {
                                setProducts((prev) =>
                                  prev.map((item) =>
                                    item.id === p.id
                                      ? { ...item, status: item.status === "inactive" ? "active" : "inactive" }
                                      : item
                                  )
                                );
                              }}
                              onDeleteItem={(p) => {
                                setProducts((prev) => prev.filter((item) => item.id !== p.id));
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <input
                          value={row.hsn}
                          onChange={(e) => updateItem(idx, "hsn", e.target.value)}
                          placeholder="-"
                          className="w-16 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        />
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 min-w-[110px]">
                        <ShorthandQuantityInput
                          value={row.qty}
                          onChange={(val) => updateItem(idx, "qty", val)}
                          placeholder="-"
                          className="w-full text-xs min-w-[90px]"
                        />
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <select
                          value={row.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                          className="w-[72px] rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5"
                        >
                          <option value="">-</option>
                          <option value="pcs">pcs</option>
                          <option value="KGS">KGS</option>
                          <option value="MT">MT</option>
                          <option value="NOS">NOS</option>
                          <option value="BOX">BOX</option>
                        </select>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 min-w-[125px]">
                        <div className="flex items-center gap-0.5">
                          <span className="text-[#9a9aa5] shrink-0">₹</span>
                          <ShorthandQuantityInput
                            value={row.rate}
                            onChange={(val) => updateItem(idx, "rate", val)}
                            placeholder="-"
                            className="w-full text-xs min-w-[95px]"
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
                            placeholder="-"
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
                        {hasDesc ? t.taxable.toFixed(2) : "-"}
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                        <select
                          value={gstValue}
                          onChange={(e) => updateItem(idx, "gst_option", e.target.value)}
                          className="min-w-[120px] rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        >
                          {GST_RATE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border-b border-r border-[#d0d0d8] px-2 py-2 font-semibold tabular-nums">
                        {hasDesc ? t.total.toFixed(2) : "-"}
                      </td>
                      <td className="border-b border-[#d0d0d8] px-2 py-2">
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
              onClick={addEmptyItemRow}
              className="inline-flex items-center justify-center rounded-full border px-5 py-2 text-[13px] font-semibold"
              style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY, background: "#f8f5ff" }}
            >
              + Add More Item
            </button>

            <div className="min-w-[260px] space-y-1 text-[13px]">
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-1 py-2 text-[#6b6b76]">
                <span>Taxable Amount</span>
                <span className="tabular-nums">₹ {taxableAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-1 py-2 text-[#6b6b76]">
                <span>GST Amount</span>
                <span className="tabular-nums">₹ {gstAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-1 py-2 font-medium text-[#1a1a1f]">
                <span>Total Amount</span>
                <span className="tabular-nums">₹ {itemsTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between px-1 py-2.5 text-[16px] font-bold text-[#1a1a1f]">
                <span>Final Amount</span>
                <span className="tabular-nums">₹ {finalAmount.toFixed(2)}</span>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOtherChargeOpen(true)}
                  className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  {otherChargeMeta?.charge_name
                    ? `${otherChargeMeta.charge_name} · ₹ ${otherCharge.toFixed(2)}`
                    : "+ Add Other Charge"}
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountOpen(true)}
                  className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  {invoiceDiscount > 0
                    ? `Discount · ₹ ${invoiceDiscount.toFixed(2)}`
                    : "+ Add Invoice Level Discount"}
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
                <div className="p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel>Delivery Note</FieldLabel>
                      <SoftInput
                        placeholder="Delivery Note No."
                        value={form.delivery_note}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            delivery_note: e.target.value,
                            challan_number: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Delivery Note Date</FieldLabel>
                      <SoftInput
                        type="date"
                        value={form.delivery_note_date}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, delivery_note_date: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Reference No. &amp; Date</FieldLabel>
                      <SoftInput
                        placeholder="e.g. REF/2026/09"
                        value={form.reference_no}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, reference_no: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Other References</FieldLabel>
                      <SoftInput
                        placeholder="Other references"
                        value={form.other_references}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, other_references: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Buyer's Order No.</FieldLabel>
                      <SoftInput
                        placeholder="PO Number"
                        value={form.po_number}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, po_number: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Buyer's Order Date (Dated)</FieldLabel>
                      <SoftInput
                        type="date"
                        value={form.po_date}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, po_date: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Dispatch Doc No. (LR No.)</FieldLabel>
                      <SoftInput
                        placeholder="Dispatch Doc / LR No."
                        value={form.dispatch_doc_no || form.lr_number}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            dispatch_doc_no: e.target.value,
                            lr_number: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Dispatched through</FieldLabel>
                      <SoftInput
                        placeholder="e.g. DTDC"
                        value={form.transporter_name}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, transporter_name: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Destination</FieldLabel>
                      <SoftInput
                        placeholder="e.g. INDORE"
                        value={form.destination}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, destination: e.target.value }))
                        }
                      />
                    </label>
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
                  <label className="block sm:col-span-2">
                    <FieldLabel>IRN (Invoice Reference Number)</FieldLabel>
                    <SoftInput
                      placeholder=""
                      value={form.irn}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((f) => ({ ...f, irn: val }));
                        try { localStorage.setItem("gns_invoice_irn", val); } catch {}
                      }}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Ack No.</FieldLabel>
                    <SoftInput
                      placeholder=""
                      value={form.ack_no}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((f) => ({ ...f, ack_no: val }));
                        try { localStorage.setItem("gns_invoice_ack_no", val); } catch {}
                      }}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Ack Date</FieldLabel>
                    <SoftInput
                      type="date"
                      value={form.ack_date}
                      onChange={(e) => {
                        const val = e.target.value;
                        setForm((f) => ({ ...f, ack_date: val }));
                        try { localStorage.setItem("gns_invoice_ack_date", val); } catch {}
                      }}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>E-Waybill Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter E-Waybill Number"
                      value={form.ewaybill_number}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ewaybill_number: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Mode / Terms of Payment</FieldLabel>
                    <SoftInput
                      placeholder="Mode/Terms of Payment"
                      value={form.payment_terms}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, payment_terms: e.target.value }))
                      }
                    />
                  </label>
                </div>

                {/* Reverse Charge row */}
                <div className="flex items-center justify-between pt-1">
                  <label className="inline-flex items-center gap-2 text-[13px] text-[#4a4a55]">
                    <input
                      type="checkbox"
                      checked={form.reverse_charge}
                      onChange={(e) => setForm((f) => ({ ...f, reverse_charge: e.target.checked }))}
                      className="h-4 w-4 rounded border-[#c4c4cc]"
                    />
                    Reverse Charge Applicable?
                  </label>
                </div>

                {/* Custom fields list */}
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

                {/* Add Custom Field button — full width, clearly separated */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setCustomFieldOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-primary)] bg-white px-3 py-2 text-[13px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Custom Field
                  </button>
                </div>
              </div>
              ) : null}
            </section>
          </div>

          {/* Bank */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={Building2} title="Bank / Payment Details (Optional)">
              <button
                type="button"
                onClick={() => setBankModalOpen(true)}
                className="rounded-lg border border-[#d8d8e0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#4a4a55]"
              >
                {bankAccount ? "Edit Bank Details" : "+ Add New Bank Details"}
              </button>
            </SectionHeader>
            {bankAccount ? (
              <div className="space-y-1 border-t border-[#ececf0] p-4 text-[13px] text-[#4a4a55]">
                <p className="font-semibold text-[#1a1a1f]">{bankAccount.bank_name}</p>
                {bankAccount.account_holder ? <p>{bankAccount.account_holder}</p> : null}
                {bankAccount.account_number ? (
                  <p className="tabular-nums">A/C: {bankAccount.account_number}</p>
                ) : null}
                <p>
                  {[bankAccount.ifsc, bankAccount.branch_name].filter(Boolean).join(" · ")}
                </p>
                {bankAccount.upi_id ? (
                  <p>
                    UPI: {bankAccount.upi_id}
                    {bankAccount.show_upi_qr ? " · QR on invoice" : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Terms of Delivery */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader
              icon={FileText}
              title="Terms of Delivery"
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
                    setForm((f) => ({ ...f, notes: "", terms_of_delivery: "" }));
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
                <User className="h-3.5 w-3.5" /> Select Terms of Delivery
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
                + Add New Terms of Delivery
              </button>
            </SectionHeader>
            {termsOpen && termsAttached && (form.notes || form.terms_of_delivery) ? (
              <div className="p-4">
                <textarea
                  rows={3}
                  value={form.terms_of_delivery || form.notes || ""}
                  placeholder="Enter Terms of Delivery (e.g. 1. Door delivery within 7 working days.)"
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((f) => ({ ...f, notes: val, terms_of_delivery: val }));
                    try { localStorage.setItem("gns_invoice_terms_data", val); } catch { /* ignore */ }
                    try { localStorage.setItem("gns_invoice_delivery_terms", val); } catch { /* ignore */ }
                  }}
                  className="w-full rounded-lg border border-[#e4e4ea] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#1a1a1f] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                />
              </div>
            ) : null}
          </section>

          {/* GST Mode — CGST + SGST or IGST selector */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <div className="flex items-center gap-3 border-b border-[#e8e8f0] px-4 py-3">
              <Grid2x2 className="h-4 w-4 text-[var(--color-primary)]" />
              <span className="text-[13px] font-semibold text-[#1a1a1f]">GST Tax Mode</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 p-4">
              {[
                { id: "auto", label: "Auto Detect" },
                { id: "cgst_sgst", label: "CGST + SGST (Intra-state)" },
                { id: "igst", label: "IGST (Inter-state / Export)" },
              ].map((opt) => (
                <label key={opt.id} className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                  <input
                    type="radio"
                    name="taxModeOverride"
                    checked={taxModeOverride === opt.id}
                    onChange={() => setTaxModeOverride(opt.id)}
                    className="accent-[var(--color-primary)] h-4 w-4"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="px-4 pb-3 text-[11px] text-[#9a9aa5]">
              {taxModeOverride === "auto"
                ? "Tax mode is automatically determined from buyer vs seller state."
                : taxModeOverride === "igst"
                ? "IGST will be applied on all line items."
                : "CGST + SGST will be split equally on all line items."}
            </div>
          </section>

          {/* Declaration & Rejection Policy */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <button
              type="button"
              className="flex w-full items-center gap-3 border-b border-[#e8e8f0] px-4 py-3 text-left"
              onClick={() => setDeclOpen((v) => !v)}
            >
              <FileText className="h-4 w-4 text-[var(--color-primary)]" />
              <span className="text-[13px] font-semibold text-[#1a1a1f]">Declaration &amp; Rejection Policy</span>
              <ChevronDown className={`ml-auto h-4 w-4 text-[#9a9aa5] transition-transform ${declOpen ? "rotate-180" : ""}`} />
            </button>
            {declOpen && (
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[12px] font-semibold text-[#4a4a55]">
                    Declaration (one item per line)
                  </label>
                  <textarea
                    rows={6}
                    value={declarationText}
                    placeholder={"1. Certified that the particulars given above are true and correct.\n2. All disputes subject to local jurisdiction."}
                    onChange={(e) => {
                      setDeclarationText(e.target.value);
                      try { localStorage.setItem("gns_invoice_declaration", e.target.value); } catch { /* ignore */ }
                    }}
                    className="w-full rounded-lg border border-[#e4e4ea] bg-white px-3 py-2.5 text-[12px] leading-relaxed text-[#1a1a1f] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  />
                  <p className="mt-1 text-[11px] text-[#9a9aa5]">Enter declaration points, or leave blank to keep empty.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-semibold text-[#4a4a55]">
                    Rejection Policy (one item per line)
                  </label>
                  <textarea
                    rows={6}
                    value={rejectionPolicyText}
                    placeholder={"1. Loose Winding & Tight Release\n2. For all Rejection and Quality Claims, End user Email/Samples for evaluation is mandatory."}
                    onChange={(e) => {
                      setRejectionPolicyText(e.target.value);
                      try { localStorage.setItem("gns_invoice_rejection_policy", e.target.value); } catch { /* ignore */ }
                    }}
                    className="w-full rounded-lg border border-[#e4e4ea] bg-white px-3 py-2.5 text-[12px] leading-relaxed text-[#1a1a1f] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  />
                  <p className="mt-1 text-[11px] text-[#9a9aa5]">Enter rejection policy points, or leave blank to keep empty.</p>
                </div>
              </div>
            )}
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
        item={itemToEdit}
        onClose={() => {
          setAddItemOpen(false);
          setItemToEdit(null);
        }}
        onSaved={(line) => {
          if (!line) return;
          const gst = Number(line.gst_pct) || 0;
          const half = gst / 2;
          const withAmount = {
            ...emptyItem(),
            ...line,
            cgst_pct: useIgst ? "" : half || "",
            sgst_pct: useIgst ? "" : half || "",
            igst_pct: useIgst ? gst || "" : "",
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
          try { localStorage.setItem("gns_invoice_terms_data", body); } catch { /* ignore */ }
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
      <ChangeInvoiceTypeModal
        open={Boolean(pendingInvoiceType)}
        onClose={() => setPendingInvoiceType(null)}
        onConfirm={() => {
          if (pendingInvoiceType) resetInvoiceData(pendingInvoiceType);
        }}
      />
    </form>
  );
}
