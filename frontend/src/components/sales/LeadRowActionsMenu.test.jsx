import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LeadRowActionsMenu from "./LeadRowActionsMenu";

function renderLeadActions(lead) {
  return render(
    <LeadRowActionsMenu
      lead={lead}
      onCreateQuotation={vi.fn()}
      onViewQuotation={vi.fn()}
    />
  );
}

describe("LeadRowActionsMenu quotation action", () => {
  it("offers quotation conversion for a new saved lead", () => {
    renderLeadActions({ id: 1, status: "new", customer_name: "New Customer" });

    fireEvent.click(screen.getByRole("button", { name: /actions for new customer/i }));

    expect(screen.getByRole("menuitem", { name: /create quotation/i })).toBeInTheDocument();
  });

  it("shows the converted label after a quotation exists", () => {
    renderLeadActions({
      id: 2,
      status: "converted",
      quotation_id: 15,
      quotation_number: "QT-015",
      customer_name: "Converted Customer",
    });

    fireEvent.click(screen.getByRole("button", { name: /actions for converted customer/i }));

    expect(screen.getByRole("menuitem", { name: /quotation converted/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /create quotation/i })).not.toBeInTheDocument();
  });
});
