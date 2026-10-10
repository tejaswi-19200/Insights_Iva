import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Building2, ChevronDown, FileText, Grid2x2, GripVertical, ImagePlus, Paperclip, MapPin, Package, PenLine, Plane, Plus, Ban, Search, Ship, TrainFront, Trash2, Truck, User, X } from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import AddCustomFieldModal from "../../components/sales/AddCustomFieldModal";
import AddNewItemModal from "../../components/sales/AddNewItemModal";
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
import { createBizDocument, getBizDocument, updateBizDocument } from "../../api/bizDocumentsApi";
import { getVendors } from "../../api/procurementApi";
import { getCompanySettings } from "../../api/settingsApi";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../utils/apiError";
import {
  ERP_PRIMARY,
  ERP_PRIMARY_SOFT,
  FieldLabel,
  SoftInput,
  SoftSelect,
  Pill,
} from "../../design-system/erpFormControls";

const YELLOW = "var(--color-primary)";
const PREFIX_STORAGE_KEY = "gns_purchase_debit_note_prefixes";
const DEFAULT_PREFIXES = ["DN"];

function loadCustomPrefixes() {
  try {
    const prefixes = JSON.parse(localStorage.getItem(PREFIX_STORAGE_KEY) || "[]");
    return Array.isArray(prefixes) ? prefixes.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomPrefixes(prefixes) {
  try {
    localStorage.setItem(PREFIX_STORAGE_KEY, JSON.stringify(prefixes));
  } catch {
    /* ignore unavailable storage */
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

function PrefixDropdown({ value, options, onChange, onAddNew }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between border-0 border-b border-[#1a1a1f] bg-transparent py-2 text-left text-[13px] font-medium text-[#1a1a1f] focus:outline-none"
      >
        <span>{value || "No Prefix"}</span>
        <ChevronDown className={`h-4 w-4 text-[#6b6b76] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close prefix menu" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-[#e4e4ea] bg-white shadow-lg">
            <div className="space-y-2 p-2">
              {["", ...options].map((prefix) => (
                <button
                  key={prefix || "none"}
                  type="button"
                  onClick={() => {
                    onChange(prefix);
                    setOpen(false);
                  }}
                  className={`block w-full rounded-lg border-2 py-2.5 text-center text-[13px] font-bold ${
                    value === prefix ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-primary)]/70 bg-[var(--color-primary-soft)] hover:bg-[var(--color-primary-soft)]"
                  }`}
                >
                  {prefix || "No Prefix"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddNew();
              }}
              className="w-full bg-[var(--color-primary-soft)] py-3 text-center text-[13px] font-semibold text-[var(--color-primary)] hover:opacity-90"
            >
              + Add New Prefix
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
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
    <div className="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-[#3d3560]">
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

export default function PurchaseDebitNoteForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams();
  const editId = routeId || location.state?.viewId || null;
  const isEdit = Boolean(editId);
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [company, setCompany] = useState(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showSellerPicker, setShowSellerPicker] = useState(false);
  const [dispatchAddress, setDispatchAddress] = useState(null);
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [otherChargeOpen, setOtherChargeOpen] = useState(false);
  const [otherChargeMeta, setOtherChargeMeta] = useState(null);
  const [transportOpen, setTransportOpen] = useState(true);
  const [otherDetailsOpen, setOtherDetailsOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);
  const [termsAttached, setTermsAttached] = useState(true);
  const [termsPickerOpen, setTermsPickerOpen] = useState(false);
  const [termsAddOpen, setTermsAddOpen] = useState(false);
  const [transporterModalOpen, setTransporterModalOpen] = useState(false);
  const [customFieldOpen, setCustomFieldOpen] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [noteType, setNoteType] = useState("debit_note");
  const [showGstTds, setShowGstTds] = useState(false);
  const [showTaxType, setShowTaxType] = useState(false);
  const [taxType, setTaxType] = useState("tcs");
  const [tcsPct, setTcsPct] = useState("");
  const [tcsOn, setTcsOn] = useState("taxable");
  const [tdsCode, setTdsCode] = useState("");
  const [tdsOn, setTdsOn] = useState("taxable");
  const [showPurchaseDiscount, setShowPurchaseDiscount] = useState(false);
  const [purchaseDiscountVal, setPurchaseDiscountVal] = useState("");
  const [purchaseDiscountType, setPurchaseDiscountType] = useState("%");
  const [attachmentName, setAttachmentName] = useState("");
  const [notesText, setNotesText] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState("");
  const [dispatchedDocNo, setDispatchedDocNo] = useState("");
  const [dispatchedThrough, setDispatchedThrough] = useState("");
  const [destination, setDestination] = useState("");
  const [reasonRemark, setReasonRemark] = useState("");
  const [refInvoiceNo, setRefInvoiceNo] = useState("");
  const [refInvoiceDate, setRefInvoiceDate] = useState("");
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
    vendor_id: "",
    debit_note_prefix: "",
    debit_note_number: "1",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    other_charge: 0,
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
  });
  const [items, setItems] = useState([emptyItem(), emptyItem(), emptyItem()]);
  const [dragRowIdx, setDragRowIdx] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [vendorRes, companyRes] = await Promise.allSettled([
          getVendors(),
          getCompanySettings(),
        ]);
        if (cancelled) return;
        setVendors(vendorRes.status === "fulfilled" ? vendorRes.value?.data || [] : []);
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

        if (editId) {
          const doc =
            location.state?.document ||
            (await getBizDocument(editId)).data;
          if (!doc) throw new Error("Debit note not found");
          const meta = doc.meta || {};
          const num = String(doc.document_number || "");
          const prefixMatch = num.match(/^([A-Za-z-]+)/);
          setNoteType(meta.note_type || "debit_note");
          setNotesText(doc.notes || "");
          setCustomFields(Array.isArray(meta.custom_fields) ? meta.custom_fields : []);
          setRefInvoiceNo(meta.purchase_number || "");
          setRefInvoiceDate(meta.purchase_date || "");
          setPaymentMode(meta.payment_mode || "");
          setForm((f) => ({
            ...f,
            ...(meta.transportation || {}),
            vendor_id: meta.vendor_id || f.vendor_id,
            debit_note_prefix: prefixMatch?.[1] || f.debit_note_prefix,
            debit_note_number: num.replace(/^[A-Za-z-]+/, "") || num || f.debit_note_number,
            issue_date: doc.document_date
              ? String(doc.document_date).slice(0, 10)
              : f.issue_date,
            due_date: doc.due_date ? String(doc.due_date).slice(0, 10) : "",
          }));
          const lineItems = Array.isArray(meta.items)
            ? meta.items.map((it) => ({
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
              }))
            : [];
          setItems(lineItems.length ? lineItems : [emptyItem(), emptyItem(), emptyItem()]);
        }
      } catch (err) {
        if (!cancelled) {
          addToast(apiErrorMessage(err, "Failed to load debit note"), "error");
          if (editId) navigate("/purchases/debit-notes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, addToast, navigate, location.state]);

  const filteredVendors = useMemo(
    () =>
      vendors.filter((vendor) =>
        [vendor.name, vendor.vendor_name, vendor.gstin, vendor.state]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(vendorSearch.toLowerCase()))
      ),
    [vendors, vendorSearch]
  );

  const selectedSeller = vendors.find((vendor) => String(vendor.id) === String(form.vendor_id));
  const prefixOptions = useMemo(
    () => [...new Set([...DEFAULT_PREFIXES, ...customPrefixes, form.debit_note_prefix].filter(Boolean))],
    [customPrefixes, form.debit_note_prefix]
  );

  const handleVendorChange = (vendorId) => {
    const vendor = vendors.find((row) => String(row.id) === String(vendorId));
    setForm((f) => ({
      ...f,
      vendor_id: vendorId,
      consignee_name: vendor?.name || vendor?.vendor_name || "",
      consignee_address1: vendor?.address || vendor?.address_line1 || "",
      consignee_state: vendor?.state || "",
      consignee_gstin: vendor?.gstin || "",
    }));
    setShowSellerPicker(false);
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
    addToast("Item Removed from List!", "alert");
  };

  const filledItems = items.filter((i) => i.item_description?.trim());
  const taxableAmount = filledItems.reduce((s, i) => s + lineTotals(i).taxable, 0);
  const gstAmount = filledItems.reduce((s, i) => s + lineTotals(i).gst, 0);
  const itemsTotal = filledItems.reduce((s, i) => s + lineTotals(i).total, 0);
  const otherCharge = Number(form.other_charge) || 0;
  const purchaseDiscount = money(
    purchaseDiscountType === "%"
      ? (itemsTotal * (Number(purchaseDiscountVal) || 0)) / 100
      : Number(purchaseDiscountVal) || 0
  );
  const gstTdsAmount = showGstTds ? money(taxableAmount * 0.02) : 0;
  const taxBase = taxType === "tcs" ? (tcsOn === "final" ? itemsTotal + otherCharge : taxableAmount) : (tdsOn === "final" ? itemsTotal + otherCharge : taxableAmount);
  const tcsOrTdsAmount = showTaxType
    ? money((taxBase * (taxType === "tcs" ? Number(tcsPct) || 0 : tdsCode === "194Q" ? 0.1 : tdsCode === "194C" ? 1 : 0)) / 100)
    : 0;
  const finalAmount = money(itemsTotal + otherCharge - purchaseDiscount - gstTdsAmount - tcsOrTdsAmount);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vendor_id) {
      addToast("Please select a seller", "error");
      setShowSellerPicker(true);
      return;
    }
    if (filledItems.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        module: "purchases",
        doc_type: "purchase_debit_note",
        document_number: [form.debit_note_prefix, form.debit_note_number].filter(Boolean).join("") || String(Date.now()).slice(-6),
        party_name: selectedSeller?.name || selectedSeller?.vendor_name || null,
        document_date: form.issue_date,
        due_date: form.due_date || null,
        amount: finalAmount,
        status: "issued",
        notes: notesText || null,
        meta: {
          note_type: noteType,
          vendor_id: form.vendor_id,
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
          gst_tds: showGstTds ? gstTdsAmount : null,
          tcs_tds: showTaxType ? { type: taxType, amount: tcsOrTdsAmount, percentage: taxType === "tcs" ? Number(tcsPct) || 0 : tdsCode, on: taxType === "tcs" ? tcsOn : tdsOn } : null,
          other_charge: otherCharge,
          discount: showPurchaseDiscount ? purchaseDiscount : null,
          settlement_status: "unsettled",
          amount_settled: 0,
          e_waybill_status: form.ewaybill_number ? "active" : "all",
          attachment_name: attachmentName || null,
          has_document: Boolean(attachmentName),
          transportation: { ...form },
          purchase_number: refInvoiceNo || null,
          purchase_date: refInvoiceDate || null,
          payment_mode: paymentMode || null,
          dispatched_doc_no: dispatchedDocNo || null,
          dispatched_through: dispatchedThrough || null,
          destination: destination || null,
          reason_remark: reasonRemark || null,
          dispatch_address: dispatchAddress,
          signature: signatureOn ? signatureDataUrl : null,
          stamp: signatureOn ? stampDataUrl : null,
          show_signature: signatureOn,
          custom_fields: customFields,
        },
      };
      if (isEdit) {
        await updateBizDocument(editId, payload);
        addToast("Debit note updated");
      } else {
        await createBizDocument(payload);
        addToast("Debit note created");
      }
      navigate("/purchases/debit-notes");
    } catch (err) {
      console.error(err);
      addToast(apiErrorMessage(err, "Failed to save debit note"), "error");
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e4e4ea] bg-white px-5 py-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/purchases/debit-notes")}
            className="rounded-lg p-1.5 text-[#4a4a55] hover:bg-[#F5F5F5]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/purchases/debit-notes")}
            className="rounded-lg border border-[#e4e4ea] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a4a55] hover:bg-[#F5F5F5]"
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
          {/* Top: debit-note type + company buyer */}
          <div className="grid overflow-hidden rounded-xl border border-[#d0d0d8] bg-white lg:grid-cols-[1fr_1.35fr]">
          <section className="border-b border-[#d0d0d8] p-4 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex flex-wrap gap-5 border-b border-[#d0d0d8] pb-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#1a1a1f]">
                <input
                  type="radio"
                  name="noteType"
                  className="sr-only"
                  checked={noteType === "debit_note"}
                  onChange={() => setNoteType("debit_note")}
                />
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--color-primary)] ${noteType === "debit_note" ? "" : "border-[#d0d0d8]"}`}>
                  {noteType === "debit_note" ? <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" /> : null}
                </span>
                Debit Note
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[#1a1a1f]">
                <input
                  type="radio"
                  name="noteType"
                  className="sr-only"
                  checked={noteType === "purchase_return"}
                  onChange={() => setNoteType("purchase_return")}
                />
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${noteType === "purchase_return" ? "border-[var(--color-primary)]" : "border-[#d0d0d8]"}`}>
                  {noteType === "purchase_return" ? <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" /> : null}
                </span>
                Purchase Return
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <FieldLabel>Debit Note Prefix</FieldLabel>
                <PrefixDropdown
                  value={form.debit_note_prefix}
                  options={prefixOptions}
                  onChange={(debitNotePrefix) => setForm((f) => ({ ...f, debit_note_prefix: debitNotePrefix }))}
                  onAddNew={() => setPrefixModalOpen(true)}
                />
              </label>
              <label className="block">
                <FieldLabel>Debit Note No.</FieldLabel>
                <SoftInput
                  value={form.debit_note_number}
                  onChange={(e) => setForm((f) => ({ ...f, debit_note_number: e.target.value }))}
                />
              </label>
              <label className="block">
                <FieldLabel>Debit Note Date</FieldLabel>
                <SoftInput
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden bg-white">
            <SectionHeader icon={Building2} title="Buyer Details" />
            <div className="flex items-start justify-between gap-4 border-t-0 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-[#1a1a1f]">{companyName}</p>
                  <button
                    type="button"
                    onClick={() => setEditCompanyOpen(true)}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[#6b4eff] hover:underline"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    Edit Company Details
                  </button>
                </div>
                <DispatchAddressPicker
                  value={dispatchAddress}
                  onChange={setDispatchAddress}
                  addLabel="+ Add Dispatch Address (Consignor)"
                />
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

        {/* Seller */}
        <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
          <SectionHeader icon={User} title="Seller Details">
            <button
              type="button"
              onClick={() => setShowSellerPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
              style={{ background: ERP_PRIMARY }}
            >
              <User className="h-3.5 w-3.5" />
              Select Seller
            </button>
            <button
              type="button"
              onClick={() => navigate("/procurement/vendors/create")}
              className="inline-flex items-center gap-1 rounded-lg border border-[#6b4eff] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#6b4eff]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Seller
            </button>
          </SectionHeader>
          <div className="min-h-[88px] border-t-0 p-4">
            <div className="min-h-[56px] rounded-lg border border-[#d0d0d8] bg-[#fafafa] p-3">
            {showSellerPicker && (
              <div className="mb-3 rounded-lg border border-[#d0d0d8] bg-white p-3">
                <SearchBar
                  size="compact"
                  value={vendorSearch}
                  onChange={setVendorSearch}
                  placeholder="Search"
                  className="mb-2 w-full"
                  inputClassName="pending-inventory-search-input"
                />
                <div className="max-h-44 overflow-y-auto">
                  {filteredVendors.length === 0 ? (
                    <p className="p-2 text-[13px] text-[#8a8a95]">
                      No sellers found.{" "}
                      <button
                        type="button"
                        onClick={() => navigate("/procurement/vendors/create")}
                        className="font-medium"
                        style={{ color: ERP_PRIMARY }}
                      >
                        Add a seller
                      </button>
                    </p>
                  ) : (
                    filteredVendors.map((vendor) => (
                      <button
                        key={vendor.id}
                        type="button"
                        onClick={() => handleVendorChange(vendor.id)}
                        className={`block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-white ${
                          String(form.vendor_id) === String(vendor.id) ? "bg-white font-semibold" : ""
                        }`}
                      >
                        {vendor.name || vendor.vendor_name}
                        {vendor.gstin ? ` · ${vendor.gstin}` : ""}
                        {vendor.state ? ` · ${vendor.state}` : ""}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            {selectedSeller ? (
              <div className="grid gap-1 text-[13px] sm:grid-cols-2">
                <p className="font-semibold text-[#1a1a1f]">{selectedSeller.name || selectedSeller.vendor_name}</p>
                <p className="text-[#6b6b76]">{selectedSeller.gstin || "—"}</p>
                <p className="text-[#6b6b76] sm:col-span-2">
                  {[form.consignee_address1, form.consignee_address2, form.consignee_state]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
            ) : !showSellerPicker ? (
              <p className="py-4 text-center text-[13px] text-[#a0a0ab]">Select a seller to continue</p>
            ) : null}
            </div>
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
                  {["S.No", "Item Name", "HSN", "Qty", "Unit", "Price", "Tax Type", "Discount", "Taxable Value", "GST", "Total Amt", ""].map(
                    (h, hi) => (
                      <th
                        key={`${h}-${hi}`}
                        className="whitespace-nowrap border-b border-r border-[#d0d0d8] px-2 py-2.5 font-semibold last:border-r-0"
                      >
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
                  const cell = "border-b border-r border-[#d0d0d8] px-2 py-2 last:border-r-0";
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
                      <td className={`${cell} text-[#9a9aa5]`}>
                        <div className="flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder row">
                          <GripVertical className="h-3.5 w-3.5 text-[#a0a0ab] hover:text-blue-600 shrink-0" />
                          <span>{idx + 1}</span>
                        </div>
                      </td>
                      <td className={cell}>
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
                            inputClassName="pending-inventory-search-input"
                          />
                        </div>
                      </td>
                      <td className={cell}>
                        <input
                          value={row.hsn}
                          onChange={(e) => updateItem(idx, "hsn", e.target.value)}
                          className="w-16 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        />
                      </td>
                      <td className={cell}>
                        <ShorthandQuantityInput
                          value={row.qty}
                          onChange={(val) => updateItem(idx, "qty", val)}
                          placeholder="0"
                          className="w-20 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5 text-[12px] text-[#1a1a1f]"
                        />
                      </td>
                      <td className={cell}>
                        <select
                          value={row.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                          className="w-full rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5"
                        >
                          <option value="">Unit</option>
                          <option value="pcs">pcs</option>
                          <option value="KGS">KGS</option>
                          <option value="MT">MT</option>
                        </select>
                      </td>
                      <td className={cell}>
                        <ShorthandQuantityInput
                          value={row.rate}
                          onChange={(val) => updateItem(idx, "rate", val)}
                          prefix="₹"
                          placeholder="0"
                          className="w-24 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5 text-[12px] text-[#1a1a1f]"
                        />
                      </td>
                      <td className={cell}>
                        <select
                          value={row.tax_type}
                          onChange={(e) => updateItem(idx, "tax_type", e.target.value)}
                          className="w-full rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        >
                          <option>Exclusive</option>
                          <option>Inclusive</option>
                        </select>
                      </td>
                      <td className={cell}>
                        <div className="flex gap-1">
                          <ShorthandQuantityInput
                            value={row.discount}
                            onChange={(val) => updateItem(idx, "discount", val)}
                            placeholder="0"
                            className="w-20 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5 text-[12px] text-[#1a1a1f]"
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
                      <td className={`${cell} tabular-nums text-[#6b6b76]`}>
                        {hasDesc ? t.taxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className={cell}>
                        <select
                          value={row.gst_pct}
                          onChange={(e) => updateItem(idx, "gst_pct", e.target.value)}
                          className="w-full rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                        >
                          <option value="">—</option>
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </td>
                      <td className={`${cell} font-semibold tabular-nums`}>
                        {hasDesc ? t.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
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
              {showGstTds ? (
                <div className="flex items-center justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 text-[#b42318]">
                  <span><button type="button" onClick={() => setShowGstTds(false)} className="mr-1"><X className="inline h-3.5 w-3.5" /></button>2% GST TDS</span>
                  <span>₹ {gstTdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (deducted)</span>
                </div>
              ) : null}
              {showTaxType ? (
                <div className="space-y-2 border-b border-dashed border-[#d0d0d8] p-3">
                  <div className="flex items-center justify-between text-[#1a1a1f]">
                    <span className="font-medium">Select Tax Type</span>
                    <button type="button" onClick={() => setShowTaxType(false)} className="text-[#b42318]"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="flex gap-3 text-[12px]">
                    {["tcs", "tds"].map((type) => <label key={type}><input type="radio" checked={taxType === type} onChange={() => setTaxType(type)} /> {type.toUpperCase()}</label>)}
                  </div>
                  {taxType === "tcs" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <SoftInput type="number" placeholder="TCS %" value={tcsPct} onChange={(e) => setTcsPct(e.target.value)} />
                      <label className="text-[11px] text-[#6b6b76]">TCS on<SoftSelect value={tcsOn} onChange={(e) => setTcsOn(e.target.value)}><option value="taxable">Taxable Amount</option><option value="final">Final Amount</option></SoftSelect></label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <SoftSelect value={tdsCode} onChange={(e) => setTdsCode(e.target.value)}><option value="">Select TDS</option><option value="194Q">194Q (0.1%)</option><option value="194C">194C (1%)</option></SoftSelect>
                      <label className="text-[11px] text-[#6b6b76]">TDS on<SoftSelect value={tdsOn} onChange={(e) => setTdsOn(e.target.value)}><option value="taxable">Taxable Amount</option><option value="final">Final Amount</option></SoftSelect></label>
                    </div>
                  )}
                  <div className="flex justify-between text-[#b42318]"><span>{taxType.toUpperCase()} deducted</span><span>₹ {tcsOrTdsAmount.toFixed(2)}</span></div>
                </div>
              ) : null}
              {showPurchaseDiscount ? (
                <div className="flex items-center gap-2 border-b border-dashed border-[#d0d0d8] p-3">
                  <button type="button" onClick={() => setShowPurchaseDiscount(false)} className="text-[#b42318]"><X className="h-4 w-4" /></button>
                  <ShorthandQuantityInput
                    value={purchaseDiscountVal}
                    onChange={(val) => setPurchaseDiscountVal(val)}
                    placeholder="Discount"
                  />
                  <SoftSelect value={purchaseDiscountType} onChange={(e) => setPurchaseDiscountType(e.target.value)} className="max-w-16"><option>%</option><option>₹</option></SoftSelect>
                </div>
              ) : null}
              <div className="flex justify-between border-b border-[#d0d0d8] bg-[#fafafa] px-3 py-2.5 text-[16px] font-bold text-[#1a1a1f]">
                <span>Final Amount</span>
                <span className="tabular-nums">₹ {finalAmount.toFixed(2)}</span>
              </div>
              <div className="flex flex-col gap-2 p-3">
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
                  onClick={() => setShowGstTds(true)}
                  className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  + Add 2% GST TDS
                </button>
                <button type="button" onClick={() => setShowTaxType(true)} className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}>
                  + Add TCS/TDS
                </button>
                <button type="button" onClick={() => setShowPurchaseDiscount(true)} className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}>
                  + Add Debit Note Level Discount
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* OPTIONAL FIELDS */}
        <div className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
          <div
            className="border-b border-[#d0d0d8] px-4 py-3 text-center text-[12px] font-bold uppercase tracking-[0.12em] text-[#3d3560]"
            style={{ background: ERP_PRIMARY_SOFT }}
          >
            Optional Fields
          </div>

          <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-[#d0d0d8]">
            {/* Transportation */}
            <section className="overflow-hidden border-b border-[#d0d0d8] bg-white lg:border-b-0">
              <SectionHeader
                icon={Truck}
                title="Transportation Details"
                collapsible
                open={transportOpen}
                onToggle={() => setTransportOpen((v) => !v)}
              />
              {transportOpen ? (
              <div className="space-y-4 border-t-0 p-4">
                <div className="border-b border-[#e8e8ee] pb-4">
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
                            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[12px] font-semibold text-[#2563eb]"
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
                    className="shrink-0 text-[13px] font-semibold text-[#2563eb]"
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
                      {["B2B", "SEZWP", "SEZWOP", "EXPWP", "EXPWOP", "DEXP"].map((t) => (
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
            <section className="overflow-hidden bg-white">
              <SectionHeader
                icon={Grid2x2}
                title="Other Details"
                collapsible
                open={otherDetailsOpen}
                onToggle={() => setOtherDetailsOpen((v) => !v)}
              />
              {otherDetailsOpen ? (
              <div className="space-y-3 p-4">
                <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-[#e8e8ee]">
                  <label className="block border-b border-[#e8e8ee] p-3 sm:border-b">
                    <FieldLabel>Purchase No.</FieldLabel>
                    <SoftInput
                      placeholder="Enter Purchase No."
                      value={refInvoiceNo}
                      onChange={(e) => setRefInvoiceNo(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Purchase Date</FieldLabel>
                    <SoftInput
                      type="date"
                      value={refInvoiceDate}
                      onChange={(e) => setRefInvoiceDate(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Challan Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter Challan Number"
                      value={form.challan_number}
                      onChange={(e) => setForm((f) => ({ ...f, challan_number: e.target.value }))}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>E-Waybill Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter E-Waybill Number"
                      value={form.ewaybill_number}
                      onChange={(e) => setForm((f) => ({ ...f, ewaybill_number: e.target.value }))}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Payment Mode</FieldLabel>
                    <SoftInput
                      placeholder="Enter Payment Mode"
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Dispatched Doc No</FieldLabel>
                    <SoftInput
                      placeholder="Enter Dispatched Doc No"
                      value={dispatchedDocNo}
                      onChange={(e) => setDispatchedDocNo(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Dispatched Through</FieldLabel>
                    <SoftInput
                      placeholder="Enter Dispatched Through"
                      value={dispatchedThrough}
                      onChange={(e) => setDispatchedThrough(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[#e8e8ee] p-3">
                    <FieldLabel>Destination</FieldLabel>
                    <SoftInput
                      placeholder="Enter Destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block border border-[#e8e8ee] p-3">
                  <FieldLabel>Reason/Remark</FieldLabel>
                  <SoftInput
                    placeholder="Enter Reason/Remark"
                    value={reasonRemark}
                    onChange={(e) => setReasonRemark(e.target.value)}
                  />
                </label>
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#c4b5fd] bg-white px-3 py-2 text-[13px] font-semibold"
                  style={{ color: ERP_PRIMARY }}
                >
                  <Plus className="h-4 w-4" />
                  Add Custom Field
                </button>
              </div>
              ) : null}
            </section>
          </div>
        </div>

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
              <div className="border-t border-[#d0d0d8] p-4">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-md border border-[#d0d0d8] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#1a1a1f] focus:border-[#6b4eff] focus:outline-none focus:ring-1 focus:ring-[#c4b5fd]"
                />
              </div>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={Paperclip} title="Attach Purchase Document" />
            <label className="m-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#d0d0d8] bg-[#fafafa] text-[13px] text-[#6b6b76] hover:bg-[#f8f5ff]">
              <Paperclip className="mb-2 h-5 w-5 text-[#6b4eff]" />
              {attachmentName || "Choose or drop a purchase document"}
              <input type="file" className="sr-only" onChange={(e) => setAttachmentName(e.target.files?.[0]?.name || "")} />
            </label>
          </section>

          {/* Notes */}
          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={FileText} title="Notes">
              <button
                type="button"
                onClick={() => setNoteModalOpen(true)}
                className="rounded-full border border-[#d0d0d8] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#4a4a55]"
              >
                + Add New Note
              </button>
            </SectionHeader>
            {notesText ? (
              <div className="border-t border-[#d0d0d8] p-4 text-[13px] leading-relaxed text-[#4a4a55] whitespace-pre-wrap">
                {notesText}
              </div>
            ) : (
              <div className="min-h-[48px] border-t border-[#d0d0d8]" />
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader icon={User} title="Signature and Stamp">
              <button
                type="button"
                role="switch"
                aria-checked={signatureOn}
                onClick={() => setSignatureOn((current) => !current)}
                className={`relative h-6 w-11 rounded-full transition ${signatureOn ? "bg-[var(--color-primary)]" : "bg-[#d4d4d8]"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${signatureOn ? "left-[22px]" : "left-0.5"}`} />
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

      <EditCompanyDetailsModal
        open={editCompanyOpen}
        onClose={() => setEditCompanyOpen(false)}
        onSaved={(data) => setCompany(data)}
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
          setCustomPrefixes((current) => {
            const next = current.includes(value) ? current : [...current, value];
            saveCustomPrefixes(next);
            return next;
          });
          setForm((f) => ({ ...f, debit_note_prefix: value }));
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
