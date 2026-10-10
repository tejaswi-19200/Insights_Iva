import React, { useState, useMemo } from "react";
import { Search, X, Package, Plus, Check, Grid2x2, ArrowRight, Info } from "lucide-react";
import { ERP_PRIMARY } from "../../design-system/erpFormControls";
import ProductDetailModal from "../masters/ProductDetailModal";

export default function ItemSelectionModal({
  isOpen = true,
  products = [],
  onSelect,
  onClose,
  onAddNew,
  onViewDetail,
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedDetailProduct, setSelectedDetailProduct] = useState(null);

  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ["all", ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const isSellable =
        String(p.status || "active").toLowerCase() === "active" &&
        p.is_sellable !== false;
      if (!isSellable) return false;

      if (selectedCategory !== "all" && p.category !== selectedCategory) {
        return false;
      }

      if (!q) return true;

      return [p.name, p.sku, p.product_code, p.hsn_code, p.hsn, p.category, p.description]
        .filter(Boolean)
        .some((val) => String(val).toLowerCase().includes(q));
    });
  }, [products, search, selectedCategory]);

  if (!isOpen) return null;

  const handleOpenDetail = (p) => {
    if (onViewDetail) {
      onViewDetail(p);
    } else {
      setSelectedDetailProduct(p);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div
          className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/60">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ background: ERP_PRIMARY }}
              >
                <Package className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Select Item</h3>
                <p className="text-xs text-slate-500">
                  Browse all available inventory products & items
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onAddNew && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onAddNew();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 text-indigo-600" />
                  Add New Item
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Search & Category Filter Bar */}
          <div className="border-b border-slate-100 bg-white p-4 space-y-3">
            <div className="relative flex items-center">
              <Search className="absolute left-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by item name, SKU, HSN code, or category..."
                className="w-full rounded-full border border-blue-300 bg-slate-50/50 py-2.5 pl-10 pr-9 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 shadow-sm transition"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 rounded-full p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {categories.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <span className="text-slate-400 text-[11px] font-medium mr-1">Category:</span>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition capitalize whitespace-nowrap cursor-pointer ${
                      selectedCategory === cat
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {cat === "all" ? "All Categories" : cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Products Table / List */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredProducts.length === 0 ? (
              <div className="py-12 text-center">
                <Package className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">No items found</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Try searching with a different term or add a new product.
                </p>
                {onAddNew && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAddNew();
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
                    style={{ background: ERP_PRIMARY }}
                  >
                    <Plus className="h-4 w-4" />
                    Add New Item
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                <div className="grid grid-cols-12 bg-slate-50 px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <div className="col-span-4">Item Name & SKU</div>
                  <div className="col-span-2 text-center">HSN Code</div>
                  <div className="col-span-2 text-center">Stock</div>
                  <div className="col-span-2 text-right">Price / Unit</div>
                  <div className="col-span-2 text-center">Action</div>
                </div>

                {filteredProducts.map((p) => {
                  const stockVal = p.current_stock != null ? Number(p.current_stock) : null;
                  const priceVal = p.unit_price ?? p.sale_price ?? p.price_per_unit ?? 0;

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        onSelect(p);
                        onClose();
                      }}
                      className="grid grid-cols-12 items-center px-4 py-3 text-xs hover:bg-indigo-50/50 cursor-pointer transition group"
                    >
                      <div className="col-span-4 pr-2">
                        <div className="font-bold text-slate-800 text-[13px] group-hover:text-indigo-600 transition">
                          {p.name || p.sku}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                          {p.sku && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-600">{p.sku}</span>}
                          {p.category && <span>· {p.category}</span>}
                        </div>
                      </div>

                      <div className="col-span-2 text-center text-slate-600 font-mono text-[11px]">
                        {p.hsn_code || p.hsn || "-"}
                      </div>

                      <div className="col-span-2 text-center">
                        {stockVal != null ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              stockVal > 0
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            Stock: {stockVal} {p.unit || "pcs"}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </div>

                      <div className="col-span-2 text-right font-semibold text-slate-800">
                        {priceVal ? `₹${Number(priceVal).toLocaleString("en-IN")}` : "-"}
                        {p.unit ? <span className="text-[10px] font-normal text-slate-500"> / {p.unit}</span> : ""}
                      </div>

                      <div className="col-span-2 text-center flex items-center justify-center gap-1.5">
                        {/* Info icon matching Image 1 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(p);
                          }}
                          className="inline-flex items-center justify-center rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-indigo-100 hover:text-indigo-600 transition shadow-sm cursor-pointer"
                          title="View item details"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>

                        {/* Arrow Right icon matching Image 2 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(p);
                          }}
                          className="inline-flex items-center justify-center rounded-lg bg-indigo-50 p-1.5 text-indigo-600 hover:bg-indigo-600 hover:text-white transition shadow-sm cursor-pointer"
                          title="View item details"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-700">{filteredProducts.length}</strong> of{" "}
              <strong className="text-slate-700">{products.length}</strong> products
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition shadow-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Product Details Modal rendered when clicking Info or Arrow button */}
      {selectedDetailProduct && (
        <ProductDetailModal
          product={selectedDetailProduct}
          onClose={() => setSelectedDetailProduct(null)}
        />
      )}
    </>
  );
}
