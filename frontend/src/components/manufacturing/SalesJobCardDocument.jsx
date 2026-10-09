import { useMemo } from "react";

import { Input, Select, Textarea } from "../common/FormField";
import { DatePicker } from "../../design-system/dateControls";
import { fmtDeliveryDisplay, NOTES_MAX } from "./jobCardUiShared";
import { formatInr } from "../../data/salesMasterData";
import { computeLineTotals } from "../../utils/jobCardLineTotals";
import {
  buildSalesJobCardDocument,
  formatCompanyAddress,
  fmtDate,
  resolveCompanyLogoUrl,
  resolveCompanyTagline,
} from "../../utils/salesJobCardDocument";
import "../../styles/sales-job-card-document.css";

function display(value) {
  if (value == null || value === "") return "—";
  return String(value);
}

function signCell(value) {
  if (value == null || value === "" || value === "—") return "";
  return String(value);
}

function FieldRow({ label, value }) {
  return (
    <div className="sjc-doc__field-row">
      <span className="sjc-doc__field-label">{label}</span>
      <span className="sjc-doc__field-value">{display(value)}</span>
    </div>
  );
}

function SectionPanel({ title, children }) {
  return (
    <div className="sjc-doc__panel">
      <div className="sjc-doc__panel-title">{title}</div>
      <div className="sjc-doc__panel-body">{children}</div>
    </div>
  );
}

const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function SalesJobCardDocument({
  card,
  form,
  salesOrder,
  customer,
  productLines,
  products,
  customers,
  details,
  companyProfile,
  errors = {},
  editable = false,
  onPatchField,
}) {
  const doc = useMemo(
    () =>
      buildSalesJobCardDocument({
        card,
        form,
        salesOrder,
        customer,
        productLines,
        products,
        details,
      }),
    [card, form, salesOrder, customer, productLines, products, details]
  );

  const companyName =
    companyProfile?.company_name || companyProfile?.legal_name || companyProfile?.name || "";
  const companyAddress = formatCompanyAddress(companyProfile);
  const logoUrl = resolveCompanyLogoUrl(companyProfile);
  const tagline = resolveCompanyTagline(companyProfile);

  const cust = doc.customer_details || {};
  const order = doc.order_details || {};
  const lines = doc.product_lines || [];
  const specs = doc.technical_specifications || [];
  const approval = doc.approval || {};
  const showPricing = lines.some(
    (row) => row?.unit_price != null || row?.line_amount != null || row?.total_amount != null
  );
  const lineTotals = useMemo(
    () => (showPricing ? computeLineTotals(lines) : null),
    [lines, showPricing]
  );

  const selectedCustomer = customers?.find((c) => String(c.id) === String(form?.customer_id));

  return (
    <div
      className={`sjc-doc sjc-doc--screen${editable ? "" : " sjc-doc--display"}`}
      id="sales-job-card-document"
    >
      <div className="sjc-doc__paper">
        <div className="sjc-doc__header-row sjc-doc__header-row--sales">
          <div className="sjc-doc__company">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="sjc-doc__logo" />
            ) : (
              <div className="sjc-doc__logo-placeholder">LOGO</div>
            )}
            <div>
              <div className="sjc-doc__company-name">{companyName || "Company Name"}</div>
              {companyAddress ? <div className="sjc-doc__company-address">{companyAddress}</div> : null}
            </div>
          </div>
          {tagline ? <p className="sjc-doc__tagline">{tagline}</p> : null}
        </div>

        <div className="sjc-doc__title-band">SALES JOB CARD</div>

        <div className="sjc-doc__columns">
          <SectionPanel title="Customer Details">
            {editable ? (
              <>
                <div className="sjc-doc__field-row">
                  <span className="sjc-doc__field-label">Customer Name *</span>
                  <span>
                    <Select
                      value={form?.customer_id ?? ""}
                      onChange={(e) => onPatchField?.("customer_id", e.target.value)}
                      className="sjc-doc__input"
                      error={errors.customer_id}
                    >
                      <option value="">Select customer</option>
                      {(customers || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.company_name}
                        </option>
                      ))}
                    </Select>
                  </span>
                </div>
                <FieldRow label="Contact Person" value={selectedCustomer?.contact_name || cust.contact_person} />
                <FieldRow label="Phone" value={selectedCustomer?.phone || cust.phone} />
                <FieldRow label="Email" value={selectedCustomer?.email || cust.email} />
                <FieldRow
                  label="Billing Address"
                  value={formatCompanyAddress(selectedCustomer) || cust.billing_address}
                />
              </>
            ) : (
              <>
                <FieldRow label="Customer Name" value={cust.customer_name} />
                <FieldRow label="Contact Person" value={cust.contact_person} />
                <FieldRow label="Phone" value={cust.phone} />
                <FieldRow label="Email" value={cust.email} />
                <FieldRow label="Billing Address" value={cust.billing_address} />
              </>
            )}
          </SectionPanel>

          <SectionPanel title="Order Details">
            {editable ? (
              <>
                <FieldRow label="Sales Order Date" value={fmtDate(order.sales_order_date)} />
                <div className="sjc-doc__field-row">
                  <span className="sjc-doc__field-label">Delivery Date *</span>
                  <span>
                    <DatePicker
                      value={form?.required_delivery_date ? String(form.required_delivery_date).slice(0, 10) : ""}
                      onChange={(v) => onPatchField?.("required_delivery_date", v)}
                      error={errors.required_delivery_date}
                    />
                  </span>
                </div>
                <FieldRow label="Product Category" value={order.product_category} />
                <FieldRow label="Payment Terms" value={order.payment_terms} />
                <div className="sjc-doc__field-row">
                  <span className="sjc-doc__field-label">Priority *</span>
                  <span>
                    <Select
                      value={form?.priority || "medium"}
                      onChange={(e) => onPatchField?.("priority", e.target.value)}
                      className="sjc-doc__input"
                      error={errors.priority}
                    >
                      {PRIORITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </span>
                </div>
                <div className="sjc-doc__field-row">
                  <span className="sjc-doc__field-label">Remarks</span>
                  <span>
                    <Textarea
                      rows={2}
                      maxLength={NOTES_MAX}
                      value={form?.notes || ""}
                      onChange={(e) => onPatchField?.("notes", e.target.value)}
                      className="sjc-doc__input"
                    />
                  </span>
                </div>
              </>
            ) : (
              <>
                <FieldRow label="Sales Order Date" value={fmtDate(order.sales_order_date)} />
                <FieldRow label="Delivery Date" value={fmtDeliveryDisplay(order.delivery_date)} />
                <FieldRow label="Product Category" value={order.product_category} />
                <FieldRow label="Payment Terms" value={order.payment_terms} />
                {order.payment_terms_description ? (
                  <FieldRow label="Payment Terms Description" value={order.payment_terms_description} />
                ) : null}
                <FieldRow
                  label="Priority"
                  value={order.priority ? String(order.priority).replace(/^./, (c) => c.toUpperCase()) : ""}
                />
                <FieldRow label="Remarks" value={order.remarks} />
              </>
            )}
          </SectionPanel>
        </div>

        <div className="sjc-doc__table-wrap">
          <div className="sjc-doc__table-caption">Product / Job Details</div>
          <table className="sjc-doc__table">
            <thead>
              <tr>
                <th>Sl. No.</th>
                {showPricing ? <th>Product</th> : <th>Product Code</th>}
                {!showPricing ? <th>Product Name</th> : null}
                {!showPricing ? <th>Description</th> : null}
                <th className="num">Quantity</th>
                <th>UOM</th>
                {showPricing ? (
                  <>
                    <th className="num">Price</th>
                    <th className="num">Amount</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={showPricing ? 7 : 6} style={{ textAlign: "center", color: "#6b7280" }}>
                    No products on this sales order.
                  </td>
                </tr>
              ) : (
                lines.map((row) => (
                  <tr key={row.sl_no}>
                    <td className="num">{row.sl_no}</td>
                    {showPricing ? (
                      <td>{display(row.product_name)}</td>
                    ) : (
                      <td>{display(row.product_code)}</td>
                    )}
                    {!showPricing ? <td>{display(row.product_name)}</td> : null}
                    {!showPricing ? <td>{display(row.description)}</td> : null}
                    <td className="num">
                      {editable && lines.length === 1 ? (
                        <Input
                          type="number"
                          min="0.001"
                          step="any"
                          value={form?.quantity ?? row.quantity ?? ""}
                          onChange={(e) => onPatchField?.("quantity", e.target.value)}
                          error={errors.quantity}
                          className="sjc-doc__input"
                        />
                      ) : (
                        display(row.quantity)
                      )}
                    </td>
                    <td>
                      {editable && lines.length === 1 ? (
                        <Input
                          value={form?.unit || row.uom || "Nos"}
                          onChange={(e) => onPatchField?.("unit", e.target.value)}
                          className="sjc-doc__input"
                        />
                      ) : (
                        display(row.uom)
                      )}
                    </td>
                    {showPricing ? (
                      <>
                        <td className="num">{formatInr(row.unit_price)}</td>
                        <td className="num">{formatInr(row.line_amount ?? row.total_amount)}</td>
                      </>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {showPricing && lineTotals ? (
            <div className="manual-sjc__line-summary">
              <div className="manual-sjc__line-summary-row">
                <span>Total Quantity</span>
                <span>{lineTotals.totalQuantity}</span>
              </div>
              <div className="manual-sjc__line-summary-row manual-sjc__line-summary-row--total">
                <span>Total Amount</span>
                <span>{formatInr(lineTotals.totalAmount)}</span>
              </div>
            </div>
          ) : null}
          {editable && lines.length === 1 ? (
            <div className="px-2 py-2 border-t border-[#d1d5db]">
              <div className="sjc-doc__field-row">
                <span className="sjc-doc__field-label">Product / Item *</span>
                <span>
                  <Select
                    value={form?.product_id ?? ""}
                    onChange={(e) => onPatchField?.("product_id", e.target.value)}
                    className="sjc-doc__input"
                    error={errors.product_id}
                  >
                    <option value="">Select product</option>
                    {(products || []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="sjc-doc__table-wrap">
          <div className="sjc-doc__table-caption">Technical Specifications</div>
          {specs.length === 0 ? (
            <p className="sjc-doc__empty" style={{ border: "none", margin: 0 }}>
              No technical specifications available.
            </p>
          ) : (
            <table className="sjc-doc__table">
              <thead>
                <tr>
                  <th>Sl. No.</th>
                  <th>Parameter</th>
                  <th>Specification</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((row) => (
                  <tr key={`${row.sl_no}-${row.parameter}`}>
                    <td className="num">{row.sl_no}</td>
                    <td>{display(row.parameter)}</td>
                    <td>{display(row.specification)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="sjc-doc__approval">
          <table className="sjc-doc__table">
            <thead>
              <tr>
                <th>Prepared By</th>
                <th>Checked By</th>
                <th>Approved By</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sjc-doc__sign-cell">{editable ? display(approval.prepared_by) : signCell(approval.prepared_by)}</td>
                <td className="sjc-doc__sign-cell">{editable ? display(approval.checked_by) : signCell(approval.checked_by)}</td>
                <td className="sjc-doc__sign-cell">{editable ? display(approval.approved_by) : signCell(approval.approved_by)}</td>
                <td className="sjc-doc__sign-cell">{editable ? fmtDate(approval.prepared_date || approval.approved_date) : signCell(fmtDate(approval.prepared_date || approval.approved_date))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
