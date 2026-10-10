/** Whether the quotation can be converted to a sales order (matches backend rules). */
export function canConvertQuotationToSalesOrder(quote) {
  if (!quote || quote.converted_to_so) return false;
  const st = String(quote.status || "").toLowerCase();
  if (["converted", "cancelled", "canceled"].includes(st)) return false;
  return ["accepted", "sent", "approved"].includes(st);
}

export function quotationConvertMenuItem(quote, onConvert) {
  if (canConvertQuotationToSalesOrder(quote)) {
    return {
      label: "Convert to Sales Order",
      onClick: onConvert,
    };
  }
  if (quote?.converted_to_so && quote?.converted_sales_order_number) {
    return {
      label: "Converted",
      disabled: true,
    };
  }
  return null;
}
