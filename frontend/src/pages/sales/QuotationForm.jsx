import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  FileText,
  Grid2x2,
  ImagePlus,
  Info,
  Package,
  PenLine,
  Pencil,
  Plus,
  Ban,
  Search,
  RotateCcw,
  X,
  Share2,
  Ship,
  TrainFront,
  Trash2,
  Truck,
  User,
  Plane,
} from "lucide-react";

import ConfirmDialog from "../../components/admin/ConfirmDialog";
import Loader from "../../components/common/Loader";
import { SearchBar } from "../../components/common/SearchFilter";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import AddBankAccountModal from "../../components/sales/AddBankAccountModal";
import AddContactPersonModal from "../../components/sales/AddContactPersonModal";
import AddCustomFieldModal from "../../components/sales/AddCustomFieldModal";
import AddInvoiceDiscountModal from "../../components/sales/AddInvoiceDiscountModal";
import AddNewItemModal from "../../components/sales/AddNewItemModal";
import ProductDetailModal from "../../components/masters/ProductDetailModal";
import ItemSelectionModal from "../../components/sales/ItemSelectionModal";
import AddNewPartyModal from "../../components/sales/AddNewPartyModal";
import AddNoteModal from "../../components/sales/AddNoteModal";
import AddOtherChargesModal, {
  computeOtherChargeTotal,
} from "../../components/sales/AddOtherChargesModal";
import AddPrefixModal from "../../components/sales/AddPrefixModal";
import AddTermsAndConditionsModal from "../../components/sales/AddTermsAndConditionsModal";
import AddTransporterDetailsModal from "../../components/sales/AddTransporterDetailsModal";
import DispatchAddressPicker from "../../components/sales/DispatchAddressPicker";
import EditCompanyDetailsModal from "../../components/sales/EditCompanyDetailsModal";
import ShareToSalesTeamModal from "../../components/sales/ShareToSalesTeamModal";
import TermsAndConditionsPicker from "../../components/sales/TermsAndConditionsPicker";
import SignatureAndStampPanel from "../../components/sales/SignatureAndStampPanel";
import QuotationBuyerSelectPanel from "../../components/sales/QuotationBuyerSelectPanel";

import {
  createQuotation,
  deleteCustomer,
  getQuotation,
  getQuotations,
  updateCustomer,
  updateQuotation,
} from "../../api/salesApi";

import {
  getCompanySettings,
  updateCompanySettings,
} from "../../api/settingsApi";

import { getProducts } from "../../api/productsApi";
import useTenantId from "../../hooks/useTenantId";
import usePermissions from "../../hooks/usePermissions";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../utils/apiError";

import {
  customerToConsigneeFields,
  fetchCustomersWithFallback,
  filterCustomers,
  resolveCustomerId,
} from "../../utils/customerOptions";
import {
  clearQuotationBuyerSelection,
  quotationBuyerActionVisibility,
} from "../../utils/quotationBuyerSectionUi";
import { formatCustomerAddress } from "../../utils/salesJobCardDocument";

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
} from "../../design-system/erpFormControls";

const YELLOW = "var(--color-primary)";

const CUSTOMER_FAVORITES_KEY = "gns_quotation_customer_favorites";

function loadCustomerFavoriteIds() {
  try {
    const raw = localStorage.getItem(CUSTOMER_FAVORITES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list) ? list.map((id) => String(id)) : []
    );
  } catch {
    return new Set();
  }
}

function dispatchAddressToConsignee(row) {
  if (!row) return {};
  return {
    consignee_name: row.name || "",
    consignee_address1: row.address || "",
    consignee_address2: [row.city, row.pincode].filter(Boolean).join(", "),
    consignee_state: row.state || "",
    consignee_gstin: row.gstin || "",
  };
}

function formatBuyerAddress(customer, form) {
  const line = formatCustomerAddress({
    address_line1:
      customer?.address_line1 ||
      customer?.address ||
      form.consignee_address1,
    address_line2: customer?.address_line2 || form.consignee_address2,
    city: customer?.city,
    state: customer?.state || form.consignee_state,
    pincode: customer?.pincode,
  });
  return line || "—";
}

const PREFIX_STORAGE_KEY = "gns_quotation_prefixes";
const DEFAULT_PREFIXES = ["QUO-"];
const ADD_PREFIX_VALUE = "__add_prefix__";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function loadCustomPrefixes() {
  try {
    const raw = localStorage.getItem(PREFIX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveCustomPrefixes(list) {
  try {
    localStorage.setItem(
      PREFIX_STORAGE_KEY,
      JSON.stringify(list)
    );
  } catch {
    /* ignore */
  }
}

/** API may return meta_json as a JSON string or object. */
function parseQuotationMeta(metaJson) {
  if (!metaJson) return {};
  if (typeof metaJson === "object" && !Array.isArray(metaJson)) {
    return metaJson;
  }
  if (typeof metaJson === "string") {
    try {
      const parsed = JSON.parse(metaJson);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/*
 * API response helper.
 *
 * getQuotations() may return:
 *   { data: [...] }
 *   { data: { items: [...] } }
 *   { data: { quotations: [...] } }
 *
 * This handles all common shapes.
 */
function getQuotationRows(response) {
  const data = response?.data ?? response ?? [];

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.quotations)) {
    return data.quotations;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}

/*
 * IMPORTANT QUOTATION NUMBERING RULE
 *
 * Example:
 *
 * QUO-000001, QUO-000002, QUO-000003, QUO-000004
 * delete QUO-000004
 * next => QUO-000005
 *
 * QUO-000001, QUO-000002, QUO-000003, QUO-000004
 * delete QUO-000002
 * next => QUO-000005
 *
 * QUO-000001, QUO-000002, QUO-000003, QUO-000004
 * delete QUO-000003 + QUO-000004
 * next => QUO-000005
 *
 * No quotations
 * next => QUO-000001
 *
 * The number is calculated from the CURRENT existing quotations,
 * not from a permanent counter.
 */
function getNextQuotationNumber(
  quotations = [],
  prefix = ""
) {
  const selectedPrefix = String(prefix || "").trim();
  const prefixStem = selectedPrefix.replace(/[-\s]+$/, "");

  let maxNumber = 0;

  for (const quotation of quotations) {
    const rawNumber = String(
      quotation?.quote_number ??
        quotation?.quotation_number ??
        ""
    ).trim();

    if (!rawNumber) {
      continue;
    }

    let numberPart = "";

    if (prefixStem) {
      const escapedPrefix = prefixStem.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const match = rawNumber.match(
        new RegExp(
          `^${escapedPrefix}[-\\s]*(\\d+)$`,
          "i"
        )
      );

      if (!match) {
        continue;
      }

      numberPart = match[1];
    } else {
      const match = rawNumber.match(/^(\d+)$/);

      if (!match) {
        continue;
      }

      numberPart = match[1];
    }

    const number = Number(numberPart);

    if (Number.isFinite(number)) {
      maxNumber = Math.max(
        maxNumber,
        number
      );
    }
  }

  return String(maxNumber + 1).padStart(6, "0");
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
  return (
    Math.round((Number(n) || 0) * 100) / 100
  );
}

function lineTotals(row) {
  const qty = Number(row.qty) || 0;
  const rate = Number(row.rate) || 0;

  let discount = Number(row.discount) || 0;

  if (
    row.discount_type === "%" &&
    discount > 0
  ) {
    discount = money(
      (qty * rate * discount) / 100
    );
  }

  const gstPct =
    Number(row.gst_pct) || 0;

  let taxable = money(
    qty * rate - discount
  );

  if (
    String(row.tax_type).toLowerCase() ===
      "inclusive" &&
    gstPct > 0
  ) {
    taxable = money(
      taxable / (1 + gstPct / 100)
    );
  }

  const gst = money(
    (taxable * gstPct) / 100
  );

  return {
    taxable,
    gst,
    total: money(taxable + gst),
  };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

const TRANSPORT_MODES = [
  {
    id: "Road",
    label: "Road",
    Icon: Truck,
  },
  {
    id: "Rail",
    label: "Rail",
    Icon: TrainFront,
  },
  {
    id: "Air",
    label: "Air",
    Icon: Plane,
  },
  {
    id: "Ship/Road Cum Ship",
    label: "Ship/Road Cum Ship",
    Icon: Ship,
  },
  {
    id: "Not Applicable",
    label: "Not-Applicable",
    Icon: Ban,
  },
];

function transportDocLabels(mode) {
  if (mode === "Rail") {
    return {
      number: "RR Number",
      numberPh: "Enter RR Number",
      date: "RR Date",
    };
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

  return {
    number: "LR Number",
    numberPh: "Enter LR Number",
    date: "LR Date",
  };
}

function showsVehicleNo(mode) {
  return (
    mode === "Road" ||
    mode === "Ship/Road Cum Ship" ||
    mode === "Not Applicable"
  );
}

/* -------------------------------------------------------------------------- */
/* Section Header                                                             */
/* -------------------------------------------------------------------------- */

function SectionHeader({
  icon: Icon,
  title,
  children,
  className = "",
  collapsible,
  open,
  onToggle,
}) {
  const titleRow = (
    <div className="flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-slate-800">
      {Icon ? (
        <Icon className="h-4 w-4 shrink-0" />
      ) : null}

      <span className="truncate">
        {title}
      </span>

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
      style={{
        background: ERP_PRIMARY_SOFT,
      }}
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
        <div className="relative z-10 flex flex-wrap items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Component                                                             */
/* -------------------------------------------------------------------------- */

export default function QuotationForm() {
  const tenantId = useTenantId();
  const navigate = useNavigate();

  const { id: routeId } = useParams();
  const editId = routeId || null;
  const isEdit = Boolean(editId);

  const { addToast } = useToast();
  const { isAdmin, canAction, can } = usePermissions();
  const canEditBuyer =
    isAdmin || canAction("sales", "update") || can("sales");
  const [searchParams] = useSearchParams();

  const [loading, setLoading] =
    useState(true);

  const [customers, setCustomers] =
    useState([]);

  const [company, setCompany] =
    useState(null);

  /*
   * NEW:
   * Existing quotations are loaded when creating a new quotation.
   */
  const [quotations, setQuotations] =
    useState([]);

  const [
    quotationsLoaded,
    setQuotationsLoaded,
  ] = useState(false);

  const [
    customerSearch,
    setCustomerSearch,
  ] = useState("");

  const [
    showBuyerPicker,
    setShowBuyerPicker,
  ] = useState(false);

  const [
    buyerPartyMenuId,
    setBuyerPartyMenuId,
  ] = useState(null);

  const [
    customerFavorites,
    setCustomerFavorites,
  ] = useState(loadCustomerFavoriteIds);

  const [
    shippingConsigneeAddress,
    setShippingConsigneeAddress,
  ] = useState(null);

  const [
    showShippingPicker,
    setShowShippingPicker,
  ] = useState(false);

  const [
    dispatchAddress,
    setDispatchAddress,
  ] = useState(null);

  const [
    editCompanyOpen,
    setEditCompanyOpen,
  ] = useState(false);

  const [
    addBuyerOpen,
    setAddBuyerOpen,
  ] = useState(false);

  const [
    editingBuyer,
    setEditingBuyer,
  ] = useState(null);

  const [
    removeBuyerConfirmOpen,
    setRemoveBuyerConfirmOpen,
  ] = useState(false);

  const [
    addItemOpen,
    setAddItemOpen,
  ] = useState(false);

  const [
    otherChargeOpen,
    setOtherChargeOpen,
  ] = useState(false);

  const [
    otherChargeMeta,
    setOtherChargeMeta,
  ] = useState(null);

  const [
    discountOpen,
    setDiscountOpen,
  ] = useState(false);

  const [
    discountMeta,
    setDiscountMeta,
  ] = useState(null);

  const [
    taxModeOverride,
    setTaxModeOverride,
  ] = useState("auto");

  const [declOpen, setDeclOpen] =
    useState(false);

  const [
    transportOpen,
    setTransportOpen,
  ] = useState(true);

  const [
    otherDetailsOpen,
    setOtherDetailsOpen,
  ] = useState(false);

  const [termsOpen, setTermsOpen] =
    useState(false);

  const [
    termsAttached,
    setTermsAttached,
  ] = useState(false);

  const [
    termsPickerOpen,
    setTermsPickerOpen,
  ] = useState(false);

  const [
    termsAddOpen,
    setTermsAddOpen,
  ] = useState(false);

  const [
    transporterModalOpen,
    setTransporterModalOpen,
  ] = useState(false);

  const [
    customFieldOpen,
    setCustomFieldOpen,
  ] = useState(false);

  const [
    customFields,
    setCustomFields,
  ] = useState([]);

  const [
    bankModalOpen,
    setBankModalOpen,
  ] = useState(false);

  const [
    bankAccount,
    setBankAccount,
  ] = useState(null);

  const [
    contactPerson,
    setContactPerson,
  ] = useState(null);

  const [
    contactOpen,
    setContactOpen,
  ] = useState(false);

  const [extraNote, setExtraNote] =
    useState("");

  const [noteOpen, setNoteOpen] =
    useState(false);

  const [
    prefixModalOpen,
    setPrefixModalOpen,
  ] = useState(false);

  const [
    customPrefixes,
    setCustomPrefixes,
  ] = useState(loadCustomPrefixes);

  const [signatureOn, setSignatureOn] =
    useState(false);

  const [
    signatureDataUrl,
    setSignatureDataUrl,
  ] = useState(() => {
    try {
      return (
        localStorage.getItem(
          "gns_invoice_signature_data"
        ) || null
      );
    } catch {
      return null;
    }
  });

  const [
    stampDataUrl,
    setStampDataUrl,
  ] = useState(() => {
    try {
      return (
        localStorage.getItem(
          "gns_invoice_stamp_data"
        ) || null
      );
    } catch {
      return null;
    }
  });

  const [shareOpen, setShareOpen] =
    useState(false);

  const [form, setForm] = useState({
    tenant_id: tenantId,
    customer_id: "",

    sales_order_id:
      searchParams.get(
        "sales_order_id"
      )
        ? Number(
            searchParams.get(
              "sales_order_id"
            )
          )
        : null,

    /*
     * IMPORTANT:
     * Start empty.
     * Number is calculated from current quotations.
     */
    invoice_prefix: "",
    invoice_number: "",

    issue_date: new Date()
      .toISOString()
      .slice(0, 10),

    valid_until: new Date(
      Date.now() +
        30 * 86400000
    )
      .toISOString()
      .slice(0, 10),

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
    consignee_phone: "",
    consignee_email: "",

    notes: "",
    terms_of_delivery: "",
    delivery_note: "",
    delivery_note_date: "",

    reference_no: "",
    reference_date: "",
    other_references: "",

    po_number: "",
    po_date: "",

    dispatch_doc_no: "",
    lr_number: "",

    transporter_name: "DTDC",
    destination: "",

    ewaybill_number: "",
    challan_number: "",

    declaration: "",
    rejection_policy: "",

    sales_person: "",

    remarks: "",
    checked_by: "",

    reverse_charge: false,

    payment_terms: "Net 30 Days",

    status: "draft",
  });

  const [products, setProducts] =
    useState([]);

  const [selectedDetailProduct, setSelectedDetailProduct] = useState(null);
  const [itemModalTargetIdx, setItemModalTargetIdx] = useState(null);

  const [
    itemPickerIdx,
    setItemPickerIdx,
  ] = useState(null);

  const [itemSearch, setItemSearch] =
    useState("");

  const [items, setItems] = useState([
    emptyItem(),
    emptyItem(),
    emptyItem(),
  ]);

  const [saving, setSaving] =
    useState(false);

  /* ------------------------------------------------------------------------ */
  /* Initial Load                                                             */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      try {
        const [
          custRes,
          companyRes,
          productsRes,
          quotationsRes,
        ] = await Promise.allSettled([
          fetchCustomersWithFallback(),
          getCompanySettings(),
          getProducts(),

          /*
           * Only fetch existing quotations for NEW quotation.
           *
           * While editing, we don't need this request because
           * existing quotation number must stay unchanged.
           */
          !editId
            ? getQuotations()
            : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        setCustomers(
          custRes.status ===
            "fulfilled"
            ? custRes.value || []
            : []
        );

        const co =
          companyRes.status ===
          "fulfilled"
            ? companyRes.value?.data ||
              null
            : null;

        setCompany(co);

        const prodRaw =
          productsRes.status ===
          "fulfilled"
            ? productsRes.value?.data ??
              productsRes.value ??
              []
            : [];

        setProducts(
          Array.isArray(prodRaw)
            ? prodRaw
            : []
        );

        /*
         * NEW:
         * Save existing quotations.
         */
        if (!editId) {
          const quotationRows =
            quotationsRes.status ===
            "fulfilled"
              ? getQuotationRows(
                  quotationsRes.value
                )
              : [];

          setQuotations(
            quotationRows
          );
        }

        setQuotationsLoaded(true);

        /* Company signature/stamp */

        if (co) {
          if (co.stamp_url) {
            setStampDataUrl(
              (prev) =>
                prev || co.stamp_url
            );

            try {
              if (
                !localStorage.getItem(
                  "gns_invoice_stamp_data"
                )
              ) {
                localStorage.setItem(
                  "gns_invoice_stamp_data",
                  co.stamp_url
                );
              }
            } catch {}
          }

          if (co.signature_url) {
            setSignatureDataUrl(
              (prev) =>
                prev ||
                co.signature_url
            );

            try {
              if (
                !localStorage.getItem(
                  "gns_invoice_signature_data"
                )
              ) {
                localStorage.setItem(
                  "gns_invoice_signature_data",
                  co.signature_url
                );
              }
            } catch {}
          }
        }

        setForm((f) =>
          f.invoice_prefix
            ? f
            : {
                ...f,
                invoice_prefix:
                  co?.quotation_prefix || DEFAULT_PREFIXES[0],
              }
        );

        if (co?.bank_name) {
          setBankAccount({
            ifsc:
              co.bank_ifsc || "",
            bank_name:
              co.bank_name || "",
            account_holder: "",
            account_number:
              co.bank_account_number ||
              "",
            branch_name:
              co.bank_branch || "",
            upi_id: "",
            show_upi_qr: true,
            notes: null,
          });
        }

        /* ------------------------------------------------------------------ */
        /* EDIT EXISTING QUOTATION                                            */
        /* ------------------------------------------------------------------ */

        if (editId) {
          const quote =
            (
              await getQuotation(
                editId
              )
            ).data;

          if (!quote) {
            throw new Error(
              "Quotation not found"
            );
          }

          /*
           * Existing quotation number is NEVER recalculated.
           */
          const qn = String(
            quote.quote_number || ""
          );

          const prefixMatch =
            qn.match(
              /^([A-Za-z-]+)/
            );

          const meta = parseQuotationMeta(quote.meta_json);

          const trans =
            meta.transportation ||
            meta.dispatch ||
            {};

          const cons =
            meta.consignee || {};

          if (meta.contact_person) {
            setContactPerson(meta.contact_person);
          }

          if (Array.isArray(meta.custom_fields) && meta.custom_fields.length > 0) {
            setCustomFields(meta.custom_fields);
          }

          const bankMeta = meta.bank_details || meta.bank;
          if (bankMeta?.bank_name) {
            setBankAccount({
              bank_name: bankMeta.bank_name || "",
              account_number:
                bankMeta.account_number ||
                bankMeta.bank_account_number ||
                "",
              ifsc: bankMeta.ifsc || bankMeta.bank_ifsc || "",
              branch_name:
                bankMeta.branch_name || bankMeta.bank_branch || "",
              account_holder: bankMeta.account_holder || "",
              upi_id: bankMeta.upi_id || "",
              show_upi_qr: bankMeta.show_upi_qr !== false,
              iban: bankMeta.iban || "",
              swift: bankMeta.swift || "",
              notes: bankMeta.notes || null,
            });
          }

          if (meta.show_signature === false) {
            setSignatureOn(false);
          }

          if (meta.tax_mode) {
            setTaxModeOverride(
              meta.tax_mode
            );
          }

          if (
            meta.terms ||
            meta.delivery_terms ||
            trans.delivery_terms
          ) {
            setTermsAttached(true);
          }

          setForm((f) => ({
            ...f,

            customer_id:
              quote.customer_id != null && quote.customer_id !== ""
                ? String(quote.customer_id)
                : "",

            consignee_name:
              cons.name ||
              quote.customer_name ||
              f.consignee_name,

            consignee_address1:
              cons.address ||
              f.consignee_address1,

            consignee_state:
              cons.state ||
              f.consignee_state,

            consignee_state_code:
              cons.state_code ||
              f.consignee_state_code,

            consignee_gstin:
              cons.gstin ||
              f.consignee_gstin,

            consignee_phone:
              cons.phone ||
              f.consignee_phone,

            invoice_prefix:
              prefixMatch?.[1] ||
              f.invoice_prefix,

            invoice_number:
              qn.replace(
                /^[A-Za-z-]+/,
                ""
              ) || qn,

            issue_date:
              quote.quote_date
                ? String(
                    quote.quote_date
                  ).slice(0, 10)
                : f.issue_date,

            valid_until:
              quote.valid_until
                ? String(
                    quote.valid_until
                  ).slice(0, 10)
                : f.valid_until,

            discount:
              Number(
                quote.discount
              ) || 0,

            other_charge:
              Number(
                meta.other_charge
              ) || 0,

            round_off:
              Number(
                meta.round_off
              ) || 0,

            notes:
              meta.terms ||
              meta.delivery_terms ||
              quote.notes ||
              f.notes,

            terms_of_delivery:
              meta.delivery_terms ||
              trans.delivery_terms ||
              f.terms_of_delivery,

            sales_person:
              quote.sales_person ||
              "",

            status:
              quote.status ||
              "draft",

            delivery_note:
              trans.delivery_note ||
              meta.delivery_note ||
              "",

            delivery_note_date:
              trans.delivery_note_date
                ? String(
                    trans.delivery_note_date
                  ).slice(0, 10)
                : "",

            reference_no:
              trans.reference_no ||
              meta.reference_no ||
              "",

            reference_date:
              trans.reference_date ||
              meta.reference_date ||
              "",

            other_references:
              trans.other_references ||
              meta.other_references ||
              "",

            po_number:
              trans.buyer_order_no ||
              trans.buyers_order_no ||
              trans.po_number ||
              meta.po_number ||
              "",

            po_date:
              trans.buyer_order_date ||
              trans.po_date
                ? String(
                    trans.buyer_order_date ||
                      trans.po_date
                  ).slice(0, 10)
                : "",

            dispatch_doc_no:
              trans.dispatch_doc_no ||
              trans.lr_number ||
              meta.dispatch_doc_no ||
              "",

            lr_number:
              trans.dispatch_doc_no ||
              trans.lr_number ||
              meta.lr_number ||
              "",

            transporter_name:
              trans.dispatched_through ||
              trans.transporter_name ||
              "DTDC",

            destination:
              trans.destination ||
              meta.destination ||
              "",

            ewaybill_number:
              meta.ewaybill_number ||
              meta.eway_bill_no ||
              trans.ewaybill_number ||
              "",

            challan_number:
              trans.challan_number ||
              meta.challan_number ||
              trans.delivery_note ||
              meta.delivery_note ||
              "",

            declaration:
              meta.declaration || "",

            rejection_policy:
              meta.rejection_policy ||
              meta.quotation_policy ||
              "",

            remarks: meta.remarks || "",

            checked_by: meta.checked_by || "",

            payment_terms:
              meta.payment_terms ||
              "Net 30 Days",
          }));

          if (
            Array.isArray(
              meta.items
            ) &&
            meta.items.length > 0
          ) {
            setItems(
              meta.items.map((it) => ({
                ...emptyItem(),

                item_description:
                  it.item_description ||
                  "",

                hsn:
                  it.hsn || "",

                qty:
                  it.qty ?? 1,

                unit:
                  it.unit || "pcs",

                rate:
                  it.rate ?? 0,

                tax_type:
                  it.tax_type ||
                  "Exclusive",

                discount:
                  it.discount ?? 0,

                discount_type:
                  it.discount_type ||
                  "₹",

                gst_pct:
                  it.gst_pct ?? 18,

                amount:
                  it.amount ?? 0,
              }))
            );
          }
        }
      } catch (err) {
        if (!cancelled) {
          addToast(
            apiErrorMessage(
              err,
              "Failed to load quotation"
            ),
            "error"
          );

          if (editId) {
            navigate(
              "/sales/quotations"
            );
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    editId,
    addToast,
    navigate,
  ]);

  /* ------------------------------------------------------------------------ */
  /* AUTO GENERATE NEXT QUOTATION NUMBER                                     */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    /*
     * Never change the number while editing.
     */
    if (isEdit) {
      return;
    }

    /*
     * Wait until quotations are loaded.
     */
    if (!quotationsLoaded) {
      return;
    }

    const nextNumber =
      getNextQuotationNumber(
        quotations,
        form.invoice_prefix
      );

    setForm((current) => {
      /*
       * Avoid unnecessary state update.
       */
      if (
        current.invoice_number ===
        nextNumber
      ) {
        return current;
      }

      return {
        ...current,
        invoice_number:
          nextNumber,
      };
    });
  }, [
    isEdit,
    quotationsLoaded,
    quotations,
    form.invoice_prefix,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Memoized values                                                          */
  /* ------------------------------------------------------------------------ */

  const filteredCustomers = useMemo(
    () =>
      filterCustomers(
        customers,
        customerSearch
      ),
    [
      customers,
      customerSearch,
    ]
  );

  const selectedBuyer =
    customers.find(
      (c) =>
        String(c.id) ===
        String(form.customer_id)
    );

  const buyerActions = useMemo(
    () =>
      quotationBuyerActionVisibility({
        hasBuyer: Boolean(selectedBuyer),
        canEditBuyer,
      }),
    [selectedBuyer, canEditBuyer]
  );

  const prefixOptions = useMemo(() => {
    const set = new Set([
      ...DEFAULT_PREFIXES,
      ...customPrefixes,

      ...(company?.quotation_prefix
        ? [company.quotation_prefix]
        : []),

      ...(form.invoice_prefix
        ? [form.invoice_prefix]
        : []),
    ]);

    return [...set].filter(Boolean);
  }, [
    customPrefixes,
    company?.quotation_prefix,
    form.invoice_prefix,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Customer                                                                 */
  /* ------------------------------------------------------------------------ */

  const handleCustomerChange = (
    customerId
  ) => {
    const customer =
      customers.find(
        (c) =>
          String(c.id) ===
          String(customerId)
      );

    setShippingConsigneeAddress(null);
    setShowShippingPicker(false);

    setForm((f) => ({
      ...f,

      customer_id:
        customerId,

      ...customerToConsigneeFields(customer),

      consignee_phone:
        customer?.phone ||
        customer?.mobile ||
        "",

      consignee_email: customer?.email || "",
    }));

    setShowBuyerPicker(false);
    setBuyerPartyMenuId(null);
  };

  const handleSelectBuyerFromList = (customerId) => {
    const customer = customers.find(
      (c) => String(c.id) === String(customerId)
    );
    const inactive =
      customer?.is_active === false ||
      String(customer?.status || "").toLowerCase() === "inactive";
    if (inactive) {
      addToast(
        "This party is inactive. Mark as active to use on new quotations.",
        "warning"
      );
    }
    handleCustomerChange(customerId);
  };

  const persistCustomerFavorites = (nextSet) => {
    setCustomerFavorites(nextSet);
    try {
      localStorage.setItem(
        CUSTOMER_FAVORITES_KEY,
        JSON.stringify([...nextSet])
      );
    } catch {
      /* ignore */
    }
  };

  const handleToggleCustomerFavorite = (customerId) => {
    const id = String(customerId);
    const next = new Set(customerFavorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistCustomerFavorites(next);
  };

  const patchCustomerInList = (customerId, patch) => {
    setCustomers((rows) =>
      rows.map((row) =>
        String(row.id) === String(customerId) ? { ...row, ...patch } : row
      )
    );
  };

  const handleEditPartyFromList = (customer) => {
    if (!customer) return;
    setEditingBuyer(customer);
    setAddBuyerOpen(true);
    setShowBuyerPicker(false);
  };

  const handleMarkCustomerInactive = async (customer) => {
    if (!customer?.id) return;
    try {
      await updateCustomer(customer.id, {
        status: "inactive",
      });
      patchCustomerInList(customer.id, {
        status: "inactive",
        is_active: false,
      });
      const nextFav = new Set(customerFavorites);
      nextFav.delete(String(customer.id));
      persistCustomerFavorites(nextFav);
      if (String(form.customer_id) === String(customer.id)) {
        setForm((f) => clearQuotationBuyerSelection(f, true));
        setShippingConsigneeAddress(null);
      }
      addToast("Party is marked as Inactive", "success");
    } catch (err) {
      addToast(apiErrorMessage(err, "Could not update party"), "error");
    }
  };

  const handleMarkCustomerActive = async (customer) => {
    if (!customer?.id) return;
    try {
      await updateCustomer(customer.id, {
        status: "active",
      });
      patchCustomerInList(customer.id, {
        status: "active",
        is_active: true,
      });
      addToast("Party is marked as Active", "success");
    } catch (err) {
      addToast(apiErrorMessage(err, "Could not update party"), "error");
    }
  };

  const handleDeleteCustomerParty = async (customer) => {
    if (!customer?.id) return;
    if (
      !window.confirm(
        `Delete ${customer.name || "this party"}? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await deleteCustomer(customer.id);
      setCustomers((rows) =>
        rows.filter((row) => String(row.id) !== String(customer.id))
      );
      if (String(form.customer_id) === String(customer.id)) {
        setForm((f) => clearQuotationBuyerSelection(f, true));
        setShippingConsigneeAddress(null);
      }
      addToast("Party deleted", "success");
    } catch (err) {
      addToast(apiErrorMessage(err, "Could not delete party"), "error");
    }
  };

  const applyShippingConsignee = (row) => {
    setShippingConsigneeAddress(row);
    setShowShippingPicker(false);
    setForm((f) => ({
      ...f,
      ...dispatchAddressToConsignee(row),
    }));
  };

  const clearShippingConsignee = () => {
    setShippingConsigneeAddress(null);
    setShowShippingPicker(false);
    if (selectedBuyer) {
      setForm((f) => ({
        ...f,
        ...customerToConsigneeFields(selectedBuyer),
        consignee_phone:
          selectedBuyer.phone || selectedBuyer.mobile || "",
        consignee_email: selectedBuyer.email || "",
      }));
    }
  };

  const handleEditBuyer = () => {
    if (!selectedBuyer) return;
    setEditingBuyer(selectedBuyer);
    setAddBuyerOpen(true);
  };

  const handleOpenAddBuyer = () => {
    setEditingBuyer(null);
    setAddBuyerOpen(true);
  };

  const handleConfirmRemoveBuyer = () => {
    setForm((f) =>
      clearQuotationBuyerSelection(f, true)
    );
    setShippingConsigneeAddress(null);
    setShowBuyerPicker(false);
    setRemoveBuyerConfirmOpen(false);
  };

  /* ------------------------------------------------------------------------ */
  /* Items                                                                    */
  /* ------------------------------------------------------------------------ */

  const updateItem = (
    idx,
    field,
    val
  ) => {
    setItems((prev) => {
      const next = [...prev];

      next[idx] = {
        ...next[idx],
        [field]: val,
      };

      next[idx].amount =
        lineTotals(
          next[idx]
        ).total;

      return next;
    });
  };

  const selectProductForRow = (
    idx,
    product
  ) => {
    const gstPct =
      Number(
        product.gst_percent ??
          product.gst_pct ??
          company?.default_gst_pct ??
          18
      ) || 0;

    setItems((prev) => {
      const next = [...prev];

      const row = {
        ...emptyItem(),

        product_id:
          product.id,

        item_description:
          product.name ||
          product.sku ||
          "",

        hsn:
          product.hsn_code ||
          product.hsn ||
          "",

        qty:
          next[idx]?.qty || 1,

        unit:
          product.unit ||
          "pcs",

        rate:
          product.unit_price ??
          product.sale_price ??
          product.price_per_unit ??
          "",

        tax_type:
          "Exclusive",

        gst_pct:
          gstPct,

        stock:
          product.current_stock !=
          null
            ? Number(
                product.current_stock
              )
            : null,
      };

      row.amount =
        lineTotals(row).total;

      next[idx] = row;

      return next;
    });

    setItemPickerIdx(null);
    setItemSearch("");
  };

  const addEmptyItemRow = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const filteredProducts = useMemo(() => {
    const q =
      itemSearch
        .trim()
        .toLowerCase();

    const sellableProducts = products.filter((product) =>
      String(product.status || "active").toLowerCase() === "active" &&
      product.is_sellable === true
    );

    if (!q) {
      return sellableProducts.slice(
        0,
        40
      );
    }

    return sellableProducts
      .filter((p) =>
        [
          p.name,
          p.sku,
          p.hsn_code,
          p.product_code,
          p.category,
        ]
          .filter(Boolean)
          .some((v) =>
            String(v)
              .toLowerCase()
              .includes(q)
          )
      )
      .slice(0, 40);
  }, [products, itemSearch]);

  const getProductForRow = (row) => {
    if (!row) return null;
    if (row.product_id) {
      const found = products.find((p) => p.id === row.product_id || String(p.id) === String(row.product_id));
      if (found) return found;
    }
    if (row.item_description) {
      const descLower = String(row.item_description).trim().toLowerCase();
      const found = products.find(
        (p) =>
          (p.name && String(p.name).trim().toLowerCase() === descLower) ||
          (p.sku && String(p.sku).trim().toLowerCase() === descLower)
      );
      if (found) return found;
    }
    if (row.item_description || row.hsn || row.rate) {
      return {
        id: row.product_id || 999,
        name: row.item_description || "Custom Item",
        sku: row.product_id ? `ITEM-${row.product_id}` : "N/A",
        category: "Sales Item",
        unit_price: row.rate != null && row.rate !== "" ? Number(row.rate) : 0,
        hsn_code: row.hsn || "—",
        gst_percent: row.gst_pct != null ? Number(row.gst_pct) : 18,
        unit: row.unit || "pcs",
        current_stock: row.stock != null ? Number(row.stock) : null,
        description: row.item_description || "Item added to quotation",
        status: "active",
        is_sellable: true,
      };
    }
    return null;
  };

  const removeItem = (idx) => {
    setItems((prev) =>
      prev.length <= 1
        ? [emptyItem()]
        : prev.filter(
            (_, i) =>
              i !== idx
          )
    );
  };

  const filledItems =
    items.filter(
      (i) =>
        i.item_description?.trim()
    );

  const taxableAmount =
    filledItems.reduce(
      (s, i) =>
        s +
        lineTotals(i).taxable,
      0
    );

  const gstAmount =
    filledItems.reduce(
      (s, i) =>
        s +
        lineTotals(i).gst,
      0
    );

  const itemsTotal =
    filledItems.reduce(
      (s, i) =>
        s +
        lineTotals(i).total,
      0
    );

  const otherCharge =
    Number(form.other_charge) ||
    0;

  const invoiceDiscount =
    Number(form.discount) ||
    0;

  const finalAmount = money(
    itemsTotal +
      otherCharge -
      invoiceDiscount +
      (Number(
        form.round_off
      ) || 0)
  );

  /* ------------------------------------------------------------------------ */
  /* Submit                                                                   */
  /* ------------------------------------------------------------------------ */

  const handleSubmit = async (
    e
  ) => {
    e.preventDefault();
    if (saving) return;
    // Ignore submit events bubbled from portaled modals (still descendants in the React tree).
    if (e.target !== e.currentTarget) return;
    if (!form.customer_id) {
      addToast(
        "Please select a buyer",
        "error"
      );

      setShowBuyerPicker(true);
      return;
    }

    if (
      filledItems.length ===
      0
    ) {
      addToast(
        "Add at least one item",
        "error"
      );

      return;
    }

    /*
     * Safety:
     * New quotation should always have a number.
     *
     * Normally this was already calculated by useEffect.
     */
    if (
      !isEdit &&
      !String(
        form.invoice_number || ""
      ).trim()
    ) {
      const nextNumber =
        getNextQuotationNumber(
          quotations,
          form.invoice_prefix
        );

      setForm((f) => ({
        ...f,
        invoice_number:
          nextNumber,
      }));

      addToast(
        "Quotation number is being prepared. Please click Save again.",
        "error"
      );

      return;
    }

    setSaving(true);

    try {
      const customerId =
        await resolveCustomerId(
          form.customer_id,
          customers,
          tenantId
        );

      const buyer =
        customers.find(
          (c) =>
            String(c.id) ===
            String(customerId)
        );

      /*
       * Prefix + number
       *
       * Prefix punctuation is preserved exactly as configured.
       */
      const quoteNumber = [
        form.invoice_prefix,
        form.invoice_number,
      ]
        .filter(Boolean)
        .join("")
        .trim();

      const notesParts = [
        termsAttached
          ? form.notes
          : null,

        ...customFields.map(
          (f) =>
            `${f.label}: ${f.value}`
        ),

        contactPerson
          ? `Contact: ${contactPerson.name}${
              contactPerson.phone
                ? ` · ${contactPerson.phone}`
                : ""
            }${
              contactPerson.email
                ? ` · ${contactPerson.email}`
                : ""
            }`
          : null,

        extraNote
          ? `Note: ${extraNote}`
          : null,

        bankAccount
          ? [
              "Bank Details:",
              bankAccount.bank_name,

              bankAccount.account_number
                ? `A/C: ${bankAccount.account_number}`
                : null,

              [
                bankAccount.ifsc,
                bankAccount.branch_name,
              ]
                .filter(Boolean)
                .join(" · ") ||
                null,
            ]
              .filter(Boolean)
              .join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      /*
       * IMPORTANT FIX:
       *
       * Previously:
       *
       * quote_number: isEdit
       *   ? quoteNumber
       *   : undefined
       *
       * That allowed backend to generate its own permanent sequence.
       *
       * Now both CREATE and UPDATE explicitly send quote_number.
       */
      const payload = {
        tenant_id:
          form.tenant_id,

        customer_id:
          customerId,

        customer_name:
          buyer?.name ||
          form.consignee_name ||
          null,

        quote_number:
          quoteNumber,

        quote_date:
          form.issue_date,

        valid_until:
          form.valid_until ||
          form.due_date ||
          null,

        status:
          form.status || "draft",

        total_amount:
          finalAmount,

        discount:
          invoiceDiscount,

        notes:
          notesParts || null,

        sales_person:
          form.sales_person ||
          null,

        meta_json: {
          items: filledItems.map(
            (i) => {
              const t =
                lineTotals(i);

              return {
                item_description:
                  i.item_description.trim(),

                hsn:
                  i.hsn || null,

                qty:
                  Number(i.qty) ||
                  0,

                unit:
                  i.unit || "pcs",

                rate:
                  Number(i.rate) ||
                  0,

                tax_type:
                  i.tax_type ||
                  "Exclusive",

                discount:
                  Number(
                    i.discount
                  ) || 0,

                discount_type:
                  i.discount_type ||
                  "₹",

                gst_pct:
                  Number(
                    i.gst_pct
                  ) || 0,

                taxable_value:
                  t.taxable,

                gst_amount:
                  t.gst,

                amount:
                  t.total,
              };
            }
          ),

          transportation: {
            delivery_note:
              form.delivery_note ||
              form.challan_number ||
              "",

            delivery_note_date:
              form.delivery_note_date ||
              "",

            reference_no:
              form.reference_no ||
              "",

            reference_date:
              form.reference_date ||
              "",

            other_references:
              form.other_references ||
              "",

            buyer_order_no:
              form.po_number ||
              "",

            buyers_order_no:
              form.po_number ||
              "",

            buyer_order_date:
              form.po_date ||
              "",

            dispatch_doc_no:
              form.dispatch_doc_no ||
              form.lr_number ||
              "",

            lr_number:
              form.dispatch_doc_no ||
              form.lr_number ||
              "",

            dispatched_through:
              form.transporter_name ||
              "DTDC",

            transporter_name:
              form.transporter_name ||
              "DTDC",

            destination:
              form.destination ||
              "",

            delivery_terms:
              form.terms_of_delivery ||
              form.notes ||
              "",

            ewaybill_number:
              form.ewaybill_number ||
              "",

            eway_bill_no:
              form.ewaybill_number ||
              "",
          },

          dispatch: {
            delivery_note:
              form.delivery_note ||
              form.challan_number ||
              "",

            delivery_note_date:
              form.delivery_note_date ||
              "",

            reference_no:
              form.reference_no ||
              "",

            reference_date:
              form.reference_date ||
              "",

            other_references:
              form.other_references ||
              "",

            buyer_order_no:
              form.po_number ||
              "",

            buyers_order_no:
              form.po_number ||
              "",

            buyer_order_date:
              form.po_date ||
              "",

            dispatch_doc_no:
              form.dispatch_doc_no ||
              form.lr_number ||
              "",

            lr_number:
              form.dispatch_doc_no ||
              form.lr_number ||
              "",

            dispatched_through:
              form.transporter_name ||
              "DTDC",

            transporter_name:
              form.transporter_name ||
              "DTDC",

            destination:
              form.destination ||
              "",

            delivery_terms:
              form.terms_of_delivery ||
              form.notes ||
              "",
          },

          consignee: {
            name: buyer?.name || form.consignee_name || "",

            address: formatCustomerAddress({
              address_line1:
                buyer?.address_line1 ||
                buyer?.address ||
                form.consignee_address1,
              address_line2:
                buyer?.address_line2 || form.consignee_address2,
              city: buyer?.city,
              state: buyer?.state || form.consignee_state,
              pincode: buyer?.pincode,
            }),

            state: buyer?.state || form.consignee_state || "",

            state_code:
              buyer?.state_code || form.consignee_state_code || "",

            gstin: buyer?.gstin || form.consignee_gstin || "",

            phone:
              buyer?.phone ||
              buyer?.mobile ||
              form.consignee_phone ||
              "",
          },

          tax_mode:
            taxModeOverride ===
            "auto"
              ? buyer?.state_code &&
                company?.state_code &&
                String(
                  buyer.state_code
                ) !==
                  String(
                    company.state_code
                  )
                ? "igst"
                : "cgst_sgst"
              : taxModeOverride,

          ewaybill_number:
            form.ewaybill_number ||
            "",

          eway_bill_no:
            form.ewaybill_number ||
            "",

          reference_no:
            form.reference_no ||
            "",

          reference_date:
            form.reference_date ||
            "",

          payment_terms:
            form.payment_terms ||
            "Net 30 Days",

          terms: termsAttached
            ? form.terms_of_delivery ||
              form.notes
            : null,

          declaration:
            form.declaration ||
            null,

          rejection_policy:
            form.rejection_policy ||
            null,

          quotation_policy:
            form.rejection_policy ||
            null,

          round_off:
            Number(
              form.round_off
            ) || 0,

          other_charge:
            otherCharge,

          custom_fields: customFields,

          contact_person: contactPerson || null,

          remarks: form.remarks || null,

          checked_by: form.checked_by || null,

          prepared_by: form.sales_person || null,

          show_signature: signatureOn,

          bank_details: bankAccount
            ? {
                bank_name: bankAccount.bank_name || "",
                account_number: bankAccount.account_number || "",
                ifsc: bankAccount.ifsc || "",
                branch_name: bankAccount.branch_name || "",
                account_holder: bankAccount.account_holder || "",
                upi_id: bankAccount.upi_id || "",
                show_upi_qr: Boolean(bankAccount.show_upi_qr),
                iban: bankAccount.iban || "",
                swift: bankAccount.swift || "",
                notes: bankAccount.notes || "",
              }
            : null,
        },
      };

      const res = isEdit
        ? await updateQuotation(
            editId,
            payload
          )
        : await createQuotation(
            payload
          );

      notifyManufacturingSpine(
        MANUFACTURING_EVENTS.DASHBOARD_REFRESH,
        {
          quotation_id:
            res.data?.id ||
            editId,
        }
      );

      addToast(
        isEdit
          ? "Quotation updated"
          : "Quotation created"
      );

      const savedId =
        res.data?.id ||
        editId;

      navigate(
        savedId
          ? `/sales/quotations/${savedId}`
          : "/sales/quotations"
      );
    } catch (err) {
      console.error(err);

      addToast(
        apiErrorMessage(
          err,
          "Failed to save quotation"
        ),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Loading                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center bg-[#F5F5F5]">
        <Loader label="Loading…" />
      </div>
    );
  }

  const companyName =
    company?.company_name ||
    company?.name ||
    "My Company";

  /* ------------------------------------------------------------------------ */
  /* UI                                                                       */
  /* ------------------------------------------------------------------------ */

  return (
    <form
      onSubmit={handleSubmit}
      className="flex h-full min-h-0 flex-col bg-[#F5F5F5]"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e4e4ea] bg-white px-5 py-3.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              navigate(
                "/sales/quotations"
              )
            }
            className="rounded-lg p-1.5 text-[#4a4a55] hover:bg-[#f5f5f7]"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() =>
                setShareOpen(true)
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-[13px] font-semibold text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
            >
              <Share2 className="h-4 w-4" />
              Share to Sales Team
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              navigate(
                "/sales/quotations"
              )
            }
            className="rounded-lg border border-[#d0d0d8] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a4a55] hover:bg-[#f5f5f7]"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg px-5 py-2 text-[13px] font-semibold text-white shadow-sm disabled:opacity-60"
            style={{
              background: YELLOW,
            }}
          >
            {saving
              ? "Saving…"
              : "Save"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1200px] space-y-4 p-5 pb-10">

          {/* ---------------------------------------------------------------- */}
          {/* Quotation Meta + Supplier                                        */}
          {/* ---------------------------------------------------------------- */}

          <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
            <section className="rounded-xl border border-[#d0d0d8] bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2">

                <label className="block">
                  <FieldLabel>
                    Quotation Prefix
                  </FieldLabel>

                  <SoftSelect
                    value={
                      form.invoice_prefix
                    }
                    onChange={(e) => {
                      const v =
                        e.target.value;

                      if (
                        v ===
                        ADD_PREFIX_VALUE
                      ) {
                        setPrefixModalOpen(
                          true
                        );
                        return;
                      }

                      setForm((f) => ({
                        ...f,
                        invoice_prefix:
                          v,
                      }));
                    }}
                  >
                    <option value="">
                      No Prefix
                    </option>

                    {prefixOptions.map(
                      (p) => (
                        <option
                          key={p}
                          value={p}
                        >
                          {p}
                        </option>
                      )
                    )}

                    <option
                      value={
                        ADD_PREFIX_VALUE
                      }
                      className="add-new-option text-[#036f71] font-semibold bg-[#e6f4f4]"
                      style={{
                        color:
                          "#036f71",
                        fontWeight:
                          "600",
                      }}
                    >
                      + Add New Prefix
                    </option>
                  </SoftSelect>
                </label>

                <label className="block">
                  <FieldLabel>
                    Quotation No.
                  </FieldLabel>

                  <SoftInput
                    value={
                      form.invoice_number
                    }
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        invoice_number:
                          e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="block">
                  <FieldLabel>
                    Quotation Date
                  </FieldLabel>

                  <SoftInput
                    type="date"
                    value={
                      form.issue_date
                    }
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        issue_date:
                          e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="block">
                  <FieldLabel>
                    Quotation Validity Date
                  </FieldLabel>

                  <SoftInput
                    type="date"
                    value={
                      form.valid_until
                    }
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        valid_until:
                          e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="block sm:col-span-2">
                  <FieldLabel>
                    Status
                  </FieldLabel>

                  <SoftSelect
                    value={
                      form.status ||
                      "draft"
                    }
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status:
                          e.target.value,
                      }))
                    }
                  >
                    <option value="draft">
                      Draft
                    </option>

                    <option value="sent">
                      Sent
                    </option>

                    <option value="approved">
                      Approved
                    </option>

                    <option value="accepted">
                      Accepted
                    </option>

                    <option value="rejected">
                      Rejected
                    </option>

                    <option value="cancelled">
                      Cancelled
                    </option>
                  </SoftSelect>
                </label>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={Building2}
                title="Supplier Details"
              />

              <div className="flex items-start justify-between gap-4 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold text-[#1a1a1f]">
                      {companyName}
                    </p>

                    <button
                      type="button"
                      onClick={() =>
                        setEditCompanyOpen(
                          true
                        )
                      }
                      className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-primary)] hover:underline"
                    >
                      <PenLine className="h-3.5 w-3.5" />
                      Edit Company Details
                    </button>
                  </div>

                  <DispatchAddressPicker
                    value={
                      dispatchAddress
                    }
                    onChange={
                      setDispatchAddress
                    }
                  />

                  {dispatchAddress ? (
                    <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-[#6b6b76]">
                      {[
                        dispatchAddress.address,
                        dispatchAddress.city,
                        dispatchAddress.state,
                        dispatchAddress.pincode,
                      ]
                        .filter(Boolean)
                        .join(", ")}

                      {dispatchAddress.gstin
                        ? ` · ${dispatchAddress.gstin}`
                        : ""}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setEditCompanyOpen(
                      true
                    )
                  }
                  className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-full border border-dashed border-[#c4c4cc] bg-[#fafafa] text-[10px] text-[#9a9aa5]"
                >
                  {company?.logo_url ? (
                    <img
                      src={
                        company.logo_url
                      }
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

          {/* ---------------------------------------------------------------- */}
          {/* Buyer                                                            */}
          {/* ---------------------------------------------------------------- */}

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader
              icon={User}
              title={
                <>
                  Buyer Details{" "}
                  <span className="text-red-500">
                    *
                  </span>
                </>
              }
            >
              {buyerActions.showRemoveBuyer ? (
                <button
                  type="button"
                  onClick={() =>
                    setRemoveBuyerConfirmOpen(
                      true
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
                  style={{ background: ERP_PRIMARY }}
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              ) : null}

              {buyerActions.showSelectBuyer ? (
                <button
                  type="button"
                  onClick={() => {
                    setBuyerPartyMenuId(null);
                    setShowBuyerPicker((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white"
                  style={{ background: ERP_PRIMARY }}
                >
                  <User className="h-3.5 w-3.5" />
                  Select Buyer
                </button>
              ) : null}

              {buyerActions.showAddNewBuyer ? (
                <button
                  type="button"
                  onClick={handleOpenAddBuyer}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#d0d0d8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4a4a55]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add New Buyer
                </button>
              ) : null}
            </SectionHeader>

            <div className="min-h-[88px] border-t-0 p-4">
              {showBuyerPicker ? (
                <QuotationBuyerSelectPanel
                  search={customerSearch}
                  onSearchChange={setCustomerSearch}
                  customers={filteredCustomers}
                  selectedCustomerId={form.customer_id}
                  onSelect={handleSelectBuyerFromList}
                  onAddNew={() => {
                    setShowBuyerPicker(false);
                    handleOpenAddBuyer();
                  }}
                  partyMenuId={buyerPartyMenuId}
                  onPartyMenuIdChange={setBuyerPartyMenuId}
                  favoriteIds={customerFavorites}
                  onToggleFavorite={handleToggleCustomerFavorite}
                  onEditParty={handleEditPartyFromList}
                  onMarkInactive={handleMarkCustomerInactive}
                  onMarkActive={handleMarkCustomerActive}
                  onDeleteParty={handleDeleteCustomerParty}
                />
              ) : null}

              {selectedBuyer ? (
                <div className="space-y-4 text-[13px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className="text-[16px] font-bold"
                        style={{ color: ERP_PRIMARY }}
                      >
                        {selectedBuyer.name}
                      </p>
                      {buyerActions.showEditBuyerLink ? (
                        <button
                          type="button"
                          onClick={handleEditBuyer}
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Buyer Details
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">
                          GSTIN
                        </p>
                        <p className="text-[#1a1a1f]">
                          {selectedBuyer.gstin ||
                            form.consignee_gstin ||
                            "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">
                          Address
                        </p>
                        <p className="text-[#4a4a55]">
                          {formatBuyerAddress(selectedBuyer, form)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">
                          City
                        </p>
                        <p className="text-[#4a4a55]">
                          {selectedBuyer.city || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">
                          State
                        </p>
                        <p className="text-[#4a4a55]">
                          {selectedBuyer.state ||
                            form.consignee_state ||
                            "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9aa5]">
                          Pincode
                        </p>
                        <p className="text-[#4a4a55]">
                          {selectedBuyer.pincode || "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#e4e4ea] bg-[#f5f5f7] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-[#1a1a1f]">
                          Shipping Address (Consignee)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setShowShippingPicker((v) => !v)
                          }
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-primary)] hover:underline"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Change Consignee
                        </button>
                      </div>
                      {shippingConsigneeAddress ? (
                        <button
                          type="button"
                          onClick={clearShippingConsignee}
                          className="rounded p-1 text-[#9a9aa5] hover:bg-white hover:text-[#6b6b76]"
                          aria-label="Clear shipping address"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>

                    <DispatchAddressPicker
                      embedded
                      open={showShippingPicker}
                      onOpenChange={setShowShippingPicker}
                      value={shippingConsigneeAddress}
                      onChange={(row) => {
                        if (!row) {
                          clearShippingConsignee();
                          return;
                        }
                        applyShippingConsignee(row);
                      }}
                      footerLabel="+ Add Shipping Address"
                      showRowActions
                    />

                    <p className="mt-2 text-[13px] leading-relaxed text-[#4a4a55]">
                      <span className="font-semibold text-[#1a1a1f]">
                        {shippingConsigneeAddress?.name ||
                          form.consignee_name ||
                          selectedBuyer.name}
                      </span>
                      <br />
                      {shippingConsigneeAddress
                        ? [
                            shippingConsigneeAddress.address,
                            shippingConsigneeAddress.city,
                            shippingConsigneeAddress.state,
                            shippingConsigneeAddress.pincode,
                          ]
                            .filter(Boolean)
                            .join(", ")
                        : formatBuyerAddress(selectedBuyer, form)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="py-4 text-center text-[13px] text-[#a0a0ab]">
                  Select a buyer to continue
                </p>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* Items                                                            */}
          {/* ---------------------------------------------------------------- */}

          <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
            <SectionHeader
              icon={Package}
              title={
                <>
                  Item Details{" "}
                  <span className="text-red-500">
                    *
                  </span>
                </>
              }
            >
              <button
                type="button"
                onClick={() =>
                  setAddItemOpen(
                    true
                  )
                }
                className="rounded-lg border border-[#d0d0d8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4a4a55]"
              >
                + Add New Item
              </button>
            </SectionHeader>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-[12px]">
                <thead className="ui-table-head">
                  <tr>
                    {[
                      "#",
                      "Item Name",
                      "HSN",
                      "Qty Unit",
                      "Price",
                      "Tax Type",
                      "Discount",
                      "Taxable Value",
                      "GST",
                      "Total Amt",
                      "",
                    ].map((h) => (
                      <th
                        key={
                          h || "x"
                        }
                        className="whitespace-nowrap border-b border-r border-[#d0d0d8] px-2 py-2.5 font-semibold last:border-r-0"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {items.map(
                    (row, idx) => {
                      const t =
                        lineTotals(
                          row
                        );

                      const hasDesc =
                        Boolean(
                          row.item_description?.trim()
                        );

                      return (
                        <tr
                          key={idx}
                        >
                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2 text-[#9a9aa5]">
                            {idx + 1}
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2.5 py-2 min-w-[220px]">
                            {row.product_id || (row.item_description && itemPickerIdx !== idx) ? (
                              <div className="py-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className="font-bold text-[#111827] dark:text-slate-100 text-[13px] leading-tight cursor-pointer hover:text-indigo-600 transition"
                                    title="Click to re-select or change item"
                                    onClick={() => {
                                      updateItem(idx, "product_id", null);
                                      updateItem(idx, "item_description", "");
                                      setItemPickerIdx(idx);
                                      setItemSearch("");
                                    }}
                                  >
                                    {row.item_description || "Selected Item"}
                                  </span>
                                  <button
                                    type="button"
                                    title="View item details"
                                    onClick={() => {
                                      const p = getProductForRow(row);
                                      if (p) setSelectedDetailProduct(p);
                                    }}
                                    className="inline-flex items-center justify-center p-0.5 text-slate-400 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 transition cursor-pointer"
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </div>

                                {row.showDescription || row.long_description ? (
                                  <div className="mt-1">
                                    <textarea
                                      rows={2}
                                      value={row.long_description || ""}
                                      onChange={(e) => updateItem(idx, "long_description", e.target.value)}
                                      placeholder="Enter line item description..."
                                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => updateItem(idx, "showDescription", true)}
                                    className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline dark:text-indigo-400 cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Description
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="relative min-w-[190px]">
                                <div className="group relative flex items-center rounded-full border border-blue-300 bg-white px-3 py-1 text-xs shadow-sm focus-within:ring-2 focus-within:ring-blue-200 focus-within:border-blue-400 transition-all">
                                  <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1.5" />
                                  <input
                                    type="text"
                                    value={
                                      itemPickerIdx === idx
                                        ? itemSearch
                                        : row.item_description || ""
                                    }
                                    onFocus={() => {
                                      setItemPickerIdx(idx);
                                      setItemSearch(row.item_description || "");
                                    }}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setItemPickerIdx(idx);
                                      setItemSearch(v);
                                      updateItem(idx, "item_description", v);
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => {
                                        setItemPickerIdx((cur) => (cur === idx ? null : cur));
                                      }, 200);
                                    }}
                                    placeholder="Select Item"
                                    className="w-full bg-transparent border-0 outline-none text-xs text-slate-800 placeholder-slate-400 p-0 focus:ring-0"
                                  />
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setItemPickerIdx(null);
                                      setItemModalTargetIdx(idx);
                                    }}
                                    title="Browse & select all items in popup modal"
                                    className="ml-1 shrink-0 p-0.5 text-blue-500 hover:text-blue-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity cursor-pointer"
                                  >
                                    <Grid2x2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>

                                {itemPickerIdx === idx ? (
                                  <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl transition-all">
                                    {filteredProducts.length === 0 ? (
                                      <p className="px-3 py-2.5 text-[12px] text-slate-500">
                                        No products found.{" "}
                                        <button
                                          type="button"
                                          className="font-semibold text-indigo-600 hover:underline"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => setAddItemOpen(true)}
                                        >
                                          + Add New Item
                                        </button>
                                      </p>
                                    ) : (
                                      filteredProducts.map((p) => (
                                        <button
                                          key={p.id}
                                          type="button"
                                          className="block w-full rounded-xl px-3 py-2 text-left text-[12px] hover:bg-slate-50 transition"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => selectProductForRow(idx, p)}
                                        >
                                          <span className="font-bold text-[#111827] dark:text-slate-100 text-[13px] block leading-tight">
                                            {p.name || p.sku}
                                          </span>
                                          <span className="mt-0.5 block text-[11px] text-[#6b7280]">
                                            {[
                                              p.sku,
                                              p.hsn_code ? `HSN ${p.hsn_code}` : null,
                                              p.current_stock != null ? `Stock ${p.current_stock}` : null,
                                            ]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </span>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                            <input
                              value={
                                row.hsn
                              }
                              onChange={(
                                e
                              ) =>
                                updateItem(
                                  idx,
                                  "hsn",
                                  e.target
                                    .value
                                )
                              }
                              className="w-16 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                            />
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2 min-w-[140px]">
                            <div className="flex gap-1 items-center">
                              <ShorthandQuantityInput
                                value={row.qty}
                                onChange={(val) => updateItem(idx, "qty", val)}
                                placeholder="0"
                                className="w-full text-xs min-w-[85px]"
                              />

                              <select
                                value={
                                  row.unit
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateItem(
                                    idx,
                                    "unit",
                                    e.target
                                      .value
                                  )
                                }
                                className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5 text-xs shrink-0"
                              >
                                <option value="">
                                  Unit
                                </option>

                                <option value="pcs">
                                  pcs
                                </option>

                                <option value="KGS">
                                  KGS
                                </option>

                                <option value="MT">
                                  MT
                                </option>
                              </select>
                            </div>
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2 min-w-[120px]">
                            <div className="flex items-center gap-0.5">
                              <span className="text-[#9a9aa5] shrink-0">
                                ₹
                              </span>

                              <ShorthandQuantityInput
                                value={row.rate}
                                onChange={(val) => updateItem(idx, "rate", val)}
                                placeholder="0"
                                className="w-full text-xs min-w-[95px]"
                              />
                            </div>
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                            <select
                              value={
                                row.tax_type
                              }
                              onChange={(
                                e
                              ) =>
                                updateItem(
                                  idx,
                                  "tax_type",
                                  e.target
                                    .value
                                )
                              }
                              className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                            >
                              <option>
                                Exclusive
                              </option>

                              <option>
                                Inclusive
                              </option>
                            </select>
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={
                                  row.discount
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateItem(
                                    idx,
                                    "discount",
                                    e.target
                                      .value
                                  )
                                }
                                className="w-14 rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                              />

                              <select
                                value={
                                  row.discount_type
                                }
                                onChange={(
                                  e
                                ) =>
                                  updateItem(
                                    idx,
                                    "discount_type",
                                    e.target
                                      .value
                                  )
                                }
                                className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1 py-1.5"
                              >
                                <option value="₹">
                                  ₹
                                </option>

                                <option value="%">
                                  %
                                </option>
                              </select>
                            </div>
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2 tabular-nums text-[#6b6b76]">
                            {hasDesc
                              ? t.taxable.toFixed(
                                  2
                                )
                              : "—"}
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                            <select
                              value={
                                row.gst_pct
                              }
                              onChange={(
                                e
                              ) =>
                                updateItem(
                                  idx,
                                  "gst_pct",
                                  e.target
                                    .value
                                )
                              }
                              className="rounded-md border border-[#d0d0d8] bg-[#f7f7f9] px-1.5 py-1.5"
                            >
                              <option value="">
                                —
                              </option>

                              <option value="0">
                                0%
                              </option>

                              <option value="5">
                                5%
                              </option>

                              <option value="12">
                                12%
                              </option>

                              <option value="18">
                                18%
                              </option>

                              <option value="28">
                                28%
                              </option>
                            </select>
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2 font-semibold tabular-nums">
                            {hasDesc
                              ? t.total.toFixed(
                                  2
                                )
                              : "—"}
                          </td>

                          <td className="border-b border-r border-[#d0d0d8] px-2 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                removeItem(
                                  idx
                                )
                              }
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-4 border-t border-[#d0d0d8] p-4 sm:flex-row sm:items-start sm:justify-between">
              <button
                type="button"
                onClick={addEmptyItemRow}
                className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-[13px] font-semibold"
                style={{
                  borderColor:
                    ERP_PRIMARY,
                  color:
                    ERP_PRIMARY,
                  background:
                    "#f8f5ff",
                }}
              >
                + Add More Item
              </button>

              <div className="min-w-[260px] overflow-hidden rounded-lg border border-[#d0d0d8] text-[13px]">
                <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 text-[#6b6b76]">
                  <span>
                    Taxable Amount
                  </span>

                  <span className="tabular-nums">
                    ₹{" "}
                    {taxableAmount.toFixed(
                      2
                    )}
                  </span>
                </div>

                <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 text-[#6b6b76]">
                  <span>
                    GST Amount
                  </span>

                  <span className="tabular-nums">
                    ₹{" "}
                    {gstAmount.toFixed(
                      2
                    )}
                  </span>
                </div>

                <div className="flex justify-between border-b border-dashed border-[#d0d0d8] px-3 py-2 font-medium text-[#1a1a1f]">
                  <span>
                    Total Amount
                  </span>

                  <span className="tabular-nums">
                    ₹{" "}
                    {itemsTotal.toFixed(
                      2
                    )}
                  </span>
                </div>

                <div className="flex justify-between border-b border-[#d0d0d8] bg-[#fafafa] px-3 py-2.5 text-[16px] font-bold text-[#1a1a1f]">
                  <span>
                    Final Amount
                  </span>

                  <span className="tabular-nums">
                    ₹{" "}
                    {finalAmount.toFixed(
                      2
                    )}
                  </span>
                </div>

                <div className="flex flex-col gap-2 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      setOtherChargeOpen(
                        true
                      )
                    }
                    className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                    style={{
                      borderColor:
                        ERP_PRIMARY,
                      color:
                        ERP_PRIMARY,
                    }}
                  >
                    {otherChargeMeta?.charge_name
                      ? `${otherChargeMeta.charge_name} · ₹ ${otherCharge.toFixed(
                          2
                        )}`
                      : "+ Add Other Charge"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setDiscountOpen(
                        true
                      )
                    }
                    className="rounded-full border bg-white px-3 py-1.5 text-[12px] font-semibold"
                    style={{
                      borderColor:
                        ERP_PRIMARY,
                      color:
                        ERP_PRIMARY,
                    }}
                  >
                    {invoiceDiscount >
                    0
                      ? `Discount · ₹ ${invoiceDiscount.toFixed(
                          2
                        )}`
                      : "+ Add Quotation Level Discount"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* Optional fields                                                  */}
          {/* ---------------------------------------------------------------- */}

          <div className="space-y-3">
            <p className="text-center text-[12px] font-bold uppercase tracking-[0.12em] text-[#6b6b76]">
              Optional Fields
            </p>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={Grid2x2}
                title="Other Details"
                collapsible
                open={otherDetailsOpen}
                onToggle={() =>
                  setOtherDetailsOpen((v) => !v)
                }
              />
              {otherDetailsOpen ? (
                <div className="space-y-3 p-4">
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
                          <p className="mt-0.5 truncate text-[12px] text-[#6b6b76]">
                            {field.value}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCustomFields((rows) =>
                            rows.filter((x) => x.id !== field.id)
                          )
                        }
                        className="rounded p-1 text-[#9a9aa5] hover:bg-[#f0f0f4] hover:text-[#e11d48]"
                        aria-label={`Remove ${field.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}

                  <div className="rounded-lg border border-[#e4e4ea] bg-white p-4">
                    <button
                      type="button"
                      onClick={() => setCustomFieldOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] transition-colors"
                    >
                      <Plus className="h-4 w-4" strokeWidth={2.5} />
                      Add Custom Field
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={Building2}
                title="Bank / Payment Details (Optional)"
              >
                <button
                  type="button"
                  onClick={() => setBankModalOpen(true)}
                  className="rounded-lg border border-[#d8d8e0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#4a4a55] hover:bg-[#f5f5f7]"
                >
                  {bankAccount
                    ? "Edit Bank Details"
                    : "+ Add New Bank Details"}
                </button>
              </SectionHeader>
              {bankAccount ? (
                <div className="space-y-1 border-t border-[#ececf0] p-4 text-[13px] text-[#4a4a55]">
                  <p className="font-semibold text-[#1a1a1f]">
                    {bankAccount.bank_name}
                  </p>
                  {bankAccount.account_holder ? (
                    <p>{bankAccount.account_holder}</p>
                  ) : null}
                  {bankAccount.account_number ? (
                    <p className="tabular-nums">
                      A/C: {bankAccount.account_number}
                    </p>
                  ) : null}
                  <p>
                    {[bankAccount.ifsc, bankAccount.branch_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {bankAccount.upi_id ? (
                    <p>
                      UPI: {bankAccount.upi_id}
                      {bankAccount.show_upi_qr
                        ? " · QR on quotation"
                        : ""}
                    </p>
                  ) : null}
                  {bankAccount.iban ? (
                    <p className="tabular-nums">
                      IBAN: {bankAccount.iban}
                    </p>
                  ) : null}
                  {bankAccount.swift ? (
                    <p className="tabular-nums">
                      Swift: {bankAccount.swift}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader
                icon={User}
                title="Contact Person Details"
              >
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  className="rounded-lg border border-[#d8d8e0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#4a4a55] hover:bg-[#f5f5f7]"
                >
                  {contactPerson
                    ? "Edit Contact"
                    : "+ Add New Contact"}
                </button>
              </SectionHeader>
              {contactPerson ? (
                <div className="space-y-1 border-t border-[#ececf0] p-4 text-[13px] text-[#4a4a55]">
                  <p className="font-semibold text-[#1a1a1f]">
                    {contactPerson.name}
                  </p>
                  {contactPerson.phone ? (
                    <p>{contactPerson.phone}</p>
                  ) : null}
                  {contactPerson.email ? (
                    <p>{contactPerson.email}</p>
                  ) : null}
                </div>
              ) : null}
            </section>

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
                  <User className="h-3.5 w-3.5" /> Select Terms and
                  Conditions
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTermsAddOpen(true);
                  }}
                  className="rounded-full border border-[#d8d8e0] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#4a4a55] hover:bg-[#f5f5f7]"
                >
                  + Add New Terms and Conditions
                </button>
              </SectionHeader>
              {termsOpen && termsAttached && form.notes ? (
                <div className="p-4">
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        notes: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-[#e4e4ea] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#1a1a1f] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  />
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader icon={FileText} title="Notes">
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="rounded-full border border-[#d8d8e0] bg-white px-3.5 py-1.5 text-[12px] font-semibold"
                  style={{
                    color: ERP_PRIMARY,
                    borderColor: ERP_PRIMARY,
                  }}
                >
                  + Add New Note
                </button>
              </SectionHeader>
              {extraNote ? (
                <div className="border-t border-[#ececf0] p-4 text-[13px] leading-relaxed text-[#4a4a55] whitespace-pre-wrap">
                  {extraNote}
                </div>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-xl border border-[#d0d0d8] bg-white">
              <SectionHeader icon={User} title="Signature and Stamp">
                <button
                  type="button"
                  role="switch"
                  aria-checked={signatureOn}
                  onClick={() => setSignatureOn((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition ${
                    signatureOn
                      ? "bg-[var(--color-primary)]"
                      : "bg-[#d4d4d8]"
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

      {/* -------------------------------------------------------------------- */}
      {/* Modals                                                               */}
      {/* -------------------------------------------------------------------- */}

      <EditCompanyDetailsModal
        open={editCompanyOpen}
        onClose={() =>
          setEditCompanyOpen(false)
        }
        onSaved={(data) =>
          setCompany(data)
        }
      />

      <AddNewPartyModal
        open={addBuyerOpen}
        customer={editingBuyer}
        onClose={() => {
          setAddBuyerOpen(false);
          setEditingBuyer(null);
        }}
        onSaved={(buyer, meta) => {
          if (!buyer) {
            return;
          }

          setCustomers((rows) => [
            buyer,
            ...rows.filter(
              (c) =>
                c.id !==
                buyer.id
            ),
          ]);

          setForm((f) => {
            const next = {
              ...f,
              customer_id: buyer.id,
            };

            const consigneeFromBuyer = {
              ...customerToConsigneeFields(
                buyer
              ),
              consignee_phone:
                buyer.phone ||
                buyer.mobile ||
                "",
              consignee_email:
                buyer.email || "",
            };

            Object.assign(next, consigneeFromBuyer);

            return next;
          });

          setEditingBuyer(null);
          setShowBuyerPicker(
            false
          );
        }}
      />

      <ConfirmDialog
        open={removeBuyerConfirmOpen}
        title="Remove Buyer?"
        message="Are you sure you want to remove the selected buyer from this quotation?"
        confirmLabel="Remove Buyer"
        cancelLabel="Cancel"
        destructive={false}
        onClose={() =>
          setRemoveBuyerConfirmOpen(
            false
          )
        }
        onConfirm={handleConfirmRemoveBuyer}
      />

      <AddNewItemModal
        open={addItemOpen}
        onClose={() =>
          setAddItemOpen(false)
        }
        onSaved={(line) => {
          if (!line) {
            return;
          }

          const withAmount = {
            ...emptyItem(),
            ...line,
            amount:
              lineTotals(line)
                .total,
          };

          setItems((prev) => {
            const blankIdx =
              prev.findIndex(
                (r) =>
                  !r.item_description?.trim()
              );

            if (blankIdx >= 0) {
              const next = [
                ...prev,
              ];

              next[blankIdx] =
                withAmount;

              return next;
            }

            return [
              ...prev,
              withAmount,
            ];
          });
        }}
      />

      <AddOtherChargesModal
        open={otherChargeOpen}
        onClose={() =>
          setOtherChargeOpen(
            false
          )
        }
        initial={
          otherChargeMeta
        }
        onSave={(charge) => {
          setOtherChargeMeta(
            charge
          );

          setForm((f) => ({
            ...f,

            other_charge:
              computeOtherChargeTotal(
                charge
              ),
          }));
        }}
      />

      <AddInvoiceDiscountModal
        open={discountOpen}
        onClose={() =>
          setDiscountOpen(false)
        }
        initial={
          discountMeta
        }
        baseAmount={
          itemsTotal
        }
        onSave={(disc) => {
          setDiscountMeta(
            disc
          );

          setForm((f) => ({
            ...f,

            discount:
              disc.amount || 0,
          }));
        }}
      />

      <AddTransporterDetailsModal
        open={
          transporterModalOpen
        }
        onClose={() =>
          setTransporterModalOpen(
            false
          )
        }
        initial={{
          transporter_name:
            form.transporter_name,

          transporter_id:
            form.transporter_id,
        }}
        onSave={(data) => {
          setForm((f) => ({
            ...f,

            transporter_name:
              data.transporter_name ||
              "",

            transporter_id:
              data.transporter_id ||
              "",
          }));
        }}
      />

      <AddCustomFieldModal
        open={customFieldOpen}
        onClose={() =>
          setCustomFieldOpen(
            false
          )
        }
        existingFields={customFields}
        onSave={(field) =>
          setCustomFields(
            (rows) => [
              ...rows,
              field,
            ]
          )
        }
      />

      <AddBankAccountModal
        open={bankModalOpen}
        documentLabel="Quotation"
        onClose={() =>
          setBankModalOpen(
            false
          )
        }
        initial={
          bankAccount
        }
        onSave={(data) => {
          setBankAccount(
            data
          );

          updateCompanySettings({
            bank_name:
              data.bank_name ||
              null,

            bank_account_number:
              data.account_number ||
              null,

            bank_ifsc:
              data.ifsc || null,

            bank_branch:
              data.branch_name ||
              null,
          }).catch(() => {});
        }}
      />

      <TermsAndConditionsPicker
        open={
          termsPickerOpen
        }
        onClose={() =>
          setTermsPickerOpen(
            false
          )
        }
        value={form.notes}
        onChange={(body) => {
          setTermsAttached(
            true
          );

          setTermsOpen(true);

          setForm((f) => ({
            ...f,
            notes: body,
          }));
        }}
        onRemove={() => {
          setTermsAttached(
            false
          );

          setForm((f) => ({
            ...f,
            notes: "",
          }));
        }}
      />

      <AddTermsAndConditionsModal
        open={termsAddOpen}
        onClose={() =>
          setTermsAddOpen(
            false
          )
        }
        onSave={(item) => {
          try {
            const raw =
              localStorage.getItem(
                "gns_invoice_terms_templates"
              );

            const list = raw
              ? JSON.parse(raw)
              : [];

            const next =
              Array.isArray(list)
                ? [
                    ...list,
                    item,
                  ]
                : [item];

            localStorage.setItem(
              "gns_invoice_terms_templates",
              JSON.stringify(
                next
              )
            );
          } catch {
            /* ignore */
          }

          setTermsAttached(
            true
          );

          setTermsOpen(true);

          setForm((f) => ({
            ...f,
            notes: item.body,
          }));
        }}
      />

      <AddPrefixModal
        open={prefixModalOpen}
        onClose={() =>
          setPrefixModalOpen(
            false
          )
        }
        onSubmit={(value) => {
          setCustomPrefixes(
            (prev) => {
              const next =
                prev.includes(
                  value
                )
                  ? prev
                  : [
                      ...prev,
                      value,
                    ];

              saveCustomPrefixes(
                next
              );

              return next;
            }
          );

          setForm((f) => ({
            ...f,
            invoice_prefix:
              value,
          }));

          setPrefixModalOpen(
            false
          );
        }}
      />

      <AddContactPersonModal
        open={contactOpen}
        onClose={() =>
          setContactOpen(false)
        }
        initial={
          contactPerson
        }
        onSave={
          setContactPerson
        }
      />

      <AddNoteModal
        open={noteOpen}
        onClose={() =>
          setNoteOpen(false)
        }
        initial={extraNote}
        onSave={
          setExtraNote
        }
      />

      {isAdmin && (
        <ShareToSalesTeamModal
          open={shareOpen}
          onClose={() =>
            setShareOpen(false)
          }
          docType="quotation"
          docNo={[
            form.invoice_prefix,
            form.invoice_number,
          ]
            .filter(Boolean)
            .join("-") ||
            editId ||
            "Quotation"}
          docId={
            editId || ""
          }
          buyerName={
            customers.find(
              (c) =>
                String(c.id) ===
                String(
                  form.customer_id
                )
            )?.name ||
            form.consignee_name ||
            ""
          }
          grandTotal={
            finalAmount
          }
        />
      )}
      {selectedDetailProduct && (
        <ProductDetailModal
          product={selectedDetailProduct}
          onClose={() => setSelectedDetailProduct(null)}
        />
      )}
      {itemModalTargetIdx !== null && (
        <ItemSelectionModal
          isOpen={itemModalTargetIdx !== null}
          products={products}
          onSelect={(product) => {
            selectProductForRow(itemModalTargetIdx, product);
            setItemModalTargetIdx(null);
          }}
          onClose={() => setItemModalTargetIdx(null)}
          onAddNew={() => {
            setItemModalTargetIdx(null);
            setAddItemOpen(true);
          }}
        />
      )}
    </form>
  );
}
