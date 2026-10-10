import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import JobCardQueueTable from "./JobCardQueueTable";

vi.mock("../../hooks/useAuth", () => ({
  default: () => ({ user: null }),
}));

describe("JobCardQueueTable ERP job card link", () => {
  it("opens the selected job card through the details handler", () => {
    const onViewDetails = vi.fn();
    const row = {
      id: 12,
      sales_order_id: 12,
      job_card_no: "JC-2026-0003",
      order_number: "SO-QU-00003",
      workflow_status: "MATERIAL_CHECK_PENDING",
    };

    render(
      <MemoryRouter>
        <JobCardQueueTable
          rows={[row]}
          erpLayout
          onViewDetails={onViewDetails}
          jobCardLinkForRow={() => "/my-job-cards?order=12"}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("link", { name: "JC-2026-0003" }));

    expect(onViewDetails).toHaveBeenCalledWith(row);
  });

  it("resets the table to its first columns when the selected job card changes", () => {
    const props = {
      rows: [{ id: 12, sales_order_id: 12, job_card_no: "JC-2026-0003" }],
      erpLayout: true,
      selectedOrderId: 12,
    };
    const { container, rerender } = render(
      <MemoryRouter>
        <JobCardQueueTable {...props} />
      </MemoryRouter>
    );
    const tableWrap = container.querySelector(".my-job-cards-table");
    tableWrap.scrollLeft = 420;

    rerender(
      <MemoryRouter>
        <JobCardQueueTable {...props} selectedOrderId={13} />
      </MemoryRouter>
    );

    expect(tableWrap.scrollLeft).toBe(0);
  });
});
