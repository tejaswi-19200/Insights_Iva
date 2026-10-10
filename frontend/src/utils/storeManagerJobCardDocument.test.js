import { describe, expect, it } from "vitest";

import { buildStoreManagerJobCardDocument } from "./storeManagerJobCardDocument";

describe("buildStoreManagerJobCardDocument instructions", () => {
  it("uses production instructions entered on the job card", () => {
    const doc = buildStoreManagerJobCardDocument({
      soCard: {
        details: {
          production: {
            production_instructions: "Check GSM before issue.\nKeep rolls dry.",
          },
        },
      },
    });

    expect(doc.instructions).toEqual(["Check GSM before issue.", "Keep rolls dry."]);
  });

  it("does not add default instructions when the form has none", () => {
    const doc = buildStoreManagerJobCardDocument({ soCard: {} });

    expect(doc.instructions).toEqual([]);
  });
});

describe("buildStoreManagerJobCardDocument materials", () => {
  it("uses BOM material requirements and tracks partially issued quantities", () => {
    const doc = buildStoreManagerJobCardDocument({
      soCard: {
        sales_document: {
          product_lines: [{ product_name: "Finished Product", quantity: 10 }],
        },
        material_check: {
          lines: [
            {
              sku: "RM-01",
              component_name: "Raw Material",
              required_qty: 5,
              available_qty: 5,
              issued_qty: 2,
              remaining_qty: 3,
              unit: "KG",
            },
          ],
        },
      },
    });

    expect(doc.materials).toEqual([
      expect.objectContaining({
        material_code: "RM-01",
        material_name: "Raw Material",
        required_qty: 5,
        issued_qty: 2,
        balance_qty: 3,
        uom: "KG",
      }),
    ]);
  });

  it("prefers checked BOM components over the manual card's product-line preview", () => {
    const doc = buildStoreManagerJobCardDocument({
      manualCard: {
        material_requirements: [
          { product_name: "Finished Product", quantity: 10, uom: "PCS" },
        ],
        material_check: {
          lines: [
            {
              material_code: "RM-01",
              material_name: "Raw Material",
              required_qty: 5,
              uom: "KG",
            },
          ],
        },
      },
    });

    expect(doc.materials).toHaveLength(1);
    expect(doc.materials[0]).toMatchObject({
      material_code: "RM-01",
      material_name: "Raw Material",
      required_qty: 5,
    });
  });

  it("does not show finished-product lines as material requirements when BOM lines are missing", () => {
    const doc = buildStoreManagerJobCardDocument({
      soCard: {
        sales_document: {
          product_lines: [{ product_name: "Finished Product", quantity: 10 }],
        },
      },
    });

    expect(doc.materials).toEqual([]);
  });
});
