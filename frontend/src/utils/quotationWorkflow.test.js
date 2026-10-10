import { describe, expect, it } from "vitest";

import {
  canConvertQuotationToSalesOrder,
  quotationConvertMenuItem,
} from "./quotationWorkflow";

describe("canConvertQuotationToSalesOrder", () => {
  it("allows accepted quotations that are not yet converted", () => {
    expect(canConvertQuotationToSalesOrder({ status: "accepted", converted_to_so: false })).toBe(true);
  });

  it("blocks when already converted", () => {
    expect(canConvertQuotationToSalesOrder({ status: "accepted", converted_to_so: true })).toBe(false);
  });

  it("blocks draft quotations", () => {
    expect(canConvertQuotationToSalesOrder({ status: "draft", converted_to_so: false })).toBe(false);
  });

  it("shows a simple converted label without the sales order number", () => {
    expect(
      quotationConvertMenuItem(
        {
          status: "accepted",
          converted_to_so: true,
          converted_sales_order_number: "SO-QT-L1-20261010",
        },
        () => {}
      )
    ).toEqual({ label: "Converted", disabled: true });
  });
});
