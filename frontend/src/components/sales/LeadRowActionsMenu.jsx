import { Eye, FileText, Pencil, Trash2 } from "lucide-react";

import RowActionMenu from "../common/RowActionMenu";

export function leadRowMenuId(lead) {
  if (lead?.id != null && typeof lead.id === "number") return String(lead.id);
  return `lead-${lead?.lead_id || lead?.customer_name || lead?.company || "row"}`;
}

export default function LeadRowActionsMenu({
  lead,
  openMenu,
  setOpenMenu,
  ariaLabel,
  canView = true,
  canEdit = true,
  canDelete = true,
  canCreateQuotation = true,
  onView,
  onEdit,
  onDelete,
  onCreateQuotation,
  onViewQuotation,
}) {
  const rowId = leadRowMenuId(lead);
  const hasServerId = typeof lead?.id === "number";
  const items = [];

  if (canView) {
    items.push({
      label: "View",
      icon: <Eye className="h-4 w-4" />,
      onClick: () => onView?.(lead),
    });
  }
  if (canEdit && hasServerId) {
    items.push({
      label: "Edit",
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => onEdit?.(lead),
    });
  }
  if (canCreateQuotation && hasServerId) {
    if (lead.quotation_id) {
      items.push({
        label: "Quotation Converted",
        icon: <FileText className="h-4 w-4" />,
        onClick: () => onViewQuotation?.(lead),
      });
    } else {
      items.push({
        label: "Create Quotation",
        icon: <FileText className="h-4 w-4" />,
        onClick: () => onCreateQuotation?.(lead),
      });
    }
  }
  if (canDelete && hasServerId) {
    if (items.length) items.push({ divider: true });
    items.push({
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onClick: () => onDelete?.(lead),
    });
  }

  const label =
    ariaLabel ||
    `Actions for ${lead?.customer_name || lead?.company || lead?.lead_id || "lead"}`;

  return (
    <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
      <RowActionMenu
        rowId={rowId}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        ariaLabel={label}
        items={items}
      />
    </div>
  );
}
