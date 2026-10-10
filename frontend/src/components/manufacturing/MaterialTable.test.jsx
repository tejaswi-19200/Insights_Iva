import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MaterialTable from "./MaterialTable";

describe("MaterialTable editable quantities", () => {
  it("shows a zero value when a column opts in to displaying zero", () => {
    render(
      <MaterialTable
        columns={[{ key: "issued_qty", label: "Total Issued", editable: true, type: "number", showZero: true }]}
        rows={[{ id: 1, issued_qty: 0 }]}
        editable
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("spinbutton")).toHaveValue(0);
  });

  it("keeps zero blank for editable quantities unless requested", () => {
    render(
      <MaterialTable
        columns={[{ key: "quantity", label: "Quantity", editable: true, type: "number" }]}
        rows={[{ id: 1, quantity: 0 }]}
        editable
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("spinbutton")).toHaveValue(null);
  });
});
