import { Plus, Trash2 } from "lucide-react";

import Button from "../common/Button";
import { Input, Select, Textarea } from "../common/FormField";
import { DatePicker } from "../../design-system/dateControls";
import { fmtDeliveryDisplay } from "./jobCardUiShared";
import {
  emptyRawMaterialRow,
  sectionCanEdit,
} from "../../utils/jobCardProductionDetails";

function Section({ title, children }) {
  return (
    <section className="job-card-page__section">
      <h2 className="ui-section-title !rounded-none">{title}</h2>
      <div className="job-card-page__section-body">{children}</div>
    </section>
  );
}

function FieldGrid({ children }) {
  return <div className="job-card-page__grid">{children}</div>;
}

function ReadOnlyField({ label, value, className = "" }) {
  const display = value == null || value === "" ? "—" : String(value);
  return (
    <div className={`job-card-page__field ${className}`.trim()}>
      <Input label={label} value={display} disabled readOnly className="w-full" />
    </div>
  );
}

const LOCAL_OPTIONS = [
  { value: "", label: "—" },
  { value: "local", label: "Local" },
  { value: "non-local", label: "Non-Local" },
];

const PROCESS_OPTIONS = [
  "",
  "Slitting",
  "Printing",
  "Coating",
  "Lamination",
  "Cutting",
  "Rewinding",
  "Packing",
  "Other",
];

export default function ProductionJobCardSections({
  details,
  errors = {},
  editableSections = [],
  readOnly = false,
  machines = [],
  operators = [],
  uom = "Nos",
  audit = null,
  onPatchDetails,
  onPatchRawMaterial,
  onAddRawMaterial,
  onRemoveRawMaterial,
  form = {},
  jobCardNo,
}) {
  const jobInfo = details?.job_info || {};
  const production = details?.production || {};
  const output = details?.output || {};
  const approval = details?.approval || {};
  const rawMaterials = details?.raw_materials || [];

  const canJobInfo = !readOnly && sectionCanEdit(editableSections, "sales");
  const canMaterials = !readOnly && sectionCanEdit(editableSections, "inventory");
  const canProduction =
    !readOnly && (sectionCanEdit(editableSections, "production") || sectionCanEdit(editableSections, "operator"));
  const canOutput =
    !readOnly && (sectionCanEdit(editableSections, "quality") || sectionCanEdit(editableSections, "operator"));
  const canApproval = !readOnly && sectionCanEdit(editableSections, "sales");

  const patchJobInfo = (key, value) => onPatchDetails?.("job_info", { ...jobInfo, [key]: value });
  const patchProduction = (key, value) => onPatchDetails?.("production", { ...production, [key]: value });
  const patchOutput = (key, value) => onPatchDetails?.("output", { ...output, [key]: value });
  const patchApproval = (key, value) => onPatchDetails?.("approval", { ...approval, [key]: value });

  const showSlitting = String(production.process || "").toLowerCase().includes("slitting");

  return (
    <div className="job-card-page__form">
      <Section title="Job Card Information">
        <FieldGrid>
          <ReadOnlyField label="Job Card No." value={jobCardNo || form?.job_card_no} />
          <ReadOnlyField label="Job Card Date" value={fmtDeliveryDisplay(form?.job_card_date)} />
          <ReadOnlyField label="Sales Order No." value={form?.sales_order_no} />
          <ReadOnlyField label="Customer Name" value={form?.customer_name} />
          <ReadOnlyField label="Product Code" value={form?.product_code} />
          <ReadOnlyField label="Product Name" value={form?.product_name} />
          {canJobInfo ? (
            <div className="job-card-page__field">
              <Input
                label="Location"
                value={jobInfo.location || ""}
                onChange={(e) => patchJobInfo("location", e.target.value)}
                error={errors["details.job_info.location"]}
                className="w-full"
              />
            </div>
          ) : (
            <ReadOnlyField label="Location" value={jobInfo.location} />
          )}
          <ReadOnlyField label="Priority" value={form?.priority} />
          <ReadOnlyField label="Status" value={form?.workflow_status || form?.status} />
          {canJobInfo ? (
            <>
              <div className="job-card-page__field">
                <DatePicker
                  label="Issue Date"
                  value={jobInfo.issue_date || ""}
                  onChange={(v) => patchJobInfo("issue_date", v)}
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Issue Time"
                  type="time"
                  value={jobInfo.issue_time || ""}
                  onChange={(e) => patchJobInfo("issue_time", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <DatePicker label="PO Date" value={jobInfo.po_date || ""} onChange={(v) => patchJobInfo("po_date", v)} />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="PO Time"
                  type="time"
                  value={jobInfo.po_time || ""}
                  onChange={(e) => patchJobInfo("po_time", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Select
                  label="Local / Non-Local"
                  value={jobInfo.local_type || ""}
                  onChange={(e) => patchJobInfo("local_type", e.target.value)}
                  error={errors["details.job_info.local_type"]}
                  className="w-full"
                >
                  {LOCAL_OPTIONS.map((o) => (
                    <option key={o.value || "blank"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          ) : (
            <>
              <ReadOnlyField label="Issue Date" value={fmtDeliveryDisplay(jobInfo.issue_date)} />
              <ReadOnlyField label="Issue Time" value={jobInfo.issue_time} />
              <ReadOnlyField label="PO Date" value={fmtDeliveryDisplay(jobInfo.po_date)} />
              <ReadOnlyField label="PO Time" value={jobInfo.po_time} />
              <ReadOnlyField label="Local / Non-Local" value={jobInfo.local_type} />
            </>
          )}
        </FieldGrid>
      </Section>

      <Section title="Raw Material Details">
        {rawMaterials.length === 0 && readOnly ? (
          <p className="text-sm text-[var(--color-text-muted)]">No raw materials recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ui-table w-full min-w-[2078px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-16" />
                <col className="w-[300px]" />
                <col className="w-[180px]" />
                <col className="w-[200px]" />
                <col className="w-[110px]" />
                <col className="w-[200px]" />
                <col className="w-[140px]" />
                <col className="w-[110px]" />
                <col className="w-[240px]" />
                <col className="w-[180px]" />
                <col className="w-[300px]" />
                {canMaterials ? <col className="w-11" /> : null}
              </colgroup>
              <thead className="ui-table-head">
                <tr>
                  <th className="px-2 py-2">Sl. No.</th>
                  <th className="px-2 py-2">Material Name</th>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Paper / Type</th>
                  <th className="px-2 py-2">GSM</th>
                  <th className="px-2 py-2">Mill Grade</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2">UOM</th>
                  <th className="px-2 py-2">Batch / Lot</th>
                  <th className="px-2 py-2">Quality</th>
                  <th className="px-2 py-2">Remarks</th>
                  {canMaterials ? <th className="px-2 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {rawMaterials.map((row, idx) => (
                  <tr key={idx} className="border-t border-[var(--color-border-muted)]">
                    <td className="px-2 py-1.5 tabular-nums">{row.sl_no ?? idx + 1}</td>
                    {canMaterials ? (
                      <>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.material_name || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { material_name: e.target.value })}
                            error={errors[`details.raw_materials.${idx}.material_name`]}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.material_code || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { material_code: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.paper_type || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { paper_type: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.gsm || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { gsm: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.mill_grade || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { mill_grade: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={row.quantity ?? ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { quantity: e.target.value })}
                            error={errors[`details.raw_materials.${idx}.quantity`]}
                            className="w-full min-w-0 text-right"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.uom || "Nos"}
                            onChange={(e) => onPatchRawMaterial?.(idx, { uom: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.batch_lot_no || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { batch_lot_no: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.quality || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { quality: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={row.remarks || ""}
                            onChange={(e) => onPatchRawMaterial?.(idx, { remarks: e.target.value })}
                            className="w-full min-w-0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            className="text-[var(--color-danger)]"
                            onClick={() => onRemoveRawMaterial?.(idx)}
                            aria-label="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5">{row.material_name || "—"}</td>
                        <td className="px-2 py-1.5">{row.material_code || "—"}</td>
                        <td className="px-2 py-1.5">{row.paper_type || "—"}</td>
                        <td className="px-2 py-1.5">{row.gsm || "—"}</td>
                        <td className="px-2 py-1.5">{row.mill_grade || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.uom || "—"}</td>
                        <td className="px-2 py-1.5">{row.batch_lot_no || "—"}</td>
                        <td className="px-2 py-1.5">{row.quality || "—"}</td>
                        <td className="px-2 py-1.5">{row.remarks || "—"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canMaterials ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddRawMaterial}
              leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            >
              Add Material Row
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="Production / Process Details">
        <FieldGrid>
          {canProduction ? (
            <>
              <div className="job-card-page__field">
                <Select
                  label="Process"
                  required
                  value={production.process || ""}
                  onChange={(e) => patchProduction("process", e.target.value)}
                  error={errors["details.production.process"]}
                  className="w-full"
                >
                  <option value="">Please Select</option>
                  {PROCESS_OPTIONS.filter(Boolean).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div className="job-card-page__field">
                <Select
                  label="Machine"
                  value={production.machine_id || ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    const m = machines.find((x) => String(x.id) === String(id));
                    patchProduction("machine_id", id || "");
                    patchProduction("machine_name", m?.name || m?.machine_name || "");
                  }}
                  error={errors["details.production.machine_name"]}
                  className="w-full"
                >
                  <option value="">Please Select</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.machine_name || m.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="job-card-page__field">
                <Select
                  label="Operator"
                  value={production.operator_id || ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    const op = operators.find((x) => String(x.id) === String(id));
                    patchProduction("operator_id", id || "");
                    patchProduction("operator_name", op?.full_name || op?.name || "");
                  }}
                  className="w-full"
                >
                  <option value="">Please Select</option>
                  {operators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.full_name || op.name || op.email}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Planned Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={production.planned_quantity ?? ""}
                  onChange={(e) => patchProduction("planned_quantity", e.target.value)}
                  error={errors["details.production.planned_quantity"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="UOM"
                  value={production.uom || uom}
                  onChange={(e) => patchProduction("uom", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <DatePicker
                  label="Start Date"
                  value={production.start_date || ""}
                  onChange={(v) => patchProduction("start_date", v)}
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Start Time"
                  type="time"
                  value={production.start_time || ""}
                  onChange={(e) => patchProduction("start_time", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <DatePicker
                  label="Due Date"
                  value={production.due_date || ""}
                  onChange={(v) => patchProduction("due_date", v)}
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Due Time"
                  type="time"
                  value={production.due_time || ""}
                  onChange={(e) => patchProduction("due_time", e.target.value)}
                  className="w-full"
                />
              </div>
              {showSlitting ? (
                <div className="job-card-page__field job-card-page__field--span-full">
                  <Textarea
                    label="Slitting Size"
                    required
                    rows={2}
                    value={production.slitting_size || ""}
                    onChange={(e) => patchProduction("slitting_size", e.target.value)}
                    error={errors["details.production.slitting_size"]}
                    placeholder="e.g. 158 X 1 + 127 X 1 + …"
                    className="w-full"
                  />
                </div>
              ) : null}
              <div className="job-card-page__field job-card-page__field--span-full">
                <Textarea
                  label="Production Instructions"
                  rows={3}
                  value={production.production_instructions || ""}
                  onChange={(e) => patchProduction("production_instructions", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field job-card-page__field--span-full">
                <Textarea
                  label="Remarks"
                  rows={2}
                  value={production.remarks || ""}
                  onChange={(e) => patchProduction("remarks", e.target.value)}
                  className="w-full"
                />
              </div>
            </>
          ) : (
            <>
              <ReadOnlyField label="Process" value={production.process} />
              <ReadOnlyField label="Machine" value={production.machine_name} />
              <ReadOnlyField label="Operator" value={production.operator_name} />
              <ReadOnlyField label="Planned Quantity" value={production.planned_quantity != null ? `${production.planned_quantity} ${production.uom || uom}` : ""} />
              <ReadOnlyField label="Start Date" value={fmtDeliveryDisplay(production.start_date)} />
              <ReadOnlyField label="Start Time" value={production.start_time} />
              <ReadOnlyField label="Due Date" value={fmtDeliveryDisplay(production.due_date)} />
              <ReadOnlyField label="Due Time" value={production.due_time} />
              {showSlitting ? (
                <ReadOnlyField label="Slitting Size" value={production.slitting_size} className="job-card-page__field--span-full" />
              ) : null}
              <ReadOnlyField label="Production Instructions" value={production.production_instructions} className="job-card-page__field--span-full" />
              <ReadOnlyField label="Remarks" value={production.remarks} className="job-card-page__field--span-full" />
            </>
          )}
        </FieldGrid>
      </Section>

      <Section title="Output Details">
        <FieldGrid>
          {canOutput ? (
            <>
              <div className="job-card-page__field">
                <Input
                  label="Output Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={output.output_quantity ?? ""}
                  onChange={(e) => patchOutput("output_quantity", e.target.value)}
                  error={errors["details.output.output_quantity"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Output UOM"
                  value={output.output_uom || uom}
                  onChange={(e) => patchOutput("output_uom", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Width"
                  value={output.width || ""}
                  onChange={(e) => patchOutput("width", e.target.value)}
                  error={errors["details.output.width"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="GSM"
                  value={output.gsm || ""}
                  onChange={(e) => patchOutput("gsm", e.target.value)}
                  error={errors["details.output.gsm"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Colour"
                  value={output.colour || ""}
                  onChange={(e) => patchOutput("colour", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="CRA %"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={output.cra_percent ?? ""}
                  onChange={(e) => patchOutput("cra_percent", e.target.value)}
                  error={errors["details.output.cra_percent"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Good Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={output.good_quantity ?? ""}
                  onChange={(e) => patchOutput("good_quantity", e.target.value)}
                  error={errors["details.output.good_quantity"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Rejected Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={output.rejected_quantity ?? ""}
                  onChange={(e) => patchOutput("rejected_quantity", e.target.value)}
                  error={errors["details.output.rejected_quantity"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Wastage Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={output.wastage_quantity ?? ""}
                  onChange={(e) => patchOutput("wastage_quantity", e.target.value)}
                  error={errors["details.output.wastage_quantity"]}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field">
                <Input
                  label="Batch / Lot No."
                  value={output.batch_lot_no || ""}
                  onChange={(e) => patchOutput("batch_lot_no", e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="job-card-page__field job-card-page__field--span-full">
                <Textarea
                  label="Output Remarks"
                  rows={2}
                  value={output.remarks || ""}
                  onChange={(e) => patchOutput("remarks", e.target.value)}
                  className="w-full"
                />
              </div>
            </>
          ) : (
            <>
              <ReadOnlyField label="Output Quantity" value={output.output_quantity != null ? `${output.output_quantity} ${output.output_uom || uom}` : ""} />
              <ReadOnlyField label="Width" value={output.width} />
              <ReadOnlyField label="GSM" value={output.gsm} />
              <ReadOnlyField label="Colour" value={output.colour} />
              <ReadOnlyField label="CRA %" value={output.cra_percent} />
              <ReadOnlyField label="Good Quantity" value={output.good_quantity} />
              <ReadOnlyField label="Rejected Quantity" value={output.rejected_quantity} />
              <ReadOnlyField label="Wastage Quantity" value={output.wastage_quantity} />
              <ReadOnlyField label="Batch / Lot No." value={output.batch_lot_no} />
              <ReadOnlyField label="Output Remarks" value={output.remarks} className="job-card-page__field--span-full" />
            </>
          )}
        </FieldGrid>
      </Section>

      <Section title="Approval / Verification">
        <FieldGrid>
          <ReadOnlyField label="Prepared By" value={approval.prepared_by} />
          <ReadOnlyField label="Prepared Date" value={fmtDeliveryDisplay(approval.prepared_date)} />
          <ReadOnlyField label="Checked By" value={approval.checked_by} />
          <ReadOnlyField label="Checked Date" value={fmtDeliveryDisplay(approval.checked_date)} />
          <ReadOnlyField label="Approved By" value={approval.approved_by} />
          <ReadOnlyField label="Approved Date" value={fmtDeliveryDisplay(approval.approved_date)} />
          {canApproval ? (
            <div className="job-card-page__field job-card-page__field--span-full">
              <Textarea
                label="Approval Remarks"
                rows={2}
                value={approval.remarks || ""}
                onChange={(e) => patchApproval("remarks", e.target.value)}
                className="w-full"
              />
            </div>
          ) : (
            <ReadOnlyField label="Approval Remarks" value={approval.remarks} className="job-card-page__field--span-full" />
          )}
        </FieldGrid>
      </Section>

      {audit ? (
        <Section title="Audit Information">
          <FieldGrid>
            <ReadOnlyField label="Created By" value={audit.created_by} />
            <ReadOnlyField label="Created At" value={audit.created_at ? new Date(audit.created_at).toLocaleString("en-IN") : ""} />
            <ReadOnlyField label="Last Updated" value={audit.updated_at ? new Date(audit.updated_at).toLocaleString("en-IN") : ""} />
          </FieldGrid>
        </Section>
      ) : null}
    </div>
  );
}
