import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";

import AddCustomFieldModal from "./AddCustomFieldModal";
import Button from "../common/Button";
import { lookupIndianPincode } from "../../api/addressLookupApi";
import { getCompanySettings, updateCompanySettings } from "../../api/settingsApi";
import { INDIAN_STATES } from "../../data/customersMasterData";
import { useToast } from "../../context/ToastContext";

const PRIMARY = "var(--color-primary)";

import { inputClass } from "../../design-system/classes";

function SoftField({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[#8a8a95]">
        {label}
        {required ? <span className="text-[#e11d48]"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function settingsToForm(data) {
  const custom = Array.isArray(data?.custom_fields)
    ? data.custom_fields.map((f, i) => ({
        id: f.id || `cf-${i}`,
        label: f.label || "",
        value: f.value || "",
      }))
    : [];
  return {
    gstin: data?.gstin || "",
    company_name: data?.company_name || "",
    phone: data?.phone || "",
    pan: data?.pan || "",
    email: data?.email || "",
    address_line1: data?.address_line1 || "",
    pincode: data?.pincode || "",
    state: data?.state || "",
    city: data?.city || "",
    logo_url: data?.logo_url || "",
    custom_fields: custom,
  };
}

export default function EditCompanyDetailsModal({ open, onClose, onSaved }) {
  const { addToast } = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState(settingsToForm(null));
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customFieldOpen, setCustomFieldOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getCompanySettings()
      .then((res) => {
        if (cancelled) return;
        const data = res?.data;
        const next = settingsToForm(data);
        setForm(next);
        const opts = [];
        if (next.city) opts.push(next.city);
        setCities(opts);
      })
      .catch(() => {
        if (!cancelled) addToast("Failed to load company details", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, addToast]);

  useEffect(() => {
    if (!open) return;
    const pin = String(form.pincode || "").replace(/\D/g, "");
    if (pin.length !== 6) return;
    let cancelled = false;
    lookupIndianPincode(pin)
      .then((data) => {
        if (cancelled || !data) return;
        setForm((f) => ({
          ...f,
          city: data.city || data.district || f.city,
          state: data.state || f.state,
        }));
        const opts = [];
        if (data.city) opts.push(data.city);
        if (data.district && data.district !== data.city) opts.push(data.district);
        if (data.post_office) opts.push(data.post_office);
        setCities([...new Set(opts.filter(Boolean))]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.pincode, open]);

  if (!open) return null;

  const onLogoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      addToast("Please choose an image file", "error");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      addToast("Logo must be under 2 MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, logo_url: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!form.company_name.trim()) {
      addToast("Company Name is required", "error");
      return;
    }
    if (!form.state) {
      addToast("State is required", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        gstin: form.gstin.trim() || null,
        company_name: form.company_name.trim(),
        phone: form.phone.trim() || null,
        pan: form.pan.trim().toUpperCase() || null,
        email: form.email.trim() || null,
        address_line1: form.address_line1.trim() || null,
        pincode: form.pincode.trim() || null,
        state: form.state || null,
        city: form.city || null,
        logo_url: form.logo_url || null,
        custom_fields: form.custom_fields
          .filter((f) => f.label.trim() || f.value.trim())
          .map(({ label, value }) => ({
            label: label.trim(),
            value: value.trim(),
          })),
      };
      const res = await updateCompanySettings(payload);
      addToast("Company details updated");
      onSaved?.(res.data);
      onClose?.();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to update company", "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <form
        onSubmit={onSubmit}
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#ececf0] px-5 py-4">
          <h2 className="text-[17px] font-bold text-[#1a1a1f]">Edit Company Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[#9a9aa5] hover:bg-[#f5f5f7]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-10 text-center text-[13px] text-[#8a8a95]">Loading…</p>
          ) : (
            <>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="relative flex h-[88px] w-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-[#c8c8d0] bg-[#fafafa] text-[12px] font-medium text-[#8a8a95] hover:border-[#a0a0ab]"
                  aria-label={form.logo_url ? "Change company logo" : "Add company logo"}
                  title={form.logo_url ? "Change company logo" : "Add company logo"}
                >
                  {form.logo_url ? (
                    <img
                      src={form.logo_url}
                      alt="Company logo"
                      className="h-full w-full rounded-xl object-contain p-2"
                    />
                  ) : (
                    <>
                      <ImagePlus className="mb-1 h-6 w-6 text-[#9a9aa5]" />
                      Add Logo
                    </>
                  )}
                  {form.logo_url ? (
                    <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[#6b7280] shadow-sm">
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    </span>
                  ) : null}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onLogoPick}
                />
              </div>

              <SoftField label="GSTIN">
                <input
                  value={form.gstin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))
                  }
                  placeholder="Enter GSTIN"
                  className={inputClass}
                />
              </SoftField>

              <SoftField label="Company Name" required>
                <input
                  value={form.company_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, company_name: e.target.value }))
                  }
                  placeholder="Enter Company Name"
                  required
                  className={inputClass}
                />
              </SoftField>

              <div className="grid grid-cols-2 gap-3">
                <SoftField label="Mobile No.">
                  <input
                    value={form.phone}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                      }))
                    }
                    placeholder="Enter Mobile No."
                    className={inputClass}
                  />
                </SoftField>
                <SoftField label="PAN No.">
                  <input
                    value={form.pan}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        pan: e.target.value.toUpperCase().slice(0, 10),
                      }))
                    }
                    placeholder="Enter PAN No."
                    className={inputClass}
                  />
                </SoftField>
              </div>

              <SoftField label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Enter Email"
                  className={inputClass}
                />
              </SoftField>

              <SoftField label="Address">
                <input
                  value={form.address_line1}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, address_line1: e.target.value }))
                  }
                  placeholder="Enter Address"
                  className={inputClass}
                />
              </SoftField>

              <SoftField label="Pincode">
                <input
                  value={form.pincode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                    }))
                  }
                  placeholder="Enter valid Pincode"
                  className={inputClass}
                />
              </SoftField>

              <div className="grid grid-cols-2 gap-3">
                <SoftField label="State" required>
                  <select
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    required
                    className={inputClass}
                  >
                    <option value="">Select State</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </SoftField>
                <SoftField label="City">
                  <select
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select City</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    {form.city && !cities.includes(form.city) ? (
                      <option value={form.city}>{form.city}</option>
                    ) : null}
                  </select>
                </SoftField>
              </div>

              {form.custom_fields.map((field) => (
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
                      setForm((f) => ({
                        ...f,
                        custom_fields: f.custom_fields.filter((x) => x.id !== field.id),
                      }))
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
            </>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-[#ececf0] px-5 py-4">
          <Button type="button" variant="cancel" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={saving || loading}
            fullWidth
            onClick={(e) => {
              e.stopPropagation();
              onSubmit(e);
            }}
          >
            {saving ? "Saving…" : "Submit"}
          </Button>
        </div>
      </form>

      <AddCustomFieldModal
        open={customFieldOpen}
        onClose={() => setCustomFieldOpen(false)}
        existingFields={form.custom_fields}
        onSave={(field) =>
          setForm((f) => ({
            ...f,
            custom_fields: [...f.custom_fields, field],
          }))
        }
      />
    </div>,
    document.body
  );
}
