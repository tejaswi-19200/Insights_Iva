import { describe, expect, it } from "vitest";

import {
  compareStoreQueueRows,
  matchesStoreStatusBucket,
  STORE_ACTIONABLE_STATUSES,
  storeQueueStatusLabel,
  storeStatusVariant,
} from "./storeJobCardQueue";
import { getSerialNumber } from "./serialNumber";

describe("storeJobCardQueue", () => {
  it("matches store_pending bucket statuses only", () => {
    expect(
      matchesStoreStatusBucket({ workflow_status: "MATERIAL_CHECK_PENDING" }, "store_pending")
    ).toBe(true);
    expect(
      matchesStoreStatusBucket({ workflow_status: "STORE_ISSUE_PENDING" }, "store_pending")
    ).toBe(false);
  });

  it("sorts job cards by number then id ascending", () => {
    const rows = [
      { job_card_no: "JC-100", job_card_id: 3 },
      { job_card_no: "JC-010", job_card_id: 1 },
      { job_card_no: "JC-050", sales_order_id: 2 },
    ];
    const sorted = [...rows].sort(compareStoreQueueRows);
    expect(sorted.map((r) => r.job_card_no)).toEqual(["JC-010", "JC-050", "JC-100"]);
  });

  it("excludes packing statuses from actionable inventory set", () => {
    expect(STORE_ACTIONABLE_STATUSES.has("PACKED")).toBe(false);
    expect(STORE_ACTIONABLE_STATUSES.has("MATERIAL_CHECK_PENDING")).toBe(true);
  });

  it("shows a distinct label and relevant badge color for each store workflow state", () => {
    const expected = [
      ["MATERIAL_CHECK_PENDING", "Inventory Check Pending", "warning"],
      ["MATERIAL_SHORTAGE", "Material Shortage", "danger"],
      ["MATERIAL_AVAILABLE", "Materials Available", "success"],
      ["STORE_ISSUE_PENDING", "Ready to Issue", "warning"],
      ["MATERIAL_PARTIAL", "Materials Partially Available", "warning"],
      ["STORE_ISSUE_PARTIAL", "Partially Issued", "info"],
    ];

    for (const [workflow_status, label, variant] of expected) {
      const row = { workflow_status, queue_status_label: "Store Pending" };
      expect(storeQueueStatusLabel(row)).toBe(label);
      expect(storeStatusVariant(row)).toBe(variant);
    }
  });
});

describe("serial numbers across pages", () => {
  it("continues serial offset on page 2", () => {
    expect(getSerialNumber(0, { serialOffset: 10 })).toBe(11);
    expect(getSerialNumber(4, { serialOffset: 10 })).toBe(15);
  });
});
