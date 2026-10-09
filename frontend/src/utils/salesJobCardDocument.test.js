import { describe, expect, it } from "vitest";
import { formatCompanyAddress } from "./salesJobCardDocument";

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
