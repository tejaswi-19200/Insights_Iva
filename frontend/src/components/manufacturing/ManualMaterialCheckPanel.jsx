import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";

import Button from "../common/Button";
import CommonStatusBadge from "../common/StatusBadge";
import { LoadingState } from "../common/states";
import { getManualMaterialCheck, submitManualMaterialCheck } from "../../api/workflowApi";
import ConcurrencyConflictBanner from "../common/ConcurrencyConflictBanner";
import { apiErrorMessage, conflictErrorMessage, isConflictError } from "../../utils/apiError";
import { useToast } from "../../context/ToastContext";

function lineStatusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return "success";
  if (s === "partially_available" || s === "partial") return "warning";
  if (s === "not_available" || s === "shortage") return "danger";
  return "neutral";
}

function lineStatusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return "Available";
  if (s === "partially_available" || s === "partial") return "Partially Available";
  if (s === "not_available" || s === "shortage") return "Not Available";
  return "Pending";
}

function overallPreview(lines) {
  if (!lines.length) return { tone: "neutral", label: "No materials", icon: AlertTriangle };
  const allOk = lines.every((ln) => Number(ln.shortage_qty || 0) <= 0);
  const anyStock = lines.some((ln) => Number(ln.available_qty || 0) > 0);
  const anyShort = lines.some((ln) => Number(ln.shortage_qty || 0) > 0);
  if (allOk) return { tone: "success", label: "All materials available", icon: CheckCircle2 };
  if (anyStock && anyShort) {
    return { tone: "warning", label: "Partially available", icon: AlertTriangle };
  }
  return { tone: "danger", label: "Materials not available", icon: XCircle };
}

export default function ManualMaterialCheckPanel({
  jobCardId,
  card,
  onUpdated,
  readOnly = false,
}) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState([]);
  const [materialsAvailable, setMaterialsAvailable] = useState(null);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [savedCheck, setSavedCheck] = useState(null);
  const [apiReadOnly, setApiReadOnly] = useState(false);
  const [conflictMessage, setConflictMessage] = useState("");

  const savedFromCard = card?.material_check;
  const isCompleted = Boolean(savedFromCard?.checked_at || savedCheck?.checked_at);

  const load = useCallback(async () => {
    if (!jobCardId) return;
    setLoading(true);
    setError("");
    try {
      const res = await getManualMaterialCheck(jobCardId);
      const data = res?.data ?? res;
      setLines(Array.isArray(data?.lines) ? data.lines : []);
      setApiReadOnly(Boolean(data?.read_only));
      const saved = data?.saved_check || null;
      setSavedCheck(saved);
      if (saved) {
        setMaterialsAvailable(saved.overall_available === true);
        setReason(saved.reason || "");
        setRemarks(saved.remarks || "");
      } else {
        setMaterialsAvailable(data?.all_available ? true : null);
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load material availability."));
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [jobCardId]);

  useEffect(() => {
    load();
  }, [load]);

  const preview = useMemo(() => overallPreview(lines), [lines]);
  const allAvailablePreview = preview.tone === "success";
  const needsReason =
    !isCompleted &&
    (materialsAvailable === false || (materialsAvailable !== true && !allAvailablePreview && lines.length > 0));

  const handleSave = async () => {
    if (!jobCardId || saving || readOnly || apiReadOnly || isCompleted) return;
    if (needsReason && !reason.trim()) {
      addToast("Please provide the reason for material unavailability.", "error");
      return;
    }

    let finalMaterialsAvailable = materialsAvailable;
    if (allAvailablePreview) {
      finalMaterialsAvailable = true;
    } else if (materialsAvailable === true) {
      addToast(
        "Cannot confirm all materials available while shortages exist. Please set Available Qty equal to Required Qty for all lines, or select Materials Not Available.",
        "error"
      );
      return;
    }

    setSaving(true);
    setConflictMessage("");
    try {
      await submitManualMaterialCheck(jobCardId, {
        materials_available: finalMaterialsAvailable,
        reason: reason.trim() || null,
        remarks: remarks.trim() || null,
        lines: lines.map((ln, idx) => ({
          line_id: ln.line_id || `bom-${idx + 1}`,
          material_code: ln.material_code || "",
          available_qty: ln.available_qty === "" || ln.available_qty == null ? 0 : Number(ln.available_qty),
          remarks: ln.remarks || null,
        })),
      });
      const hasShortage = lines.some((line) => Number(line.shortage_qty || 0) > 0);
      if (hasShortage) {
        addToast("Material check saved. Opening Purchase Requisitions for shortage follow-up.", "success");
        onUpdated?.();
        navigate("/procurement/material-requests");
        return;
      }

      addToast("Material check saved. All required materials are available.", "success");
      await load();
      onUpdated?.();
    } catch (err) {
      if (isConflictError(err)) {
        setConflictMessage(
          conflictErrorMessage(err, "Job card material check was updated by another user."),
        );
      }
      addToast(apiErrorMessage(err, "Could not save material check."), "error");
    } finally {
      setSaving(false);
    }
  };

  const displayCheck = savedCheck || (isCompleted ? savedFromCard : null);
  const PreviewIcon = preview.icon;
  return (
    <section className="store-manual-jc-actions__materials" id="manual-material-check-panel">
      <div className="store-manual-jc-actions__materials-header">
        <h3 className="store-manual-jc-actions__subtitle">
          <ClipboardCheck className="inline h-4 w-4 mr-1.5" aria-hidden />
          Material Availability Check
        </h3>
        {displayCheck ? (
          <CommonStatusBadge tone={lineStatusTone(displayCheck.status)}>
            {displayCheck.status === "available"
              ? "Materials Confirmed"
              : displayCheck.status === "partial"
                ? "Partially Available"
                : "Material Shortage"}
          </CommonStatusBadge>
        ) : (
          <CommonStatusBadge tone={preview.tone}>
            <PreviewIcon className="inline h-3 w-3 mr-1" aria-hidden />
            {preview.label}
          </CommonStatusBadge>
        )}
      </div>

      {loading ? <LoadingState label="Loading inventory…" compact className="py-6" /> : null}
      {error ? <p className="store-manual-jc-actions__hint text-[var(--color-danger)]">{error}</p> : null}
      {conflictMessage ? (
        <ConcurrencyConflictBanner message={conflictMessage} onRefresh={load} className="mb-3" />
      ) : null}

      {!loading && !error && lines.length === 0 ? (
        <p className="store-manual-jc-actions__hint">
          No materials could be resolved. Link products to inventory or BOM to run a material check.
        </p>
      ) : null}

      {!loading && lines.length > 0 ? (
        <div className="ui-table-wrap">
          <table className="ui-table ui-table--compact">
            <thead>
              <tr>
                <th>Material Code</th>
                <th>Material Name</th>
                <th className="text-right">Required Qty</th>
                <th>UOM</th>
                <th className="text-right">Available Qty</th>
                <th className="text-right">Shortage Qty</th>
                <th>Availability Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.line_id}>
                  <td>{ln.material_code || "—"}</td>
                  <td>{ln.material_name || "—"}</td>
                  <td className="text-right tabular-nums">{Number(ln.required_qty || 0).toLocaleString("en-IN")}</td>
                  <td>{ln.uom || "—"}</td>
                  <td className="text-right tabular-nums">
                    {isCompleted || readOnly || apiReadOnly ? (
                      Number(ln.available_qty || 0).toLocaleString("en-IN")
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="ui-input ui-input--sm w-24 text-right"
                        value={ln.available_qty ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          const valStr = e.target.value;
                          const avail = valStr === "" ? "" : Math.max(0, Number(valStr) || 0);
                          const req = Number(ln.required_qty || 0);
                          const availNum = Number(avail || 0);
                          const shortage = Math.max(0, req - availNum);
                          let status = "not_available";
                          if (shortage <= 0) status = "available";
                          else if (availNum > 0) status = "partially_available";

                          setLines((rows) =>
                            rows.map((r) =>
                              r.line_id === ln.line_id
                                ? {
                                    ...r,
                                    available_qty: avail,
                                    shortage_qty: shortage,
                                    availability_status: status,
                                  }
                                : r
                            )
                          );
                        }}
                      />
                    )}
                  </td>
                  <td className="text-right tabular-nums text-[var(--color-danger)]">
                    {Number(ln.shortage_qty || 0) > 0
                      ? Number(ln.shortage_qty).toLocaleString("en-IN")
                      : "0"}
                  </td>
                  <td>
                    <CommonStatusBadge tone={lineStatusTone(ln.availability_status)}>
                      {lineStatusLabel(ln.availability_status)}
                    </CommonStatusBadge>
                  </td>
                  <td>
                    {isCompleted || readOnly || apiReadOnly ? (
                      ln.remarks || "—"
                    ) : (
                      <input
                        className="ui-input ui-input--sm"
                        value={ln.remarks || ""}
                        placeholder="Optional"
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((rows) =>
                            rows.map((r) => (r.line_id === ln.line_id ? { ...r, remarks: val } : r))
                          );
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !isCompleted && !readOnly && !apiReadOnly && lines.length > 0 ? (
        <div className="store-manual-jc-actions__material-form">
          <label className="store-manual-jc-actions__checkbox">
            <input
              type="checkbox"
              checked={materialsAvailable === true}
              onChange={(e) => {
                setMaterialsAvailable(e.target.checked ? true : null);
                if (e.target.checked) setReason("");
              }}
            />
            <span>Materials Available</span>
          </label>
          <label className="store-manual-jc-actions__checkbox">
            <input
              type="checkbox"
              checked={materialsAvailable === false}
              onChange={(e) => setMaterialsAvailable(e.target.checked ? false : null)}
            />
            <span>Materials Not Available</span>
          </label>

          {materialsAvailable === true && preview.tone === "success" ? (
            <p className="store-manual-jc-actions__confirm-msg">
              <CheckCircle2 className="inline h-4 w-4 text-[var(--color-success)]" aria-hidden />
              Material availability confirmed.
            </p>
          ) : null}

          {needsReason ? (
            <label className="ui-field">
              <span className="ui-field__label">Reason *</span>
              <textarea
                className="ui-input"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe material shortage…"
                required
              />
            </label>
          ) : null}

          <label className="ui-field">
            <span className="ui-field__label">Comments</span>
            <textarea
              className="ui-input"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional store comments…"
            />
          </label>

          <div className="store-manual-jc-actions__toolbar">
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              {saving ? "Saving Material Check…" : "Save Material Check"}
            </Button>
          </div>
          <p className="store-manual-jc-actions__hint" role="note">
            <strong>Save</strong> records the availability result. If there is a shortage, it opens Purchase
            Requisitions for follow-up; fully available materials remain in the job card workflow.
          </p>
        </div>
      ) : null}

      {displayCheck ? (
        <div className="store-manual-jc-actions__saved-meta">
          <p>
            Checked by <strong>{displayCheck.checked_by || "—"}</strong>
            {displayCheck.checked_at ? ` · ${new Date(displayCheck.checked_at).toLocaleString()}` : ""}
          </p>
          {displayCheck.reason ? <p><strong>Reason:</strong> {displayCheck.reason}</p> : null}
          {displayCheck.remarks ? <p><strong>Comments:</strong> {displayCheck.remarks}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
