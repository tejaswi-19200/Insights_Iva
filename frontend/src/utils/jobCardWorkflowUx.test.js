import { describe, expect, it } from "vitest";

import { getJobCardWorkflowGuidance } from "./jobCardWorkflowUx";

describe("getJobCardWorkflowGuidance material-check target", () => {
  it("targets the manual material-check panel by default", () => {
    const guidance = getJobCardWorkflowGuidance({
      card: { workflow_status: "MATERIAL_CHECK_PENDING" },
      storeMode: true,
    });

    expect(guidance.scrollToId).toBe("manual-material-check-panel");
  });

  it("allows sales-order cards to target their material-check panel", () => {
    const guidance = getJobCardWorkflowGuidance({
      card: { workflow_status: "MATERIAL_CHECK_PENDING" },
      storeMode: true,
      materialCheckTargetId: "sales-order-material-check-panel",
    });

    expect(guidance.scrollToId).toBe("sales-order-material-check-panel");
  });
});
