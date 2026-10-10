import { useEffect, useRef, useState } from "react";
import { Star, MoreVertical, Plus, Pencil, Ban, Trash2 } from "lucide-react";

export default function ItemPickerDropdown({
  products = [],
  onSelectProduct,
  onAddNewItem,
  onEditItem,
  onToggleInactive,
  onDeleteItem,
  selectedIndex = 0,
}) {
  const itemRefs = useRef([]);

  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView?.({
        block: "nearest",
      });
    }
  }, [selectedIndex]);
  const [starredIds, setStarredIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("starred_products") || "[]");
    } catch {
      return [];
    }
  });
  const [activeMenuState, setActiveMenuState] = useState(null);

  const toggleStar = (e, productId) => {
    e.stopPropagation();
    e.preventDefault();
    setStarredIds((prev) => {
      const next = prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];
      localStorage.setItem("starred_products", JSON.stringify(next));
      return next;
    });
  };

  const dropdownRef = useRef(null);

  const handleMenuClick = (e, productId) => {
    e.stopPropagation();
    e.preventDefault();
    if (activeMenuState?.id === productId) {
      setActiveMenuState(null);
      return;
    }

    const containerRect = dropdownRef.current?.getBoundingClientRect();
    const buttonRect = e.currentTarget.getBoundingClientRect();

    if (containerRect && buttonRect) {
      const topOffset = buttonRect.top - containerRect.top;
      const spaceOnRight = window.innerWidth - containerRect.right;
      const placement = spaceOnRight < 170 ? "left" : "right";

      setActiveMenuState({
        id: productId,
        top: topOffset,
        placement,
      });
    } else {
      setActiveMenuState({
        id: productId,
        top: 0,
        placement: "right",
      });
    }
  };

  // Close popover menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setActiveMenuState(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeProduct = products.find((p) => p.id === activeMenuState?.id);

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 right-0 top-full z-40 mt-1"
    >
      <div className="relative w-full">
        {/* Main dropdown scrollable container */}
        <div
          onScroll={() => {
            if (activeMenuState) setActiveMenuState(null);
          }}
          className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl transition-all"
        >
          {products.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500">
              <p className="mb-2">No products found.</p>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAddNewItem?.();
                }}
                className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add New Item</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {products.map((p, index) => {
                const isStarred = starredIds.includes(p.id);
                const isInactive = p.status === "inactive";
                const isHighlighted = index === selectedIndex;

                return (
                  <div
                    key={p.id}
                    ref={(el) => (itemRefs.current[index] = el)}
                    className={`group relative flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                      isHighlighted ? "bg-blue-50/90 font-medium" : "hover:bg-slate-50/90"
                    }`}
                  >
                    {/* Main clickable area to select product */}
                    <div
                      className="flex-1 cursor-pointer pr-2"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectProduct(p)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-semibold text-xs text-slate-800 ${
                            isInactive ? "line-through opacity-60" : ""
                          }`}
                        >
                          {p.name || p.sku}
                        </span>
                        {isInactive ? (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-800">
                            Inactive
                          </span>
                        ) : null}
                      </div>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {[
                          p.sku,
                          p.hsn_code ? `HSN ${p.hsn_code}` : null,
                          p.current_stock != null ? `Stock ${p.current_stock}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>

                    {/* Right side actions: Star & Three dots */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Star icon */}
                      <button
                        type="button"
                        title={isStarred ? "Unstar item" : "Star item"}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => toggleStar(e, p.id)}
                        className="p-1 text-slate-400 hover:text-amber-500 transition-colors cursor-pointer"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            isStarred ? "fill-amber-400 text-amber-500" : "text-slate-400"
                          }`}
                        />
                      </button>

                      {/* Three dots icon */}
                      <button
                        type="button"
                        title="Item actions"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => handleMenuClick(e, p.id)}
                        className="p-1 text-[#2563eb] hover:text-blue-700 transition-colors cursor-pointer"
                      >
                        <MoreVertical className="h-4 w-4 text-[#2563eb]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer "Add New Item" */}
          {products.length > 0 && (
            <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50/95 p-2 text-center backdrop-blur-xs">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAddNewItem?.();
                }}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-indigo-600" />
                <span>Add New Item</span>
              </button>
            </div>
          )}
        </div>

        {/* Side Popover menu rendered to the side of the dropdown */}
        {activeMenuState?.id && activeProduct ? (
          <div
            style={{ top: `${activeMenuState.top}px` }}
            className={`absolute z-50 min-w-[150px] rounded-xl border border-slate-200 bg-white p-1 shadow-xl text-left ${
              activeMenuState.placement === "left"
                ? "right-full mr-1.5"
                : "left-full ml-1.5"
            }`}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuState(null);
                onEditItem?.(activeProduct);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5 text-slate-700" />
              <span>Edit Item</span>
            </button>

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuState(null);
                onToggleInactive?.(activeProduct);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 cursor-pointer"
            >
              <Ban className="h-3.5 w-3.5 text-amber-600" />
              <span>
                {activeProduct.status === "inactive"
                  ? "Mark as active"
                  : "Mark as inactive"}
              </span>
            </button>

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuState(null);
                onDeleteItem?.(activeProduct);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-600" />
              <span>Delete Item</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
