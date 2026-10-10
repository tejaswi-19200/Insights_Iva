import { describe, expect, it } from "vitest";
import { formatCompanyAddress, formatCustomerAddress } from "./salesJobCardDocument";

describe("formatCompanyAddress", () => {
  it("keeps a complete entered address from repeating structured location fields", () => {
    expect(
      formatCompanyAddress({
        address_line1: "Plot 1, Madhapur, Hyderabad, Telangana, 500001, India",
        address_line2: "Madhapur",
        landmark: "Hyderabad, Telangana, 500001, India",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500001",
        country: "India",
      })
    ).toBe("Plot 1, Madhapur, Hyderabad, Telangana, 500001, India");
  });

  describe("formatCustomerAddress", () => {
    it("removes party metadata and repeated location fields from legacy customer records", () => {
      expect(
        formatCustomerAddress({
          address_line1: "Unit 12, MIDC Industrial Estate",
          address_line2:
            "Pune, Maharashtra, 411019, Payment Terms: 30 Days | Balance: To Receive | Party type: Buyer | GST Treatment: Registered Business - Regular | Customer Reference: DELTA/PO/2026/145",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411019",
        })
      ).toBe("Unit 12, MIDC Industrial Estate, Pune, Maharashtra, 411019");
    });

    it("keeps a simple address unchanged", () => {
      expect(formatCustomerAddress({ address_line1: "Unit 12, MIDC Industrial Estate" })).toBe(
        "Unit 12, MIDC Industrial Estate"
      );
    });

    it("removes a customer reference appended directly to the address", () => {
      expect(
        formatCustomerAddress({
          address_line1: "Unit 12, MIDC Industrial Estate, Customer Reference: PO-145",
        })
      ).toBe("Unit 12, MIDC Industrial Estate");
    });
  });

  it("appends location fields when they are not present in the street address", () => {
    expect(
      formatCompanyAddress({
        address_line1: "Plot 12, Industrial Area",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        country: "India",
      })
    ).toBe("Plot 12, Industrial Area, Pune, Maharashtra, 411001, India");
  });
});
