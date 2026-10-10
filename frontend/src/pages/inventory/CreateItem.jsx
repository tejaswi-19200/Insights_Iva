import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Calendar,
  Save,
  Upload,
} from "lucide-react";

import Button from "../../components/common/Button";
import ShorthandQuantityInput from "../../components/common/ShorthandQuantityInput";
import PageHeader from "../../components/common/PageHeader";
import { createInventoryItem, getInventoryItem, getWarehouses, updateInventoryItem } from "../../api/inventoryApi";
import InventoryItemPhoto from "../../components/inventory/InventoryItemPhoto";
import {
  uploadAndAttachItemPhoto,
  validateInventoryPhotoFile,
} from "../../utils/inventoryItemPhoto";
import { useToast } from "../../context/ToastContext";
import useTenantId from "../../hooks/useTenantId";
import { apiErrorMessage, asArray } from "../../utils/apiError";
import { todayIso } from "../../utils/dateUtils";
import { emitManufacturingEvent, MANUFACTURING_EVENTS } from "../../utils/manufacturingEvents";

const TABS = [
  { id: "basic", label: "Basic Information" },
  { id: "units-pricing", label: "Units & Pricing" },
  { id: "tax", label: "Tax & Accounting" },
  { id: "inventory", label: "Inventory Details" },
  { id: "additional", label: "Additional Information" },
  { id: "all", label: "All Sections" },
];

const RAW_CATEGORIES = [
  "Metals",
  "Plastics",
  "Chemicals",
  "Liquids",
  "Hardware",
  "Rubber",
  "Electrical",
  "Raw Materials",
  "Consumables",
  "Packaging",
];

const FG_CATEGORIES = [
  "Finished Goods",
  "Assemblies",
  "Machined Parts",
  "Hardware",
  "Electrical",
  "Spare Parts",
  "Beverages",
];

const UNITS = ["KG", "Nos", "Pcs", "Ltr", "Mtr", "Roll", "Box", "Sheet", "Drum", "Gms", "Sqmtr", "Tons", "Sets"];

const GST_RATES = ["0", "5", "12", "18", "28"];
const GST_TYPES = ["CGST/SGST", "IGST", "Exempt"];
const TAX_TYPES = ["Taxable", "Nil Rated", "Exempt", "Non-GST"];

const DEFAULT_WAREHOUSES = ["Main Warehouse", "RM Store", "FG Store", "Unit-1 Warehouse"];

function Field({ label, required, hint, children, className = "" }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[12px] font-semibold text-[var(--color-text)]">
        {label}
        {required ? <span className="ml-0.5 text-[#ef4444]">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{hint}</p> : null}
    </div>
  );
}

function Card({ id, title, subtitle, children, className = "" }) {
  return (
    <section id={id} className={`ui-card scroll-mt-28 p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 ${className}`.trim()}>
      <div className="mb-4">
        <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        {subtitle ? <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[var(--color-action-teal)]"
      />
      <span>
        <span className="block text-[13px] font-medium text-[var(--color-text)]">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">{hint}</span> : null}
      </span>
    </label>
  );
}

export default function CreateItem() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get("type") === "finished_good" ? "finished_good" : "raw_material";
  const editItemId = Number(searchParams.get("edit") || 0) || null;
  const isEditMode = Boolean(editItemId);

  const [activeTab, setActiveTab] = useState("basic");
  const [warehouses, setWarehouses] = useState(DEFAULT_WAREHOUSES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [existingPhotoFileId, setExistingPhotoFileId] = useState(null);
  const fileRef = useRef(null);

  const [form, setForm] = useState({
    item_type: initialType,
    category: "",
    sku_suffix: "",
    name: "",
    description: "",
    hsn_sac: "",
    brand: "",
    model_part_no: "",
    base_unit: initialType === "raw_material" ? "KG" : "Pcs",
    purchase_unit: initialType === "raw_material" ? "KG" : "Pcs",
    sales_unit: "Pcs",
    conversion_factor: "1.0000",
    purchase_price: "0.00",
    sales_price: "0.00",
    mrp: "0.00",
    standard_cost: "0.00",
    gst_rate: "18",
    gst_type: "CGST/SGST",
    tax_type: "Taxable",
    tax_exempt: false,
    available_qty: "0",
    reserved_qty: "0",
    reorder_level: "10",
    reorder_qty: "0",
    min_stock: "0",
    max_stock: "0",
    keep_stock: true,
    is_active: true,
    warehouse_name: "Main Warehouse",
    batch_number: "",
    serial_number: "",
    warranty: "",
    notes: "",
  });

  const isFinishedGood = form.item_type === "finished_good";
  const backPath = isFinishedGood ? "/inventory/finished-goods" : "/inventory/raw-materials";
  const skuPrefix = isFinishedGood ? "FG-" : "RM-";
  const categories = isFinishedGood ? FG_CATEGORIES : RAW_CATEGORIES;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    getWarehouses()
      .then((r) => {
        const names = asArray(r.data).map((w) => w.name).filter(Boolean);
        if (names.length) {
          setWarehouses(names);
          setForm((f) => ({
            ...f,
            warehouse_name: names.includes(f.warehouse_name) ? f.warehouse_name : names[0],
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setForm((f) => ({
      ...f,
      item_type: initialType,
      category: "",
      sku_suffix: "",
    }));
  }, [initialType]);

  useEffect(() => {
    if (!editItemId) return;
    getInventoryItem(editItemId)
      .then((res) => {
        const item = res.data;
        if (!item) return;
        setExistingPhotoFileId(item.photo_file_id || null);
        const skuSuffix = (item.sku || "").replace(/^RM-|^FG-/i, "");
        setForm((f) => ({
          ...f,
          item_type: item.item_type || initialType,
          category: item.category || "",
          sku_suffix: skuSuffix,
          name: item.name || "",
          description: item.description || "",
          base_unit: item.unit || f.base_unit,
          warehouse_name: item.warehouse_name || f.warehouse_name,
          reorder_level: String(item.reorder_level ?? 0),
          available_qty: String(Math.max(0, (item.quantity || 0) - (item.reserved || 0))),
          reserved_qty: String(item.reserved || 0),
          model_part_no: item.barcode || "",
          is_active: item.is_active !== false,
        }));
      })
      .catch(() => addToast("Could not load item for edit", "error"));
  }, [editItemId, initialType, addToast]);

  const goToTab = (id) => {
    setActiveTab(id);
    const formEl = document.getElementById("create-item-form");
    if (formEl) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const onImagePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateInventoryPhotoFile(file);
    if (validation) {
      addToast(validation, "error");
      return;
    }
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setPendingPhotoFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const resolveSku = () => {
    const suffix = (form.sku_suffix || "").trim().replace(/^RM-|^FG-/i, "");
    if (suffix) return `${skuPrefix}${suffix}`;
    return `${skuPrefix}${Math.floor(1000 + Math.random() * 9000)}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Item name is required");
      goToTab("basic");
      return;
    }
    if (!form.category) {
      setError("Item category is required");
      goToTab("basic");
      return;
    }
    if (!form.base_unit) {
      setError("Base unit is required");
      goToTab("units-pricing");
      return;
    }
    if (!form.gst_rate || !form.gst_type) {
      setError("GST rate and GST type are required");
      goToTab("tax");
      return;
    }

    const sku = isEditMode ? (form.sku_suffix ? `${skuPrefix}${form.sku_suffix.replace(/^RM-|^FG-/i, "")}` : undefined) : resolveSku();

    const metaParts = [
      form.hsn_sac && `HSN/SAC: ${form.hsn_sac}`,
      form.brand && `Brand: ${form.brand}`,
      form.model_part_no && `Model: ${form.model_part_no}`,
      form.gst_rate && `GST: ${form.gst_rate}%`,
      form.gst_type && `GST Type: ${form.gst_type}`,
      form.tax_type && `Tax: ${form.tax_type}`,
      form.tax_exempt && "Tax Exempt",
      form.sales_price && `Sales Price: ₹${form.sales_price}`,
      form.mrp && `MRP: ₹${form.mrp}`,
      form.reorder_qty && `Reorder Qty: ${form.reorder_qty}`,
      form.min_stock && `Min Stock: ${form.min_stock}`,
      form.max_stock && `Max Stock: ${form.max_stock}`,
      form.notes && form.notes,
    ].filter(Boolean);

    const description = [form.description.trim(), metaParts.length ? metaParts.join(" · ") : ""]
      .filter(Boolean)
      .join("\n");

    setSaving(true);
    try {
      const avail = Math.max(0, Math.round(Number(form.available_qty) || 0));
      const res = Math.max(0, Math.round(Number(form.reserved_qty) || 0));
      const totalQty = avail + res;
      const reorderLvl = Math.max(0, Math.round(Number(form.reorder_level) || 0));
      const unitCost = Number(form.purchase_price) || Number(form.standard_cost) || null;

      const payload = {
        tenant_id: Number(tenantId) || 1,
        supplier_id: null,
        sku,
        barcode: form.model_part_no?.trim() || null,
        name: form.name.trim(),
        description: description || null,
        category: form.category || (isFinishedGood ? "Finished Goods" : "Raw Materials"),
        warehouse_name: form.warehouse_name || "Main Warehouse",
        batch_number: form.batch_number?.trim() || null,
        quantity: form.keep_stock ? totalQty : 0,
        reserved: form.keep_stock ? res : 0,
        unit: form.base_unit || "Pcs",
        unit_cost: unitCost,
        reorder_level: reorderLvl,
        status: form.keep_stock ? (avail > 0 ? "in_stock" : "low_stock") : "inactive",
        customer_name: null,
        serial_number: form.serial_number?.trim() || null,
        expiry_date: null,
        production_date: null,
        warranty: isFinishedGood ? form.warranty?.trim() || null : null,
        item_type: form.item_type,
        is_active: form.is_active !== false,
      };

      let savedItemId = editItemId;
      if (isEditMode && editItemId) {
        const updatePayload = {
          name: payload.name,
          description: payload.description,
          category: payload.category,
          unit: payload.unit,
          unit_cost: payload.unit_cost,
          reorder_level: payload.reorder_level,
          warehouse_name: payload.warehouse_name,
          barcode: payload.barcode,
          quantity: payload.quantity,
          reserved: payload.reserved,
          is_active: payload.is_active,
        };
        if (sku) updatePayload.sku = sku;
        const res = await updateInventoryItem(editItemId, updatePayload);
        savedItemId = res.data?.id || editItemId;
        setExistingPhotoFileId(res.data?.photo_file_id || existingPhotoFileId);
      } else {
        const res = await createInventoryItem(payload);
        savedItemId = res.data?.id;
        if (!savedItemId) {
          throw new Error("Item was created but no id was returned.");
        }
      }

      if (pendingPhotoFile && savedItemId) {
        const fileId = await uploadAndAttachItemPhoto(pendingPhotoFile, savedItemId);
        setExistingPhotoFileId(fileId);
        setPendingPhotoFile(null);
      }

      try {
        emitManufacturingEvent(MANUFACTURING_EVENTS.INVENTORY_CHANGED, {
          item_type: form.item_type,
          sku: sku || form.sku_suffix,
          name: form.name.trim(),
        });
      } catch {}

      addToast(isEditMode ? "Item updated successfully" : "Item created successfully", "success");
      navigate(backPath);
    } catch (err) {
      const msg = apiErrorMessage(err, "Failed to create item.");
      setError(msg);
      addToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6 pb-28 min-w-0 w-full">
      <PageHeader variant="inventory"
        title={isFinishedGood ? "Add New Finished Good" : "Add New Raw Material"}
        subtitle={
          isFinishedGood
            ? "Create a manufactured finished product ready for inventory, BOM, and customer sales."
            : "Register a raw material, resin, metal, or component for procurement and shop floor production."
        }
        backTo={backPath}
        backLabel={isFinishedGood ? "Back to Finished Goods" : "Back to Raw Materials"}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-500">Default Warehouse:</span>
            <select
              value={form.warehouse_name}
              onChange={(e) => set("warehouse_name", e.target.value)}
              className="ui-select !w-auto min-w-[11rem]"
              aria-label="Warehouse"
            >
              {warehouses.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className="overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        <nav className="flex min-w-max gap-2" aria-label="Create item sections">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goToTab(tab.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? "border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300"
                    : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <form id="create-item-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information Section */}
        <div className={`space-y-6 ${activeTab === "basic" || activeTab === "all" ? "" : "hidden"}`}>
          <div className="grid gap-6 xl:grid-cols-12">
            <Card
              id="basic"
              title="1. Basic Information"
              subtitle="Core item classification, names, codes, and identifiers"
              className="xl:col-span-8"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Item Classification" required>
                  <select
                    value={form.item_type}
                    onChange={(e) => {
                      const t = e.target.value;
                      setForm((f) => ({
                        ...f,
                        item_type: t,
                        category: "",
                        sku_suffix: "",
                        base_unit: t === "raw_material" ? "KG" : "Pcs",
                        purchase_unit: t === "raw_material" ? "KG" : "Pcs",
                      }));
                    }}
                    className="ui-select w-full"
                  >
                    <option value="raw_material">Raw Material (Input Component)</option>
                    <option value="finished_good">Finished Good (Manufactured)</option>
                  </select>
                </Field>

                <Field label="Item Category" required>
                  <select
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                    className="ui-select w-full"
                  >
                    <option value="">Select Category</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Item Code / SKU" required hint="Auto-generated if left blank">
                  <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600">
                    <span className="flex items-center bg-slate-100 dark:bg-slate-800 px-3 text-[13px] font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700">
                      {skuPrefix}
                    </span>
                    <input
                      type="text"
                      placeholder="e.g. 1001"
                      value={form.sku_suffix}
                      onChange={(e) => set("sku_suffix", e.target.value)}
                      className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-[13px] outline-none"
                    />
                  </div>
                </Field>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Field label="Item Name" required hint={isFinishedGood ? "e.g. Hydraulic Valve Assembly" : "e.g. Stainless Steel Rod 25mm"}>
                  <input
                    type="text"
                    required
                    placeholder={isFinishedGood ? "Enter finished product name" : "Enter raw material name"}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>

                <Field label="Description / Specs" hint="Material grade, tolerance, specifications">
                  <textarea
                    rows={2}
                    placeholder="Enter specifications, technical grade, or description"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    className="ui-textarea w-full min-h-[76px]"
                  />
                </Field>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="HSN / SAC Code" hint="GST HSN classification code">
                  <input
                    type="text"
                    placeholder="e.g. 7228 / 8481"
                    value={form.hsn_sac}
                    onChange={(e) => set("hsn_sac", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>

                <Field label={isFinishedGood ? "Brand / Model" : "Brand / Grade"}>
                  <input
                    type="text"
                    placeholder={isFinishedGood ? "e.g. Precision 2000" : "e.g. SS-304 / Grade A"}
                    value={form.brand}
                    onChange={(e) => set("brand", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>

                <Field label="Model / Part No." hint="Supplier part number or drawing ref">
                  <input
                    type="text"
                    placeholder="e.g. DWG-2026-A"
                    value={form.model_part_no}
                    onChange={(e) => set("model_part_no", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>
              </div>
            </Card>

            <Card id="item-image" title="Item Photo / Asset" subtitle="Optional visual preview" className="xl:col-span-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex min-h-[190px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-4 py-6 text-center transition-colors hover:border-teal-600 hover:bg-slate-100 dark:hover:bg-slate-800/70"
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="Item preview" className="max-h-36 rounded-lg object-contain" />
                ) : existingPhotoFileId ? (
                  <InventoryItemPhoto photoFileId={existingPhotoFileId} className="max-h-36 rounded-lg object-contain" />
                ) : (
                  <>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white dark:bg-slate-700 text-slate-500 shadow-xs">
                      <Upload className="h-5 w-5" />
                    </span>
                    <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100">Upload Photo</span>
                    <span className="text-[11px] text-slate-400">PNG, JPG up to 2MB</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={onImagePick}
              />
              {imagePreview ? (
                <button
                  type="button"
                  onClick={() => {
                    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImagePreview(null);
                    setPendingPhotoFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="mt-2 text-xs font-semibold text-red-600 hover:underline"
                >
                  Clear selected photo
                </button>
              ) : null}
            </Card>
          </div>
          {activeTab !== "all" && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => goToTab("units-pricing")}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/60 px-5 py-2.5 text-xs font-bold text-teal-700 dark:text-teal-300 transition-colors"
              >
                Next: Units & Pricing &rarr;
              </button>
            </div>
          )}
        </div>

        {/* Units & Pricing Section */}
        <div className={`space-y-6 ${activeTab === "units-pricing" || activeTab === "all" ? "" : "hidden"}`}>
          <div id="units-pricing" className="grid gap-6 lg:grid-cols-2">
            <Card title="2. Units & Measurement" subtitle="Define stock counting units and conversion ratios">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Base Unit (Stock UOM)" required hint="Standard warehouse counting unit">
                  <select
                    value={form.base_unit}
                    onChange={(e) => set("base_unit", e.target.value)}
                    className="ui-select w-full"
                  >
                    <option value="">Select Unit</option>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </Field>

                {isFinishedGood ? (
                  <Field label="Sales Unit" hint="Unit used on Tax Invoices & Sales Orders">
                    <select
                      value={form.sales_unit}
                      onChange={(e) => set("sales_unit", e.target.value)}
                      className="ui-select w-full"
                    >
                      <option value="">Select Unit</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Purchase Unit" hint="Unit used when purchasing from vendors">
                    <select
                      value={form.purchase_unit}
                      onChange={(e) => set("purchase_unit", e.target.value)}
                      className="ui-select w-full"
                    >
                      <option value="">Select Unit</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label="Conversion Factor" required hint="1 Purchase Unit = ? Base Units">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={form.conversion_factor}
                    onChange={(e) => set("conversion_factor", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>
              </div>
            </Card>

            <Card title="3. Valuation & Pricing" subtitle={isFinishedGood ? "Sales pricing and manufacturing valuation" : "Procurement cost and valuation"}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Purchase / Procurement Price (₹)" hint="Standard supplier purchase price per unit">
                  <ShorthandQuantityInput
                    value={form.purchase_price}
                    onChange={(val) => set("purchase_price", val)}
                    placeholder="e.g. 500"
                  />
                </Field>

                <Field label="Standard Cost (₹)" hint="Cost used in BOM & valuation ledger">
                  <ShorthandQuantityInput
                    value={form.standard_cost}
                    onChange={(val) => set("standard_cost", val)}
                    placeholder="e.g. 500"
                  />
                </Field>

                {isFinishedGood ? (
                  <>
                    <Field label="Sales Price (₹)" hint="Default selling price before GST">
                      <ShorthandQuantityInput
                        value={form.sales_price}
                        onChange={(val) => set("sales_price", val)}
                        placeholder="e.g. 500"
                      />
                    </Field>

                    <Field label="MRP (₹)" hint="Maximum Retail Price (if applicable)">
                      <ShorthandQuantityInput
                        value={form.mrp}
                        onChange={(val) => set("mrp", val)}
                        placeholder="e.g. 500"
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            </Card>
          </div>
          {activeTab !== "all" && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => goToTab("basic")}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
              >
                &larr; Back: Basic Information
              </button>
              <button
                type="button"
                onClick={() => goToTab("tax")}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/60 px-5 py-2.5 text-xs font-bold text-teal-700 dark:text-teal-300 transition-colors"
              >
                Next: Tax & Accounting &rarr;
              </button>
            </div>
          )}
        </div>

        {/* Tax & GST Details Section */}
        <div className={`space-y-6 ${activeTab === "tax" || activeTab === "all" ? "" : "hidden"}`}>
          <Card id="tax" title="4. Tax & GST Details" subtitle="Tax rates for purchasing, job costing, and invoices">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GST Rate (%)" required>
                <select
                  value={form.gst_rate}
                  onChange={(e) => set("gst_rate", e.target.value)}
                  className="ui-select w-full"
                >
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>{r}% GST</option>
                  ))}
                </select>
              </Field>

              <Field label="GST Type" required>
                <select
                  value={form.gst_type}
                  onChange={(e) => set("gst_type", e.target.value)}
                  className="ui-select w-full"
                >
                  {GST_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Tax Classification" className="sm:col-span-2">
                <select
                  value={form.tax_type}
                  onChange={(e) => set("tax_type", e.target.value)}
                  className="ui-select w-full"
                >
                  {TAX_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <CheckRow
                checked={form.tax_exempt}
                onChange={(v) => set("tax_exempt", v)}
                label="Is Exempted from Tax"
                hint="Check if this raw material / item is nil-rated or exempt under GST"
              />
            </div>
          </Card>
          {activeTab !== "all" && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => goToTab("units-pricing")}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
              >
                &larr; Back: Units & Pricing
              </button>
              <button
                type="button"
                onClick={() => goToTab("inventory")}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/60 px-5 py-2.5 text-xs font-bold text-teal-700 dark:text-teal-300 transition-colors"
              >
                Next: Inventory Details &rarr;
              </button>
            </div>
          )}
        </div>

        {/* Inventory Details Section */}
        <div className={`space-y-6 ${activeTab === "inventory" || activeTab === "all" ? "" : "hidden"}`}>
          <Card id="inventory" title="5. Inventory & Stock Levels" subtitle="Opening stock, safety threshold, and reorder triggers">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opening Available Stock" required hint="Current quantity ready on shelf">
                <ShorthandQuantityInput
                  value={form.available_qty}
                  onChange={(val) => set("available_qty", val)}
                  placeholder="e.g. 500"
                />
              </Field>

              <Field label="Safety / Reorder Level" required hint="Alerts when available stock drops below this">
                <ShorthandQuantityInput
                  value={form.reorder_level}
                  onChange={(val) => set("reorder_level", val)}
                  placeholder="e.g. 500"
                />
              </Field>

              <Field label="Recommended Reorder Qty" hint="Standard batch order quantity">
                <ShorthandQuantityInput
                  value={form.reorder_qty}
                  onChange={(val) => set("reorder_qty", val)}
                  placeholder="e.g. 500"
                />
              </Field>

              <Field label="Reserved Stock" hint="Stock allocated to active work orders">
                <ShorthandQuantityInput
                  value={form.reserved_qty}
                  onChange={(val) => set("reserved_qty", val)}
                  placeholder="e.g. 500"
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/60 dark:border-slate-700/60">
              <CheckRow
                checked={form.keep_stock}
                onChange={(v) => set("keep_stock", v)}
                label="Track Live Stock"
                hint="Enable to maintain live balances and reorder alerts"
              />
              <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                Total On-Hand: <span className="font-bold text-slate-800 dark:text-slate-100">{Number(form.available_qty || 0) + Number(form.reserved_qty || 0)}</span> {form.base_unit || "Units"}
              </div>
            </div>
          </Card>
          {activeTab !== "all" && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => goToTab("tax")}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
              >
                &larr; Back: Tax & Accounting
              </button>
              <button
                type="button"
                onClick={() => goToTab("additional")}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 dark:hover:bg-teal-900/60 border border-teal-200 dark:border-teal-800/60 px-5 py-2.5 text-xs font-bold text-teal-700 dark:text-teal-300 transition-colors"
              >
                Next: Additional Information &rarr;
              </button>
            </div>
          )}
        </div>

        {/* Additional Information Section */}
        <div className={`space-y-6 ${activeTab === "additional" || activeTab === "all" ? "" : "hidden"}`}>
          <Card id="additional" title="6. Additional Tracking" subtitle="Batch numbers, supplier references, and notes">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Batch / Lot Number" hint="Optional manufacturer lot/heat number">
                <input
                  type="text"
                  placeholder="e.g. LOT-2026-08"
                  value={form.batch_number}
                  onChange={(e) => set("batch_number", e.target.value)}
                  className="ui-input w-full"
                />
              </Field>

              <Field label="Serial Number" hint="Optional individual serial number">
                <input
                  type="text"
                  placeholder="e.g. SN-8823"
                  value={form.serial_number}
                  onChange={(e) => set("serial_number", e.target.value)}
                  className="ui-input w-full"
                />
              </Field>

              {isFinishedGood ? (
                <Field label="Warranty Period">
                  <input
                    type="text"
                    placeholder="e.g. 12 Months Replacement"
                    value={form.warranty}
                    onChange={(e) => set("warranty", e.target.value)}
                    className="ui-input w-full"
                  />
                </Field>
              ) : null}

              <Field label="Notes / Supplier Remarks" className="sm:col-span-2 lg:col-span-3">
                <textarea
                  rows={2}
                  placeholder="Add any internal remarks or storage requirements"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  className="ui-textarea w-full"
                />
              </Field>
            </div>
          </Card>
          {activeTab !== "all" && (
            <div className="flex items-center justify-start pt-2">
              <button
                type="button"
                onClick={() => goToTab("inventory")}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
              >
                &larr; Back: Inventory Details
              </button>
            </div>
          )}
        </div>
      </form>

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 -mb-28 z-20 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-6 py-4 shadow-xl backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-w-7xl mx-auto">
          <CheckRow
            checked={form.is_active}
            onChange={(v) => set("is_active", v)}
            label="Item is Active for Transactions & BOM"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" to={backPath}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-item-form"
              variant="primary"
              loading={saving}
              disabled={saving}
              className="!bg-teal-700 hover:!bg-teal-800 !text-white font-bold px-6 shadow-sm"
            >
              <Save className="h-4 w-4" />
              {isFinishedGood ? "Save & Create Finished Good" : "Save & Create Raw Material"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
