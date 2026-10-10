import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";

import SearchableSelect from "../common/SearchableSelect";
import { getVendors } from "../../api/procurementApi";
import { inputClass } from "../../design-system/classes";
import { computeLandedCost } from "../../utils/materialPricingFormCalc";

const PRICING_EMPTY = {
  supplier_id: "",
  purchase_price: "",
  transport_cost: "",
  labour_cost: "",
  import_cost: "",
  minimum_price: "",
  maximum_price: "",
  selling_price: "",
  pricing_id: null,
};

/** Matches Add Product modal field labels (SoftLabel). */
const FIELD_LABEL_CLASS = "mb-1.5 block text-[12px] font-semibold text-[#6b6b76]";
const SECTION_TITLE_CLASS = "mb-2.5 text-[17px] font-semibold leading-6 text-[#1a1a1f]";

function PricingField({ label, className = "", children }) {
  return (
    <div className={className}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </div>
  );
}

export function buildVendorPricingFromItem(item) {
  if (!item) return { ...PRICING_EMPTY };
  const vp = item._pricingRecord || item.vendor_pricing?.[0];
  if (vp) {
    return {
      supplier_id: String(vp.supplier_id || ""),
      purchase_price: String(vp.purchase_price ?? ""),
      transport_cost: String(vp.transport_cost ?? ""),
      labour_cost: String(vp.labour_cost ?? ""),
      import_cost: String(vp.import_cost ?? ""),
      minimum_price: String(vp.minimum_price ?? ""),
      maximum_price: String(vp.maximum_price ?? ""),
      selling_price: String(vp.selling_price ?? ""),
      pricing_id: vp.id ?? null,
    };
  }
  return {
    ...PRICING_EMPTY,
    purchase_price: String(item.purchase_price ?? item.unit_cost ?? ""),
    selling_price: String(item.selling_price ?? item.unit_price ?? ""),
  };
}

export function vendorPricingPayloadFromForm(pricing) {
  if (!pricing?.supplier_id) return null;
  const toNum = (v) => {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    id: pricing.pricing_id || undefined,
    supplier_id: Number(pricing.supplier_id),
    purchase_price: toNum(pricing.purchase_price),
    transport_cost: toNum(pricing.transport_cost),
    labour_cost: toNum(pricing.labour_cost),
    import_cost: toNum(pricing.import_cost),
    minimum_price: toNum(pricing.minimum_price),
    maximum_price: toNum(pricing.maximum_price),
    selling_price: toNum(pricing.selling_price),
  };
}

export function validateVendorPricingForm(pricing) {
  if (!pricing?.supplier_id) return "";
  const toNum = (v) => Number(String(v ?? "").replace(/,/g, ""));
  const min = toNum(pricing.minimum_price);
  const max = toNum(pricing.maximum_price);
  const sell = toNum(pricing.selling_price);
  if (max > 0 && min > max) return "Minimum price cannot exceed maximum price.";
  if (max > 0 && sell < min) return "Company selling price must be at least the minimum price.";
  if (max > 0 && sell > max) return "Company selling price cannot exceed the maximum price.";
  return "";
}

export default function ProductVendorPricingFields({ pricing, onChange, disabled }) {
  const navigate = useNavigate();
  const [vendorOptions, setVendorOptions] = useState([]);

  useEffect(() => {
    getVendors()
      .then((res) => {
        const items = res.data?.items || res.data || [];
        const list = Array.isArray(items) ? items : [];
        setVendorOptions(
          list.map((v) => ({
            value: String(v.id),
            label: v.vendor_code ? `${v.name} (${v.vendor_code})` : v.name || `Vendor ${v.id}`,
          }))
        );
      })
      .catch(() => setVendorOptions([]));
  }, []);

  const landed = useMemo(
    () =>
      computeLandedCost({
        purchase_price: pricing.purchase_price,
        transport_cost: pricing.transport_cost,
        labour_cost: pricing.labour_cost,
        import_cost: pricing.import_cost,
      }),
    [pricing]
  );

  const set = (key, value) => onChange({ ...pricing, [key]: value });

  const currencyInputProps = {
    type: "number",
    min: "0",
    step: "any",
    disabled,
    className: inputClass,
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className={SECTION_TITLE_CLASS}>Cost &amp; Pricing</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <PricingField label="Vendor">
            <SearchableSelect
              value={pricing.supplier_id}
              onChange={(v) => {
                if (v === "__create_vendor") {
                  navigate("/procurement/vendors/create");
                } else {
                  set("supplier_id", v);
                }
              }}
              options={vendorOptions}
              footerOptions={[{ value: "__create_vendor", label: "+ Add Vendor" }]}
              onFooterPick={() => navigate("/procurement/vendors/create")}
              placeholder="Select vendor"
              disabled={disabled}
              emptyListMessage={
                <div className="flex flex-col items-center justify-center gap-2 py-1 text-center">
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    No vendors found. Add vendors under Purchases.
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate("/procurement/vendors/create");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Create Vendor
                  </button>
                </div>
              }
            />
          </PricingField>
          <div className="hidden sm:block" aria-hidden />
          <PricingField label="Purchase Price">
            <input
              {...currencyInputProps}
              value={pricing.purchase_price}
              onChange={(e) => set("purchase_price", e.target.value)}
              placeholder="₹"
            />
          </PricingField>
          <PricingField label="Transport Cost">
            <input
              {...currencyInputProps}
              value={pricing.transport_cost}
              onChange={(e) => set("transport_cost", e.target.value)}
              placeholder="₹"
            />
          </PricingField>
          <PricingField label="Labour Cost">
            <input
              {...currencyInputProps}
              value={pricing.labour_cost}
              onChange={(e) => set("labour_cost", e.target.value)}
              placeholder="₹"
            />
          </PricingField>
          <PricingField label="Import Cost">
            <input
              {...currencyInputProps}
              value={pricing.import_cost}
              onChange={(e) => set("import_cost", e.target.value)}
              placeholder="₹"
            />
          </PricingField>
        </div>
        <p className="mt-2.5 text-[14px] font-normal leading-5 text-[#6b6b76]">
          Total / Landed Cost:{" "}
          <span className="font-semibold tabular-nums text-[#1a1a1f]">
            ₹{landed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="ml-1 text-[12px] text-[#9a9aa5]">(auto calculated)</span>
        </p>
      </div>

      <div>
        <h3 className={SECTION_TITLE_CLASS}>Selling Price</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <PricingField label="Minimum Price">
            <input
              {...currencyInputProps}
              value={pricing.minimum_price}
              onChange={(e) => set("minimum_price", e.target.value)}
            />
          </PricingField>
          <PricingField label="Maximum Price">
            <input
              {...currencyInputProps}
              value={pricing.maximum_price}
              onChange={(e) => set("maximum_price", e.target.value)}
            />
          </PricingField>
          <PricingField label="Company Selling Price" className="sm:col-span-2">
            <input
              {...currencyInputProps}
              value={pricing.selling_price}
              onChange={(e) => set("selling_price", e.target.value)}
            />
          </PricingField>
        </div>
      </div>
    </div>
  );
}
