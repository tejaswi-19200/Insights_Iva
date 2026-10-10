import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, ChevronDown, FileText, Grid2x2, ImagePlus, Paperclip, MapPin, Package, PenLine, Plane, Plus, Ban, Search, Ship, TrainFront, Trash2, Truck, User, X } from "lucide-react";

import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import AddCustomFieldModal from "../../components/sales/AddCustomFieldModal";
import AddNewItemModal from "../../components/sales/AddNewItemModal";
import AddOtherChargesModal, {
  computeOtherChargeTotal,
} from "../../components/sales/AddOtherChargesModal";
import AddNewPartyModal from "../../components/sales/AddNewPartyModal";
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
import { getInventoryDashboard } from "../../api/inventoryApi";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  getVendors,
  updatePurchaseOrder,
} from "../../api/procurementApi";
import { getCompanySettings } from "../../api/settingsApi";
import { useToast } from "../../context/ToastContext";
import useTenantId from "../../hooks/useTenantId";
import { apiErrorMessage, asArray } from "../../utils/apiError";
import {
  ERP_PRIMARY,
  ERP_PRIMARY_SOFT,
  FieldLabel,
  SoftInput,
  SoftSelect,
  Pill,
} from "../../design-system/erpFormControls";
import {
  joinPoNumber,
  newPoLineRow,
  splitPoNumber,
  suggestClonedPoSuffix,
} from "../../utils/purchaseOrderFormUtils";
import FileUploader from "../../components/common/FileUploader";
import {
  openEntityFileDownload,
  uploadAndAttachEntityDocument,
} from "../../utils/entityDocuments";
import { attachFile, mapFileUploadError } from "../../api/filesApi";

const YELLOW = "var(--color-primary)";
const PREFIX_STORAGE_KEY = "gns_purchase_order_prefixes";
const DEFAULT_PREFIXES = ["PO"];
const BLUE_ACTION_BTN =
  "inline-flex items-center justify-center rounded-lg border border-[var(--color-action-blue)] bg-[var(--color-action-blue)] px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-action-blue-hover)] active:bg-[var(--color-action-blue-active)]";

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
    /* ignore */
  }
}

const emptyItem = () => newPoLineRow();

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
        className="flex w-full items-center justify-between border-0 border-b border-[var(--color-text)] bg-transparent py-2 text-left text-[13px] font-medium text-[var(--color-text)] focus:outline-none"
      >
        <span>{value || "No Prefix"}</span>
        <ChevronDown className={`h-4 w-4 text-[var(--color-text-muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close prefix menu" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
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
    <div className="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-[var(--color-text)]">
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span className="truncate">{title}</span>
      {collapsible ? (
        <ChevronDown
          className={`ml-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      ) : null}
    </div>
  );

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3 ${className}`}
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

export default function CreatePurchaseOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const cloneSourceId = searchParams.get("clone");
  const { id: routeId } = useParams();
  const editId = routeId || location.state?.viewId || null;
  const isEdit = Boolean(editId);
  const attachmentInputRef = useRef(null);
  const tenantId = useTenantId();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [company, setCompany] = useState(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showSellerPicker, setShowSellerPicker] = useState(false);
  const [addSellerOpen, setAddSellerOpen] = useState(false);
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
  const [prefixModalOpen, setPrefixModalOpen] = useState(false);
  const [customPrefixes, setCustomPrefixes] = useState(loadCustomPrefixes);
  const [signatureOn, setSignatureOn] = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_signature_data") || null; } catch { return null; }
  });
  const [stampDataUrl, setStampDataUrl] = useState(() => {
    try { return localStorage.getItem("gns_invoice_stamp_data") || null; } catch { return null; }
  });
  const [catalogItems, setCatalogItems] = useState([]);
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
  const [poAttachments, setPoAttachments] = useState([]);
  const [pendingPoFiles, setPendingPoFiles] = useState([]);
  const [docUploadBusy, setDocUploadBusy] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState("");
  const [dispatchedDocNo, setDispatchedDocNo] = useState("");
  const [dispatchedThrough, setDispatchedThrough] = useState("");
  const [destination, setDestination] = useState("");
  const [reasonRemark, setReasonRemark] = useState("");
  const [refInvoiceNo, setRefInvoiceNo] = useState("");
  const [refInvoiceDate, setRefInvoiceDate] = useState("");
  const [form, setForm] = useState({
    supplier_id: "",
    po_prefix: "",
    po_number: "1",
    order_date: new Date().toISOString().slice(0, 10),
    expected_date: "",
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
    po_number_ref: "",
    po_date_ref: "",
    challan_number: "",
    ewaybill_number: "",
    sales_person: "",
    reverse_charge: false,
  });
  const [items, setItems] = useState([emptyItem(), emptyItem(), emptyItem()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [vendorRes, companyRes, itemRes] = await Promise.allSettled([
          getVendors(),
          getCompanySettings(),
          getInventoryDashboard(),
        ]);
        if (cancelled) return;
        setVendors(vendorRes.status === "fulfilled" ? vendorRes.value?.data || [] : []);
        const co = companyRes.status === "fulfilled" ? companyRes.value?.data || null : null;
        setCompany(co);
        if (co?.po_prefix) {
          setForm((f) => ({ ...f, po_prefix: f.po_prefix || co.po_prefix }));
        }
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
        const dash = itemRes.status === "fulfilled" ? itemRes.value?.data : null;
        const itemList = Array.isArray(dash)
          ? dash
          : asArray(dash?.items).length
            ? asArray(dash.items)
            : asArray(dash?.inventory_items);
        setCatalogItems(itemList);

        const loadPoId = editId || cloneSourceId;
        if (loadPoId) {
          const po = location.state?.document || (await getPurchaseOrder(loadPoId)).data;
          if (!po) throw new Error("Purchase order not found");
          const knownPrefixes = [
            ...DEFAULT_PREFIXES,
            ...loadCustomPrefixes(),
            co?.po_prefix,
            form.po_prefix,
          ];
          const { prefix, suffix } = splitPoNumber(po.po_number, knownPrefixes);
          setNotesText(po.notes || "");
          setForm((f) => ({
            ...f,
            supplier_id: po.supplier_id ? String(po.supplier_id) : "",
            po_prefix: prefix || f.po_prefix || co?.po_prefix || "PO",
            po_number: editId
              ? suffix || f.po_number
              : suggestClonedPoSuffix(suffix || f.po_number),
            order_date: editId
              ? po.order_date
                ? String(po.order_date).slice(0, 10)
                : f.order_date
              : new Date().toISOString().slice(0, 10),
            expected_date: po.expected_date ? String(po.expected_date).slice(0, 10) : "",
            notes: po.notes || f.notes,
          }));
          const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
          setItems(
            lineItems.length
              ? lineItems.map((it) => {
                  const inv = itemList.find((i) => String(i.id || i.item_id) === String(it.item_id));
                  return newPoLineRow({
                    item_id: it.item_id,
                    item_description: inv?.name || inv?.item_name || `Item #${it.item_id}`,
                    qty: it.qty ?? it.quantity ?? "",
                    unit: it.item_unit || inv?.unit || "pcs",
                    rate: it.rate ?? it.unit_price ?? "",
                  });
                })
              : [emptyItem(), emptyItem(), emptyItem()]
          );
          if (cloneSourceId) {
            addToast("Purchase order cloned — review PO number before saving.", "info");
          }
          setPoAttachments(editId && Array.isArray(po.attachments) ? po.attachments : []);
        }
      } catch (err) {
        if (!cancelled) {
          addToast(apiErrorMessage(err, "Failed to load purchase order"), "error");
          if (editId) navigate("/procurement/purchase-orders");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, cloneSourceId, addToast, navigate, location.state]);

  const filteredVendors = useMemo(
    () =>
      vendors.filter((vendor) =>
        [vendor.name, vendor.vendor_name, vendor.gstin, vendor.state]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(vendorSearch.toLowerCase()))
      ),
    [vendors, vendorSearch]
  );

  const selectedSeller = vendors.find((vendor) => String(vendor.id) === String(form.supplier_id));

  const prefixOptions = useMemo(
    () => [...new Set([...DEFAULT_PREFIXES, ...customPrefixes, form.po_prefix].filter(Boolean))],
    [customPrefixes, form.po_prefix]
  );

  const handleVendorChange = (vendorId) => {
    const vendor = vendors.find((row) => String(row.id) === String(vendorId));
    setForm((f) => ({
      ...f,
      supplier_id: vendorId,
      consignee_name: vendor?.name || vendor?.vendor_name || "",
      consignee_address1: vendor?.address || vendor?.address_line1 || "",
      consignee_state: vendor?.state || "",
      consignee_gstin: vendor?.gstin || "",
    }));
    setShowSellerPicker(false);
  };

  const updateItem = (rowKey, field, val) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row._rowKey !== rowKey) return row;
        const next = { ...row, [field]: val };
        next.amount = lineTotals(next).total;
        return next;
      })
    );
  };

  const syncCatalogItem = (rowKey, label) => {
    const name = String(label || "").trim().toLowerCase();
    if (!name) return;
    const match = catalogItems.find(
      (i) => String(i.name || i.item_name || i.product_name || "").trim().toLowerCase() === name
    );
    if (!match) return;
    const id = match.id || match.item_id;
    const price = match.unit_price ?? match.purchase_price ?? match.unit_cost ?? match.price ?? "";
    setItems((prev) =>
      prev.map((row) => {
        if (row._rowKey !== rowKey) return row;
        const next = {
          ...row,
          item_id: id,
          item_description: match.name || match.item_name || match.product_name || row.item_description,
          hsn: match.hsn || match.hsn_sac || match.hsn_code || row.hsn,
          unit: match.unit || match.unit_of_measure || row.unit || "pcs",
          rate: price === null || price === undefined ? row.rate : String(price),
        };
        next.amount = lineTotals(next).total;
        return next;
      })
    );
  };

  const removeItem = (rowKey) => {
    setItems((prev) => {
      const next = prev.filter((row) => row._rowKey !== rowKey);
      return next.length ? next : [emptyItem()];
    });
    addToast("Item Removed from List!", "alert");
  };

  const filledItems = items.filter((i) => i.item_description?.trim() && Number(i.qty) > 0);
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
    if (saving) return;
    if (!form.supplier_id) {
      addToast("Please select a seller", "error");
      setShowSellerPicker(true);
      return;
    }
    if (filledItems.length === 0) {
      addToast("Add at least one item", "error");
      return;
    }
    const missingItemId = filledItems.some((i) => !i.item_id);
    if (missingItemId) {
      addToast("Each line item must be selected from inventory.", "error");
      return;
    }
    setSaving(true);
    try {
      const metaNotes = [
        notesText || "",
        form.notes || "",
        dispatchAddress ? `Consignee: ${JSON.stringify(dispatchAddress)}` : "",
        customFields.length ? `Custom fields: ${JSON.stringify(customFields)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const poPayload = {
        tenant_id: tenantId,
        supplier_id: Number(form.supplier_id),
        po_number: joinPoNumber(form.po_prefix, form.po_number) || `PO-${Date.now()}`,
        order_date: form.order_date,
        expected_date: form.expected_date || null,
        notes: metaNotes || null,
        status: "draft",
        line_items: filledItems.map((i) => ({
          item_id: Number(i.item_id),
          quantity: Number(i.qty) || 0,
          unit_price: i.rate === "" ? null : Number(i.rate),
        })),
      };
      let poId = editId ? Number(editId) : null;
      if (isEdit) {
        const res = await updatePurchaseOrder(editId, poPayload);
        poId = res?.data?.id ?? poId;
        addToast("Purchase order updated.", "success");
      } else {
        const res = await createPurchaseOrder(poPayload);
        poId = res?.data?.id ?? poId;
        addToast("Purchase order created.", "success");
      }
      if (poId) {
        const queue = [...pendingPoFiles];
        if (queue.length) {
          setDocUploadBusy(true);
          try {
            for (const file of queue) {
              await uploadAndAttachEntityDocument(file, "purchase_order", poId, "po_document");
            }
            setPendingPoFiles([]);
          } catch (uploadErr) {
            addToast(mapFileUploadError(uploadErr).message || "Document upload failed.", "error");
          } finally {
            setDocUploadBusy(false);
          }
        }
      }
      navigate("/procurement/purchase-orders");
    } catch (err) {
      addToast(apiErrorMessage(err, "Failed to save purchase order"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center bg-[var(--color-bg)]">
        <Loader label={isEdit ? "Loading purchase order…" : "Loading form…"} />
      </div>
    );
  }

  const companyName = company?.company_name || company?.name || "My Company";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]"
    >
      {/* Sticky header — matches screenshot */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/procurement/purchase-orders")}
            className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/procurement/purchase-orders")}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || docUploadBusy}
            className="rounded-lg px-5 py-2 text-[13px] font-semibold text-white shadow-sm disabled:opacity-60"
            style={{ background: YELLOW }}
          >
            {saving ? "Saving…" : isEdit ? "Update Purchase Order" : "Create Purchase Order"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] space-y-4 p-5 pb-10">
          {/* Top: purchase type + company buyer — bordered two-column panel */}
          <div className="grid overflow-visible rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[1fr_1.35fr]">
          <section className="overflow-visible border-b border-[var(--color-border)] p-4 lg:border-b-0 lg:border-r">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="relative block overflow-visible">
                <FieldLabel>Purchase Order Prefix</FieldLabel>
                <PrefixDropdown
                  value={form.po_prefix}
                  options={prefixOptions}
                  onChange={(poPrefix) => setForm((f) => ({ ...f, po_prefix: poPrefix }))}
                  onAddNew={() => setPrefixModalOpen(true)}
                />
              </label>
              <label className="block">
                <FieldLabel>Purchase Order No.</FieldLabel>
                <SoftInput
                  value={form.po_number}
                  onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))}
                />
              </label>
              <label className="block">
                <FieldLabel>Purchase Order Date</FieldLabel>
                <SoftInput
                  type="date"
                  value={form.order_date}
                  onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden bg-[var(--color-surface)]">
            <SectionHeader icon={Building2} title="Buyer Details" />
            <div className="flex items-start justify-between gap-4 border-t-0 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-semibold text-[var(--color-text)]">{companyName}</p>
                  <button
                    type="button"
                    onClick={() => setEditCompanyOpen(true)}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    Edit Company Details
                  </button>
                </div>
                <DispatchAddressPicker
                  value={dispatchAddress}
                  onChange={setDispatchAddress}
                  addLabel="+ Add Shipping Address (Consignee)"
                />
                {dispatchAddress ? (
                  <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-[var(--color-text-muted)]">
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
                className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-full border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[10px] text-[var(--color-text-faint)]"
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
        <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <SectionHeader icon={User} title="Seller Details">
            <button
              type="button"
              onClick={() => setShowSellerPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-action-teal)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-action-teal-hover)]"
            >
              <User className="h-3.5 w-3.5" />
              Select Seller
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSellerPicker(false);
                setAddSellerOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-action-teal)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-action-teal)] hover:bg-[var(--color-success-soft)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Seller
            </button>
          </SectionHeader>
          <div className="min-h-[88px] border-t-0 p-4">
            <div className="min-h-[56px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            {showSellerPicker && (
              <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
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
                    <p className="p-2 text-[13px] text-[var(--color-text-faint)]">
                      No sellers found.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setShowSellerPicker(false);
                          setAddSellerOpen(true);
                        }}
                        className="font-medium text-[var(--color-action-teal)] hover:underline"
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
                        className={`block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface)] ${
                          String(form.supplier_id) === String(vendor.id) ? "bg-[var(--color-surface)] font-semibold" : ""
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
                <p className="font-semibold text-[var(--color-text)]">{selectedSeller.name || selectedSeller.vendor_name}</p>
                <p className="text-[var(--color-text-muted)]">{selectedSeller.gstin || "—"}</p>
                <p className="text-[var(--color-text-muted)] sm:col-span-2">
                  {[form.consignee_address1, form.consignee_address2, form.consignee_state]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </p>
              </div>
            ) : !showSellerPicker ? (
              <p className="py-4 text-center text-[13px] text-[var(--color-text-muted)]">Select a seller to continue</p>
            ) : null}
            </div>
          </div>
        </section>

        {/* Items */}
        <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <SectionHeader icon={Package} title="Item Details">
            <button
              type="button"
              onClick={() => setAddItemOpen(true)}
              className={BLUE_ACTION_BTN}
            >
              + Add New Item
            </button>
          </SectionHeader>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-[12px]">
              <thead className="ui-table-head">
                <tr>
                  {["#", "Item Name", "HSN", "Qty", "Unit", "Price", "Tax Type", "Discount", "Taxable Value", "GST", "Total Amt", ""].map(
                    (h) => (
                      <th
                        key={h || "x"}
                        className="whitespace-nowrap border-b border-r border-[var(--color-border)] px-2 py-2.5 font-semibold last:border-r-0"
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
                  const cell = "border-b border-r border-[var(--color-border)] px-2 py-2 last:border-r-0";
                  const rowKey = row._rowKey;
                  return (
                    <tr key={rowKey}>
                      <td className={`${cell} text-[var(--color-text-faint)]`}>{idx + 1}</td>
                      <td className={cell}>
                        <div className="relative min-w-[160px]">
                          <SearchBar
                            size="compact"
                            list={`po-item-options-${rowKey}`}
                            value={row.item_description}
                            onChange={(v) => updateItem(rowKey, "item_description", v)}
                            onBlur={(e) => syncCatalogItem(rowKey, e.target.value)}
                            placeholder="Select Item"
                            clearable={false}
                            className="w-full"
                            inputClassName="pending-inventory-search-input"
                          />
                          <datalist id={`po-item-options-${rowKey}`}>
                            {catalogItems.map((item) => (
                              <option
                                key={item.id || item.item_id}
                                value={item.name || item.item_name || item.product_name || ""}
                              />
                            ))}
                          </datalist>
                        </div>
                      </td>
                      <td className={cell}>
                        <input
                          value={row.hsn}
                          onChange={(e) => updateItem(rowKey, "hsn", e.target.value)}
                          className="w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1.5"
                        />
                      </td>
                      <td className={cell}>
                        <ShorthandQuantityInput
                          value={row.qty}
                          onChange={(val) => updateItem(rowKey, "qty", val)}
                          placeholder="0"
                          className="w-24 text-[12px]"
                        />
                      </td>
                      <td className={cell}>
                        <select
                          value={row.unit}
                          onChange={(e) => updateItem(rowKey, "unit", e.target.value)}
                          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-1.5"
                        >
                          <option value="">Unit</option>
                          {row.unit && !["pcs", "KGS", "MT"].includes(row.unit) ? (
                            <option value={row.unit}>{row.unit}</option>
                          ) : null}
                          <option value="pcs">pcs</option>
                          <option value="KGS">KGS</option>
                          <option value="MT">MT</option>
                        </select>
                      </td>
                      <td className={cell}>
                        <ShorthandQuantityInput
                          value={row.rate}
                          onChange={(val) => updateItem(rowKey, "rate", val)}
                          prefix="₹"
                          placeholder="0"
                          className="w-24 text-[12px]"
                        />
                      </td>
                      <td className={cell}>
                        <select
                          value={row.tax_type}
                          onChange={(e) => updateItem(rowKey, "tax_type", e.target.value)}
                          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1.5"
                        >
                          <option>Exclusive</option>
                          <option>Inclusive</option>
                        </select>
                      </td>
                      <td className={cell}>
                        <div className="flex gap-1">
                          <ShorthandQuantityInput
                            value={row.discount}
                            onChange={(val) => updateItem(rowKey, "discount", val)}
                            placeholder="0"
                            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1.5 text-[12px]"
                          />
                          <select
                            value={row.discount_type}
                            onChange={(e) => updateItem(rowKey, "discount_type", e.target.value)}
                            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-1.5"
                          >
                            <option value="₹">₹</option>
                            <option value="%">%</option>
                          </select>
                        </div>
                      </td>
                      <td className={`${cell} tabular-nums text-[var(--color-text-muted)]`}>
                        {hasDesc ? t.taxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      </td>
                      <td className={cell}>
                        <select
                          value={row.gst_pct}
                          onChange={(e) => updateItem(rowKey, "gst_pct", e.target.value)}
                          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1.5"
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
                      <td className="border-b border-[var(--color-border)] px-2 py-2">
                        <button type="button" onClick={() => removeItem(rowKey)} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 border-t border-[var(--color-border)] p-4 sm:flex-row sm:items-start sm:justify-between">
            <button
              type="button"
              onClick={() => setAddItemOpen(true)}
              className={BLUE_ACTION_BTN}
            >
              + Add More Item
            </button>

            <div className="min-w-[260px] overflow-hidden rounded-lg border border-[var(--color-border)] text-[13px]">
              <div className="flex justify-between border-b border-dashed border-[var(--color-border)] px-3 py-2 text-[var(--color-text-muted)]">
                <span>Taxable Amount</span>
                <span className="tabular-nums">₹ {taxableAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[var(--color-border)] px-3 py-2 text-[var(--color-text-muted)]">
                <span>GST Amount</span>
                <span className="tabular-nums">₹ {gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-[var(--color-border)] px-3 py-2 font-medium text-[var(--color-text)]">
                <span>Total Amount</span>
                <span className="tabular-nums">₹ {itemsTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {showGstTds ? (
                <div className="flex items-center justify-between border-b border-dashed border-[var(--color-border)] px-3 py-2 text-[var(--color-danger)]">
                  <span><button type="button" onClick={() => setShowGstTds(false)} className="mr-1"><X className="inline h-3.5 w-3.5" /></button>2% GST TDS</span>
                  <span>₹ {gstTdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (deducted)</span>
                </div>
              ) : null}
              {showTaxType ? (
                <div className="space-y-2 border-b border-dashed border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between text-[var(--color-text)]">
                    <span className="font-medium">Select Tax Type</span>
                    <button type="button" onClick={() => setShowTaxType(false)} className="text-[var(--color-danger)]"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="flex gap-3 text-[12px]">
                    {["tcs", "tds"].map((type) => <label key={type}><input type="radio" checked={taxType === type} onChange={() => setTaxType(type)} /> {type.toUpperCase()}</label>)}
                  </div>
                  {taxType === "tcs" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <SoftInput type="number" placeholder="TCS %" value={tcsPct} onChange={(e) => setTcsPct(e.target.value)} />
                      <label className="text-[11px] text-[var(--color-text-muted)]">TCS on<SoftSelect value={tcsOn} onChange={(e) => setTcsOn(e.target.value)}><option value="taxable">Taxable Amount</option><option value="final">Final Amount</option></SoftSelect></label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <SoftSelect value={tdsCode} onChange={(e) => setTdsCode(e.target.value)}><option value="">Select TDS</option><option value="194Q">194Q (0.1%)</option><option value="194C">194C (1%)</option></SoftSelect>
                      <label className="text-[11px] text-[var(--color-text-muted)]">TDS on<SoftSelect value={tdsOn} onChange={(e) => setTdsOn(e.target.value)}><option value="taxable">Taxable Amount</option><option value="final">Final Amount</option></SoftSelect></label>
                    </div>
                  )}
                  <div className="flex justify-between text-[var(--color-danger)]"><span>{taxType.toUpperCase()} deducted</span><span>₹ {tcsOrTdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                </div>
              ) : null}
              {showPurchaseDiscount ? (
                <div className="flex items-center gap-2 border-b border-dashed border-[var(--color-border)] p-3">
                  <button type="button" onClick={() => setShowPurchaseDiscount(false)} className="text-[var(--color-danger)]"><X className="h-4 w-4" /></button>
                  <ShorthandQuantityInput
                    value={purchaseDiscountVal}
                    onChange={(val) => setPurchaseDiscountVal(val)}
                    placeholder="Discount"
                  />
                  <SoftSelect value={purchaseDiscountType} onChange={(e) => setPurchaseDiscountType(e.target.value)} className="max-w-16"><option>%</option><option>₹</option></SoftSelect>
                </div>
              ) : null}
              <div className="flex justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-[16px] font-bold text-[var(--color-text)]">
                <span>Final Amount</span>
                <span className="tabular-nums">₹ {finalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex flex-col gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOtherChargeOpen(true)}
                  className="rounded-full border bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  {otherChargeMeta?.charge_name
                    ? `${otherChargeMeta.charge_name} · ₹ ${otherCharge.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "+ Add Other Charge"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGstTds(true)}
                  className="rounded-full border bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold"
                  style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}
                >
                  + Add 2% GST TDS
                </button>
                <button type="button" onClick={() => setShowTaxType(true)} className="rounded-full border bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}>
                  + Add TCS/TDS
                </button>
                <button type="button" onClick={() => setShowPurchaseDiscount(true)} className="rounded-full border bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: ERP_PRIMARY, color: ERP_PRIMARY }}>
                  + Add Purchase Order Level Discount
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* OPTIONAL FIELDS */}
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div
            className="border-b border-[var(--color-border)] px-4 py-3 text-center text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--color-text)]"
            style={{ background: ERP_PRIMARY_SOFT }}
          >
            Optional Fields
          </div>

          <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-[var(--color-border)]">
            {/* Transportation */}
            <section className="overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-surface)] lg:border-b-0">
              <SectionHeader
                icon={Truck}
                title="Transportation Details"
                collapsible
                open={transportOpen}
                onToggle={() => setTransportOpen((v) => !v)}
              />
              {transportOpen ? (
              <div className="space-y-4 border-t-0 p-4">
                <div className="border-b border-[var(--color-border-soft)] pb-4">
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
                            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-[12px] font-semibold text-[var(--color-action-blue)]"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Calculate
                          </button>
                        </div>
                      </label>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between border-t border-[var(--color-border-soft)] pt-3">
                  <div className="min-w-0">
                    <span className="text-[13px] font-semibold text-[var(--color-text)]">Transporter Details</span>
                    {form.transporter_name ? (
                      <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                        {form.transporter_name}
                        {form.transporter_id ? ` · ${form.transporter_id}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTransporterModalOpen(true)}
                    className="shrink-0 text-[13px] font-semibold text-[var(--color-action-blue)]"
                  >
                    {form.transporter_name ? "Edit Transporter" : "+ Add New Transporter"}
                  </button>
                </div>

                <div className="space-y-3 border-t border-[var(--color-border-soft)] pt-3">
                  <p className="text-[13px] font-semibold text-[var(--color-text)]">Other Details</p>
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
            <section className="overflow-hidden bg-[var(--color-surface)]">
              <SectionHeader
                icon={Grid2x2}
                title="Other Details"
                collapsible
                open={otherDetailsOpen}
                onToggle={() => setOtherDetailsOpen((v) => !v)}
              />
              {otherDetailsOpen ? (
              <div className="space-y-3 p-4">
                <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-[var(--color-border-soft)]">
                  <label className="block border-b border-[var(--color-border-soft)] p-3 sm:border-b">
                    <FieldLabel>Invoice No</FieldLabel>
                    <SoftInput
                      placeholder="Enter Invoice No"
                      value={refInvoiceNo}
                      onChange={(e) => setRefInvoiceNo(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Invoice Date</FieldLabel>
                    <SoftInput
                      type="date"
                      value={refInvoiceDate}
                      onChange={(e) => setRefInvoiceDate(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Challan Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter Challan Number"
                      value={form.challan_number}
                      onChange={(e) => setForm((f) => ({ ...f, challan_number: e.target.value }))}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>E-Waybill Number</FieldLabel>
                    <SoftInput
                      placeholder="Enter E-Waybill Number"
                      value={form.ewaybill_number}
                      onChange={(e) => setForm((f) => ({ ...f, ewaybill_number: e.target.value }))}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Payment Mode</FieldLabel>
                    <SoftInput
                      placeholder="Enter Payment Mode"
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Dispatched Doc No</FieldLabel>
                    <SoftInput
                      placeholder="Enter Dispatched Doc No"
                      value={dispatchedDocNo}
                      onChange={(e) => setDispatchedDocNo(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Dispatched Through</FieldLabel>
                    <SoftInput
                      placeholder="Enter Dispatched Through"
                      value={dispatchedThrough}
                      onChange={(e) => setDispatchedThrough(e.target.value)}
                    />
                  </label>
                  <label className="block border-b border-[var(--color-border-soft)] p-3">
                    <FieldLabel>Destination</FieldLabel>
                    <SoftInput
                      placeholder="Enter Destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block border border-[var(--color-border-soft)] p-3">
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
                    className="flex items-start justify-between gap-3 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                        {field.label}
                      </p>
                      {field.value ? (
                        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{field.value}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomFields((rows) => rows.filter((x) => x.id !== field.id))
                      }
                      className="rounded p-1 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-danger)]"
                      aria-label={`Remove ${field.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomFieldOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-primary-soft)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-semibold"
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
          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
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
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]"
              >
                + Add New Terms and Conditions
              </button>
            </SectionHeader>
            {termsOpen && termsAttached && form.notes ? (
              <div className="border-t border-[var(--color-border)] p-4">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-soft)]"
                />
              </div>
            ) : null}
          </section>

          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <SectionHeader icon={Paperclip} title="Attach Document" />
            <div className="space-y-3 p-4">
              {poAttachments.length ? (
                <ul className="space-y-2 text-[13px]">
                  {poAttachments.map((att) => (
                    <li key={att.attachment_id || att.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
                      <span className="truncate">{att.filename}</span>
                      <button
                        type="button"
                        className="shrink-0 font-semibold text-[var(--color-primary)]"
                        onClick={() => openEntityFileDownload(att.id)}
                      >
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {pendingPoFiles.length ? (
                <ul className="space-y-1 text-[12px] text-[var(--color-text-muted)]">
                  {pendingPoFiles.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">{file.name} (queued)</span>
                      <button
                        type="button"
                        className="text-[var(--color-danger)]"
                        onClick={() => setPendingPoFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {isEdit && editId ? (
                <FileUploader
                  entityType="purchase_order"
                  entityId={Number(editId)}
                  onReady={async (status) => {
                    if (!status?.id) return;
                    try {
                      await attachFile(status.id, "purchase_order", Number(editId), "po_document");
                      const res = await getPurchaseOrder(editId);
                      setPoAttachments(Array.isArray(res?.data?.attachments) ? res.data.attachments : []);
                      addToast("Document attached.", "success");
                    } catch (err) {
                      addToast(mapFileUploadError(err).message || "Could not link document.", "error");
                    }
                  }}
                  onError={(err) => addToast(err?.message || "Upload failed", "error")}
                />
              ) : (
                <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-primary-soft)]">
                  <Paperclip className="mb-2 h-5 w-5 text-[var(--color-primary)]" />
                  Add document (uploads after save)
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setPendingPoFiles((prev) => [...prev, file]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              {docUploadBusy ? <p className="text-[12px] text-[var(--color-text-muted)]">Uploading documents…</p> : null}
            </div>
          </section>

          {/* Notes */}
          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <SectionHeader icon={FileText} title="Notes">
              <button
                type="button"
                onClick={() => setNoteModalOpen(true)}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]"
              >
                + Add New Note
              </button>
            </SectionHeader>
            {notesText ? (
              <div className="border-t border-[var(--color-border)] p-4 text-[13px] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {notesText}
              </div>
            ) : (
              <div className="min-h-[48px] border-t border-[var(--color-border)]" />
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <SectionHeader icon={User} title="Signature and Stamp">
              <button
                type="button"
                role="switch"
                aria-checked={signatureOn}
                onClick={() => setSignatureOn((current) => !current)}
                className={`relative h-6 w-11 rounded-full transition ${signatureOn ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"}`}
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

      <AddNewPartyModal
        open={addSellerOpen}
        variant="vendor"
        title="Add New Party"
        onClose={() => setAddSellerOpen(false)}
        onSaved={async (party) => {
          if (!party) return;
          try {
            const res = await getVendors();
            const list = res?.data || [];
            setVendors(list);
            const match =
              list.find((v) => String(v.id) === String(party.id)) ||
              list.find((v) => v.name === party.name && v.phone === party.phone) ||
              party;
            handleVendorChange(match.id);
          } catch {
            const vendor = {
              ...party,
              name: party.name || party.vendor_name || "Unnamed seller",
            };
            setVendors((rows) => [vendor, ...rows.filter((row) => String(row.id) !== String(vendor.id))]);
            if (vendor.id) handleVendorChange(vendor.id);
          }
        }}
      />
      <EditCompanyDetailsModal
        open={editCompanyOpen}
        onClose={() => setEditCompanyOpen(false)}
        onSaved={(data) => setCompany(data)}
      />
      <AddPrefixModal
        open={prefixModalOpen}
        onClose={() => setPrefixModalOpen(false)}
        onSave={(prefix) => {
          const next = [...new Set([...customPrefixes, prefix].filter(Boolean))];
          setCustomPrefixes(next);
          saveCustomPrefixes(next);
          setForm((f) => ({ ...f, po_prefix: prefix }));
          setPrefixModalOpen(false);
        }}
      />
      <AddNewItemModal
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onSaved={(line, product) => {
          if (!line) return;
          const withAmount = {
            ...emptyItem(),
            ...line,
            item_id: product?.id || line?.item_id || null,
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
      <AddNoteModal
        open={noteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        initial={notesText}
        onSave={(text) => setNotesText(text)}
      />
    </form>
  );
}
