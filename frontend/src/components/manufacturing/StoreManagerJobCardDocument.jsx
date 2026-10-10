import { useMemo } from "react";

import {
  buildStoreManagerJobCardDocument,
  smjcDisplay,
} from "../../utils/storeManagerJobCardDocument";
import {
  fmtDate,
  resolveCompanyLogoUrl,
  resolveCompanyTagline,
} from "../../utils/salesJobCardDocument";
import "../../styles/sales-job-card-document.css";

function FieldRow({ label, value }) {
  return (
    <div className="sjc-doc__field-row">
      <span className="sjc-doc__field-label">{label}</span>
      <span className="sjc-doc__field-value">{smjcDisplay(value)}</span>
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

function fmtNum(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("en-IN");
}

export default function StoreManagerJobCardDocument({
  manualCard = null,
  soCard = null,
  row = null,
  storeContext = null,
  materialCheck = null,
  companyProfile = null,
}) {
  const doc = useMemo(
    () =>
      buildStoreManagerJobCardDocument({
        manualCard,
        soCard,
        row,
        storeContext,
        materialCheck,
        companyProfile,
      }),
    [manualCard, soCard, row, storeContext, materialCheck, companyProfile]
  );

  const logoUrl = resolveCompanyLogoUrl(companyProfile);
  const tagline = resolveCompanyTagline(companyProfile);
  const companyName = companyProfile?.company_name || companyProfile?.legal_name || doc.company?.name || "Company Name";
  const companyAddress = doc.company?.address || "";

  return (
    <div
      className="sjc-doc sjc-doc--screen sjc-doc--display smjc-doc"
      id="store-manager-job-card-document"
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
              <div className="sjc-doc__company-name">{companyName}</div>
              {companyAddress ? <div className="sjc-doc__company-address">{companyAddress}</div> : null}
            </div>
          </div>
          {tagline ? <p className="sjc-doc__tagline">{tagline}</p> : null}
        </div>

        <div className="sjc-doc__title-band">Store Manager Job Card</div>

        <div className="sjc-doc__columns">
          <SectionPanel title="Request / Purpose Details">
            <FieldRow label="Store Job Card No." value={doc.header.job_card_no} />
            <FieldRow label="Date" value={fmtDate(doc.header.date)} />
            <FieldRow label="Request Type" value={doc.request.request_type} />
            <FieldRow label="Raised By" value={doc.request.raised_by} />
            <FieldRow label="Reference No." value={doc.request.reference_no} />
            <FieldRow label="Request Date" value={fmtDate(doc.request.request_date)} />
            <FieldRow label="Required Date" value={fmtDate(doc.request.required_date)} />
            <FieldRow label="Purpose" value={doc.request.purpose} />
            <FieldRow label="Remarks" value={doc.request.remarks} />
          </SectionPanel>

          <SectionPanel title="Department Details">
            <FieldRow label="Store Department" value={doc.header.department} />
            <FieldRow label="Store Location" value={doc.header.location} />
            <FieldRow label="Production Department" value={doc.department.department} />
            <FieldRow label="Sales Job Card No." value={doc.department.job_card_no} />
            <FieldRow label="Product Code" value={doc.department.product_code} />
            <FieldRow label="Product Name" value={doc.department.product_name} />
            <FieldRow label="Process" value={doc.department.process} />
            <FieldRow label="Machine" value={doc.department.machine} />
            <FieldRow
              label="Planned Quantity"
              value={`${fmtNum(doc.department.planned_quantity)} ${doc.department.uom || ""}`.trim()}
            />
            <FieldRow label="UOM" value={doc.department.uom} />
          </SectionPanel>
        </div>

        <div className="sjc-doc__table-wrap smjc-doc__material-wrap">
          <div className="sjc-doc__table-caption">Material Issue Details</div>
          <table className="sjc-doc__table smjc-doc__material-table">
            <thead>
              <tr>
                <th>Sl. No.</th>
                <th>Material Code</th>
                <th>Material Name</th>
                <th>Specification</th>
                <th>UOM</th>
                <th className="num">Required Qty</th>
                <th className="num">Issued Qty</th>
                <th className="num">Balance Qty</th>
                <th>Batch / Roll No.</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {doc.materials.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "#6b7280" }}>
                    No material requirements are available for this job card.
                  </td>
                </tr>
              ) : (
                doc.materials.map((row) => (
                  <tr key={row.sl_no}>
                    <td className="num">{row.sl_no}</td>
                    <td>{smjcDisplay(row.material_code)}</td>
                    <td>{smjcDisplay(row.material_name)}</td>
                    <td>{smjcDisplay(row.specification)}</td>
                    <td>{smjcDisplay(row.uom)}</td>
                    <td className="num">{fmtNum(row.required_qty)}</td>
                    <td className="num">{fmtNum(row.issued_qty)}</td>
                    <td className="num">{fmtNum(row.balance_qty)}</td>
                    <td>{smjcDisplay(row.batch_no)}</td>
                    <td>{smjcDisplay(row.remarks)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="sjc-doc__columns smjc-doc__notes-columns">
          <SectionPanel title="Additional Instructions">
            {doc.instructions.length ? (
              <ol className="smjc-doc__instructions">
                {doc.instructions.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            ) : (
              <p className="smjc-doc__instructions smjc-doc__instructions--empty">
                No additional instructions provided.
              </p>
            )}
          </SectionPanel>

          <SectionPanel title="Store Manager Comments">
            <div className="smjc-doc__comments-box">
              {doc.store_comments ? doc.store_comments : "—"}
            </div>
          </SectionPanel>
        </div>

        <div className="sjc-doc__table-wrap smjc-doc__approval-wrap">
          <table className="sjc-doc__table sjc-doc__approval-table">
            <thead>
              <tr>
                <th>Prepared By</th>
                <th>Verified By</th>
                <th>Approved By</th>
                <th>Date &amp; Signature</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{smjcDisplay(doc.approval.prepared_by)}</td>
                <td>{smjcDisplay(doc.approval.verified_by)}</td>
                <td>{smjcDisplay(doc.approval.approved_by)}</td>
                <td>
                  <div>{smjcDisplay(doc.approval.date)}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
