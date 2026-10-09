import { useState } from "react";

import AdminModal from "../admin/AdminModal";
import Button from "../common/Button";
import { Input } from "../common/FormField";
import { createCustomer } from "../../api/salesApi";
import useTenantId from "../../hooks/useTenantId";
import { useToast } from "../../context/ToastContext";
import { apiErrorMessage } from "../../utils/apiError";

export default function QuickAddCustomerModal({ open, onClose, onSaved }) {
  const tenantId = useTenantId();
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setErrors({});
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose?.();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = "Company name is required";
    const emailVal = email.trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      nextErrors.email = "Enter a valid email address";
    }
    const phoneVal = phone.trim();
    if (phoneVal && !/^[\d\s+\-()]{6,20}$/.test(phoneVal)) {
      nextErrors.phone = "Enter a valid phone number";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      const res = await createCustomer({
        tenant_id: tenantId,
        name: name.trim(),
        contact_name: name.trim(),
        phone: phoneVal || null,
        email: emailVal || null,
        status: "active",
        credit_limit: 0,
      });
      const created = res?.data ?? res;
      addToast("Company added successfully.", "success");
      onSaved?.(created);
      reset();
      onClose?.();
    } catch (err) {
      addToast(apiErrorMessage(err, "Failed to add company."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal open={open} onClose={handleClose} title="Add Company" maxWidth="max-w-md">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Company Name *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="add" size="sm" loading={saving} disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
