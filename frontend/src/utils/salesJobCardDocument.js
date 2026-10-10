/** Client-side Sales Job Card document builder (fallback when API omits sales_document). */

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function formatCustomerAddress(customer) {
  if (!customer) return "";
  const metadataStart =
    /(?:^|,\s*|\|\s*)(?:Payment Terms|Balance|Party type|GST Treatment|Customer Reference):/i;
  const candidates = [
    customer.address_line1 || customer.billing_address,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.pincode,
  ];
  const parts = [];
  const seen = new Set();

  candidates.forEach((candidate) => {
    const cleaned = String(candidate || "").split(metadataStart)[0];
    cleaned
      .split(/[,\r\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const key = part.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        if (key && !seen.has(key)) {
          seen.add(key);
          parts.push(part);
        }
      });
  });

  return parts.join(", ");
}

function mapProductLines(productLines, products) {
  return (productLines || []).map((line, i) => {
    const prod = products?.find((p) => String(p.id) === String(line.product_id));
    return {
      sl_no: i + 1,
      product_id: line.product_id,
      product_code: prod?.sku || prod?.product_code || line.product_code || "",
      product_name: line.product_name || prod?.name || line.item_description || "",
      description: line.description || prod?.description || line.product_name || "",
      quantity: line.quantity,
      uom: line.uom || line.unit || prod?.unit || "Nos",
      unit_price: line.unit_price ?? line.price,
      line_amount: line.line_amount ?? line.total_amount ?? line.amount,
      total_amount: line.total_amount ?? line.line_amount ?? line.amount,
    };
  });
}

export function buildSalesJobCardDocument({
  card,
  form,
  salesOrder,
  customer,
  productLines,
  products,
  details,
}) {
  if (card?.sales_document) {
    return card.sales_document;
  }

  const cust = customer || {};
  const so = salesOrder || {};
  const lines = mapProductLines(productLines, products);
  const categories = lines
    .map((l) => products?.find((p) => String(p.id) === String(l.product_id))?.category)
    .filter(Boolean);
  const uniqueCategories = [...new Set(categories)];

  const specs = [];
  const prod = details?.production || {};
  const out = details?.output || {};
  const addSpec = (parameter, specification) => {
    if (specification == null || specification === "") return;
    specs.push({ sl_no: specs.length + 1, parameter, specification: String(specification) });
  };
  addSpec("Process", prod.process);
  addSpec("Slitting Size", prod.slitting_size);
  addSpec("Width", out.width);
  addSpec("GSM", out.gsm);
  addSpec("Colour", out.colour);
  addSpec("CRA %", out.cra_percent);
  (details?.raw_materials || []).forEach((row) => {
    if (row.gsm) addSpec(`${row.material_name || "Material"} GSM`, row.gsm);
    if (row.mill_grade) addSpec(`${row.material_name || "Material"} Mill Grade`, row.mill_grade);
  });
  lines.forEach((l) => {
    const p = products?.find((x) => String(x.id) === String(l.product_id));
    if (p?.description) addSpec(`${p.name} Description`, p.description);
    if (p?.category && !uniqueCategories.length) addSpec("Product Category", p.category);
  });

  const approval = details?.approval || {};

  return {
    header: {
      job_card_no: form?.job_card_no || card?.job_card_no,
      job_card_date: form?.job_card_date || so.order_date,
      sales_order_no: form?.sales_order_no || so.order_number,
      customer_po_no: so.reference_number,
      status: card?.job_card_created ? "Created" : "Draft",
      workflow_status: form?.workflow_status || card?.workflow_status,
    },
    customer_details: {
      customer_name: form?.customer_name || cust.name,
      contact_person: cust.contact_name,
      phone: cust.phone,
      email: cust.email,
      billing_address: formatCustomerAddress(cust),
    },
    order_details: {
      sales_order_date: so.order_date,
      delivery_date: form?.required_delivery_date || so.delivery_date,
      product_category: uniqueCategories.join(", ") || null,
      end_use: null,
      payment_terms: so.payment_terms,
      priority: form?.priority || so.priority,
      remarks: form?.notes,
      sales_person: form?.sales_person_name || so.sales_person,
    },
    product_lines: lines,
    technical_specifications: specs,
    approval: {
      prepared_by: approval.prepared_by || card?.audit?.created_by,
      prepared_date: approval.prepared_date || form?.job_card_date,
      checked_by: approval.checked_by,
      checked_date: approval.checked_date,
      approved_by: approval.approved_by,
      approved_date: approval.approved_date,
      customer_acknowledgement: approval.customer_acknowledgement,
    },
  };
}

export function resolveCompanyTagline(company) {
  if (!company) return "";
  if (company.tagline) return String(company.tagline).trim();
  const fields = company.custom_fields;
  if (Array.isArray(fields)) {
    const hit = fields.find((f) => {
      const label = String(f?.label || f?.name || "").toLowerCase();
      return label.includes("tagline") || label.includes("slogan") || label.includes("motto");
    });
    if (hit?.value) return String(hit.value).trim();
  }
  return "";
}

/** Resolve company logo URL from settings (supports data URLs and API-relative paths). */
export function resolveCompanyLogoUrl(company) {
  const raw = company?.logo_url || company?.logo || "";
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
    return trimmed;
  }
  return trimmed;
}

export function formatCompanyAddress(company) {
  if (!company) return "";
  const candidates = [
    company.address_line1 || company.address,
    company.address_line2,
    company.landmark,
    company.city,
    company.state,
    company.pincode || company.postal_code,
    company.country,
  ]
    .flatMap((part) => String(part || "").split(/[,\r\n]+/))
    .map((part) => part.trim())
    .filter(Boolean);
  const normalize = (part) => part.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const parts = [];
  const normalizedParts = [];
  candidates.forEach((candidate) => {
    const normalizedCandidate = normalize(candidate);
    if (
      !normalizedCandidate ||
      normalizedParts.some((part) => part.includes(normalizedCandidate))
    ) {
      return;
    }
    parts.push(candidate);
    normalizedParts.push(normalizedCandidate);
  });
  return parts.join(", ");
}

export { fmtDate };
