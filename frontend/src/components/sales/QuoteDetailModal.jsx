import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { Download, Mail, Printer, X } from "lucide-react";

import { convertQuotationToSalesOrder, downloadQuotationPdf, getQuotation } from "../../api/salesApi";
import { getProducts } from "../../api/productionApi";
import { formatQuotationInr, statusColor } from "../../data/salesMasterData";
import { useToast } from "../../context/ToastContext";
import { exportToPdf } from "../../utils/exportUtils";
import { canConvertQuotationToSalesOrder } from "../../utils/quotationWorkflow";
import Button from "../common/Button";

export default function QuoteDetailModal({ quote, onClose, onStatusChange, onConverted }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");
  const [selectedItems, setSelectedItems] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [products, setProducts] = useState([]);
  const [quoteItems, setQuoteItems] = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  if (!quote) return null;

  const canConvert = canConvertQuotationToSalesOrder(quote);

  const amount = quote.amount ?? quote.total_amount;

  const handlePreview = () => {
    if (quote?.id) {
      navigate(`/sales/quotations/${quote.id}/copy`);
    } else {
      window.print();
    }
  };

  const handlePdf = async () => {
    if (typeof quote.id === "number") {
      try {
        const res = await downloadQuotationPdf(quote.id);
        const blob = new Blob([res.data], { type: "application/pdf" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Quotation-${quote.quote_number || quote.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        addToast("Quote PDF downloaded", "success");
        return;
      } catch {
        // fallback to client-side table export
      }
    }
    try {
      exportToPdf(
        [
          {
            quote_number: quote.quote_number,
            customer_name: quote.customer_name,
            quote_date: quote.quote_date,
            valid_until: quote.valid_until,
            amount,
            status: quote.status,
            sales_person: quote.sales_person,
          },
        ],
        [
          { key: "quote_number", label: "Quote No" },
          { key: "customer_name", label: "Customer" },
          { key: "quote_date", label: "Date" },
          { key: "valid_until", label: "Valid Until" },
          { key: "amount", label: "Amount" },
          { key: "status", label: "Status" },
          { key: "sales_person", label: "Sales Person" },
        ],
        `Quotation ${quote.quote_number}`,
        `quote-${quote.quote_number || "export"}`
      );
      addToast("Quote PDF downloaded");
    } catch {
      addToast(
        `PDF unavailable — ${quote.quote_number}: ${quote.customer_name || "Customer"} ${formatQuotationInr(amount)}`,
        "info"
      );
    }
  };

  const handleSendEmail = () => {
    const companyEmail = "sales@gnsinsights.com";
    const customerEmail = `${(quote.customer_name || "client").toLowerCase().replace(/[^a-z0-9]/g, "")}@company.com`;
    const subject = encodeURIComponent(`Commercial Quotation ${quote.quote_number} - Insights Iva`);
    const body = encodeURIComponent(
      `Dear ${quote.customer_name || "Customer"},\n\nPlease find attached Commercial Quotation ${quote.quote_number} for total amount ${formatQuotationInr(amount)}.\n\nQuote Date: ${quote.quote_date || "—"}\nValid Until: ${quote.valid_until || "—"}\nSales Representative: ${quote.sales_person || "Vikram Sharma"}\n\nTerms & Notes:\n${quote.notes || "30% advance deposit, 70% upon dispatch. Validity: 30 days."}\n\nBest regards,\nInsights Iva Sales Team\nCompany Email: ${companyEmail}`
    );

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${customerEmail}&cc=${companyEmail}&su=${subject}&body=${body}`;
    window.open(gmailUrl, "_blank");

    if (addToast) addToast(`Opening Gmail compose from Company Mail (${companyEmail}) to ${quote.customer_name}!`, "success");
  };

  const loadProducts = async () => {
    if (productsLoaded) return;
    try {
      const [productRes, quoteRes] = await Promise.all([
        getProducts(),
        getQuotation(quote.id),
      ]);
      const catalog = productRes.data || [];
      setProducts(catalog);
      let meta = quoteRes.data?.meta_json || {};
      if (typeof meta === "string") {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
      }
      const lines = Array.isArray(meta.items) ? meta.items : [];
      const quoteLines = lines.map((item, index) => {
        const description = item.item_description || item.name || `Quotation item ${index + 1}`;
        const normalized = String(description).trim().toLowerCase();
        const matchedProduct = catalog.find((product) =>
          [product.name, product.sku].some((value) => String(value || "").trim().toLowerCase() === normalized)
        );
        return { ...item, description, productId: matchedProduct?.id || "", key: `${index}-${description}` };
      });
      setQuoteItems(quoteLines);
      setSelectedItems(quoteLines.map((item) => item.key));
      setQuantities(Object.fromEntries(quoteLines.map((item) => [item.key, String(item.qty || 1)])));
    } catch {
      setProducts([]);
      setQuoteItems([]);
    } finally {
      setProductsLoaded(true);
    }
  };

  useEffect(() => {
    if (quote?.id) loadProducts();
  }, [quote?.id]);

  const handleConvert = async () => {
    if (converting) return;
    if (typeof quote.id !== "number") {
      setError("Demo quotation cannot be converted.");
      return;
    }
    if (!selectedItems.length) {
      setError("Select at least one quotation item to continue.");
      return;
    }
    const invalidQuantity = quoteItems.some((item) =>
      selectedItems.includes(item.key) && (!Number.isFinite(Number(quantities[item.key])) || Number(quantities[item.key]) <= 0)
    );
    if (invalidQuantity) {
      setError("Enter a quantity greater than zero for every selected item.");
      return;
    }
    setConverting(true);
    setError("");
    try {
      const payload = {
        items: quoteItems.filter((item) => selectedItems.includes(item.key)).map((item) => {
          const product = products.find((p) => String(p.id) === String(item.productId));
          return {
            ...(product ? { product_id: Number(product.id) } : {}),
            item_description: item.description,
            quantity: Number(quantities[item.key]) || 1,
            unit: item.unit || "pcs",
            unit_price: Number(item.rate ?? product?.unit_price ?? 0),
          };
        }),
      };
      const res = await convertQuotationToSalesOrder(quote.id, payload);
      const so = res.data;
      onConverted?.(so);
      onClose?.();
      if (so?.order_number) {
        addToast(
          `Sales Order ${so.order_number} created. Next: Confirm Sales Order on the detail page.`,
          "success"
        );
      }
      if (so?.id) {
        navigate(`/sales/orders/${so.id}`, {
          state: {
            flashMessage:
              "Sales order created from quotation. Next: Confirm Sales Order to send to Store for material check.",
          },
        });
      } else {
        navigate("/sales/orders");
      }
    } catch (err) {
      const msg = err.response?.data?.detail || "Convert failed";
      setError(typeof msg === "string" ? msg : "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Quotation ${quote.quote_number}`}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-primary)]">{quote.quote_number}</p>
            <h2 className="text-xl font-bold text-slate-900">{quote.customer_name || "Customer"}</h2>
            <p className="text-sm text-slate-500">
              Sales Person: {quote.sales_person || "—"} · Valid until {quote.valid_until || "—"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 print:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-400">Quote date</dt>
              <dd className="font-medium">{quote.quote_date || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-400">Amount</dt>
              <dd className="font-medium">{formatQuotationInr(quote.amount ?? quote.total_amount)}</dd>
            </div>
          </dl>

          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-slate-400">Status:</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusColor(quote.status)}`}>
              {quote.status}
            </span>
          </div>

          {canConvert && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 print:hidden">
              <p className="mb-2 text-sm font-semibold text-slate-800">Convert to Sales Order</p>
                <p className="mb-3 text-xs text-slate-500">
                Creates a draft sales order with the selected quotation items. At least one item is required.
              </p>
              <div className="space-y-2">
                {quoteItems.length ? quoteItems.map((item) => {
                  const checked = selectedItems.includes(item.key);
                  return (
                    <div key={item.key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setSelectedItems((current) => event.target.checked
                          ? [...current, item.key]
                          : current.filter((key) => key !== item.key))}
                        aria-label={`Include ${item.description}`}
                      />
                      <span className="min-w-0 flex-1 text-sm text-slate-700">{item.description}</span>
                      <span className="text-xs text-slate-500">{item.unit || "pcs"} · ₹{Number(item.rate || 0).toLocaleString("en-IN")}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.]?[0-9]*"
                        value={quantities[item.key] ?? ""}
                        onChange={(event) => setQuantities((current) => ({ ...current, [item.key]: event.target.value }))}
                        className="w-24 rounded-lg border px-2 py-1.5 text-sm"
                        aria-label={`Quantity for ${item.description}`}
                        disabled={!checked}
                      />
                    </div>
                  );
                }) : <p className="text-sm text-amber-700">{productsLoaded ? "This quotation has no saved line items. Add quotation items before converting." : "Loading quotation items…"}</p>}
              </div>
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t px-5 py-4 print:hidden">
          <button type="button" onClick={handlePreview} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Printer className="h-4 w-4" /> Preview
          </button>
          <button type="button" onClick={handlePdf} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> PDF
          </button>
          <button type="button" onClick={handleSendEmail} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Mail className="h-4 w-4" /> Email
          </button>
          {canConvert && (
            <Button type="button" variant="primary" disabled={converting || !quoteItems.length || !selectedItems.length} loading={converting} onClick={handleConvert}>
              {converting ? "Converting…" : "Convert to Sales Order"}
            </Button>
          )}
          {quote.status === "draft" && (
            <button
              type="button"
              onClick={() => onStatusChange?.(quote, "pending_approval")}
              className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-800"
            >
              Submit for Approval
            </button>
          )}
          {quote.status === "pending_approval" && (
            <>
              <button
                type="button"
                onClick={() => onStatusChange?.(quote, "approved")}
                className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-800"
              >
                Approve Quote
              </button>
              <button
                type="button"
                onClick={() => onStatusChange?.(quote, "rejected")}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700"
              >
                Reject
              </button>
            </>
          )}
          {(quote.status === "approved" || quote.status === "draft") && (
            <button
              type="button"
              onClick={() => onStatusChange?.(quote, "sent")}
              className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700"
            >
              Send to Customer
            </button>
          )}
          {quote.status === "sent" && (
            <button
              type="button"
              onClick={() => onStatusChange?.(quote, "accepted")}
              className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-800"
            >
              Customer Confirmed
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
