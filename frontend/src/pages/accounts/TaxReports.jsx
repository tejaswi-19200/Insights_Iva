import { useCallback, useEffect, useState } from "react";
import usePageRefresh from "../../hooks/usePageRefresh";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { exportToExcel, exportToPdf } from "../../utils/exportUtils";
import { FileText, IndianRupee } from "lucide-react";
import KpiCard from "../../components/common/KpiCard";
import PageHeader from "../../components/common/PageHeader";

import ExportButtons from "../../components/finance/ExportButtons";
import FinanceFilters from "../../components/finance/FinanceFilters";
import Loader from "../../components/common/Loader";
import { useToast } from "../../context/ToastContext";
import { getGSTExtended } from "../../api/accountsApi";
import { DEMO_GST, GST_REPORTS, formatInr } from "../../data/financeMasterData";

const PIE_COLORS = ["#2563EB", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];


export default function TaxReports() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(DEMO_GST);
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [financialYear, setFinancialYear] = useState("2025-26");
  const [month, setMonth] = useState("All Months");
  const [branch, setBranch] = useState("");
  const [activeReport, setActiveReport] = useState("GSTR-3B");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getGSTExtended(year);
      if (res.data) setData(res.data);
      else setData(DEMO_GST);
    } catch {
      setData(DEMO_GST);
    } finally {
      setLoading(false);
    }
  }, [year, addToast]);

  usePageRefresh(load);


  useEffect(() => { load(); }, [load]);

  const exportExcel = () => {
    exportToExcel(
      [
        { metric: "SGST", value: data.sgst },
        { metric: "CGST", value: data.cgst },
        { metric: "IGST", value: data.igst },
        { metric: "Total GST", value: data.total_gst },
        { metric: "Taxable Value", value: data.taxable_value },
        { metric: "GST Payable", value: data.gst_payable },
        { metric: "GST Receivable", value: data.gst_receivable },
      ],
      [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Amount" },
      ],
      `GST_Report_${year}`
    );
  };

  const exportPdf = () => {
    exportToPdf(
      [
        { metric: "SGST", value: formatInr(data.sgst) },
        { metric: "CGST", value: formatInr(data.cgst) },
        { metric: "IGST", value: formatInr(data.igst) },
        { metric: "Total GST", value: formatInr(data.total_gst) },
        { metric: "Taxable Value", value: formatInr(data.taxable_value) },
      ],
      [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Amount" },
      ],
      `GST Report ${year}`,
      `GST_Report_${year}`
    );
  };

  if (loading) return <Loader label="Loading GST reports..." />;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        subtitle="GSTR-1, GSTR-2B, GSTR-3B, GSTR-9, HSN & SAC summaries with trend analysis."
        action={
          <>
            <ExportButtons onExcel={exportExcel} onPdf={exportPdf} />
          </>
        }
      />

      <div className="ui-grid-kpi">
        <KpiCard label="State Goods & Services Tax (SGST)" value={formatInr(data.sgst)} icon={IndianRupee} color="bg-indigo-600" />
        <KpiCard label="Central Goods & Services Tax (CGST)" value={formatInr(data.cgst)} icon={IndianRupee} color="bg-purple-600" />
        <KpiCard label="Integrated Goods & Services Tax (IGST)" value={formatInr(data.igst)} icon={IndianRupee} color="bg-pink-600" />
        <KpiCard label="Total Goods & Services Tax (GST)" value={formatInr(data.total_gst)} icon={IndianRupee} color="bg-[var(--color-primary)]" highlight />
        <KpiCard label="Taxable Value" value={formatInr(data.taxable_value)} icon={FileText} color="bg-slate-600" />
        <KpiCard label="Goods & Services Tax (GST) Payable" value={formatInr(data.gst_payable)} icon={IndianRupee} color="bg-red-500" />
        <KpiCard label="Goods & Services Tax (GST) Receivable" value={formatInr(data.gst_receivable)} icon={IndianRupee} color="bg-green-600" />
      </div>

      <FinanceFilters
        search={search}
        onSearchChange={setSearch}
        financialYear={financialYear}
        onFinancialYearChange={setFinancialYear}
        month={month}
        onMonthChange={setMonth}
        branch={branch}
        onBranchChange={setBranch}
        searchPlaceholder="Search"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Year</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {[2026, 2025, 2024, 2023].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </FinanceFilters>

      <div className="flex flex-wrap gap-2">
        {GST_REPORTS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setActiveReport(r)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeReport === r ? "bg-[var(--color-primary)] text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="ui-card p-5">
        <h2 className="mb-2 font-semibold text-slate-900">{activeReport}</h2>
        <p className="text-sm text-slate-500">Summary for FY {financialYear} — {formatInr(data.total_gst)} total GST collected.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="ui-card p-5">
          <h2 className="ui-section-title mb-4">Monthly GST Collection</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly_collection || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatInr(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatInr(v)} />
                <Bar dataKey="amount" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="ui-card p-5">
          <h2 className="ui-section-title mb-4">GST Trend</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.gst_trend || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatInr(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatInr(v)} />
                <Legend />
                <Line type="monotone" dataKey="sgst" name="SGST" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cgst" name="CGST" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="igst" name="IGST" stroke="#ec4899" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="ui-card p-5">
          <h2 className="ui-section-title mb-4">GST by Customer</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.gst_by_customer || []} dataKey="gst" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name }) => name}>
                  {(data.gst_by_customer || []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatInr(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="ui-card p-5">
          <h2 className="ui-section-title mb-4">GST by Product</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.gst_by_product || []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v) => formatInr(v)} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatInr(v)} />
                <Bar dataKey="gst" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}