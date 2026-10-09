import { describe, expect, it } from "vitest";
import { filterPurchaseOrdersByStatus } from "./procurementMasterData";

describe("filterPurchaseOrdersByStatus", () => {
  const rows = [
    { id: 1, status: "draft" },
    { id: 2, status: "approved" },
    { id: 3, status: "cancelled" },
  ];

  it("hides cancelled orders by default", () => {
    expect(filterPurchaseOrdersByStatus(rows).map((row) => row.id)).toEqual([1, 2]);
  });

  it("shows cancelled orders when the cancelled filter is selected", () => {
    expect(filterPurchaseOrdersByStatus(rows, "cancelled").map((row) => row.id)).toEqual([3]);
  });
});
