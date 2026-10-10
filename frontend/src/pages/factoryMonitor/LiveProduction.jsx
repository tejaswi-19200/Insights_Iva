import { useCallback, useEffect, useState } from "react";
import usePageRefresh from "../../hooks/usePageRefresh";
import { Link } from "react-router-dom";
import { AlertTriangle, Cpu, Factory, Target, Trash2, Users, Zap } from "lucide-react";
import KpiCard from "../../components/common/KpiCard";

import DataTable from "../../components/common/DataTable";
import Loader from "../../components/common/Loader";
import { useToast } from "../../context/ToastContext";
import {
  getShopFloorAlerts,
  getShopFloorGrid,
  getShopFloorSummary,
  getShopFloorTimeline,
} from "../../api/factoryMonitorApi";
import {
  DEMO_MACHINE_LAYOUT,
  DEMO_SHOP_ALERTS,
  DEMO_SHOP_GRID,
  DEMO_SHOP_SUMMARY,
  DEMO_SHOP_TIMELINE,
  SHOP_FLOW_STEPS,
  shopStatusDot,
  shopStatusLabel,
} from "../../data/shopFloorMasterData";


export default function LiveProduction() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ total_machines: 0, running: 0, idle: 0, breakdown: 0, efficiency_percentage: 0 });
  const [grid, setGrid] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [layout, setLayout] = useState([]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [sumRes, gridRes, alertRes, timeRes] = await Promise.allSettled([
        getShopFloorSummary(),
        getShopFloorGrid(),
        getShopFloorAlerts(),
        getShopFloorTimeline(),
      ]);

      if (sumRes.status === "fulfilled" && sumRes.value?.data) {
        setSummary(sumRes.value.data);
      } else {
        setSummary({ total_machines: 0, running: 0, idle: 0, breakdown: 0, efficiency_percentage: 0 });
      }
      if (gridRes.status === "fulfilled" && gridRes.value?.data?.length) {
        setGrid(gridRes.value.data);
        setLayout(
          gridRes.value.data.map((r) => ({
            id: r.machine_id,
            name: r.machine_name,
            status: r.status,
          }))
        );
      } else {
        setGrid([]);
        setLayout([]);
      }
      if (alertRes.status === "fulfilled" && alertRes.value?.data?.length) {
        setAlerts(alertRes.value.data);
      } else {
        setAlerts([]);
      }
      if (timeRes.status === "fulfilled" && timeRes.value?.data?.length) {
        setTimeline(timeRes.value.data);
      } else {
        setTimeline([]);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  usePageRefresh(() => load(true));

  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: "machine_name", label: "Machine" },
    { key: "work_order_number", label: "Work Order", render: (r) => r.work_order_number || "—" },
    { key: "product_name", label: "Product", render: (r) => r.product_name || "—" },
    { key: "operator_name", label: "Operator", render: (r) => r.operator_name || r.assigned_operator || r.operator || "—" },
    { key: "shift", label: "Shift", render: (r) => typeof (r.shift || r.current_shift) === "object" ? (r.shift?.label || r.shift?.id || r.current_shift?.label || r.current_shift?.id || "—") : (r.shift || r.current_shift || "—") },
    {
      key: "progress_pct",
      label: "Progress",
      render: (r) => (
        <div className="min-w-[90px]">
          <div className="mb-0.5 text-xs text-slate-500">{r.progress_pct}%</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-[var(--color-success-soft)]0" style={{ width: `${r.progress_pct}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <span className="text-sm font-medium">
          {shopStatusDot(r.status)} {shopStatusLabel(r.status)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Action",
      render: (r) =>
        r.work_order_id ? (
          <Link to={`/production/work-orders`} className="text-xs font-semibold text-[#2563EB] hover:underline">
            View
          </Link>
        ) : (
          <Link to="/production/tasks" className="text-xs font-semibold text-amber-600 hover:underline">
            Assign
          </Link>
        ),
    },
  ];

  if (loading) return <Loader label="Loading shop floor..." />;

  return (
    <div className="min-h-full pb-8 print:p-0" style={{ background: "#F5F5F5" }}>
      <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <div>
          <p className="mt-0.5 text-xs text-slate-500 print:hidden">
            Live production grid, machine layout, alerts, and real-time shop floor monitoring.
          </p>
        </div>

        <div className="mb-0 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <div className="flex flex-wrap gap-2">
            <Link to="/production" className="inline-flex items-center gap-1.5 rounded-lg border border-[#e4e4ea] bg-[#f3f3f6] px-3.5 py-2 text-[13px] font-semibold text-[#1a1a1f] hover:bg-[#ececf0]">
              <Factory className="h-4 w-4" /> Production Hub
            </Link>
          </div>
        </div>

      <div className="ui-grid-kpi">
        <KpiCard label="Running Jobs" value={summary.running_jobs} icon={Factory} color="bg-teal-600" />
        <KpiCard label="Active Machines" value={summary.active_machines} icon={Cpu} color="bg-[var(--color-primary)]" />
        <KpiCard label="Operators Working" value={summary.operators_working} icon={Users} color="bg-indigo-500" />
        <KpiCard label="Today's Production" value={summary.todays_production?.toLocaleString()} icon={Zap} color="bg-green-500" />
        <KpiCard label="Today's Target" value={summary.todays_target?.toLocaleString()} icon={Target} color="bg-amber-500" />
        <KpiCard label="Scrap Qty" value={summary.scrap_qty} icon={Trash2} color="bg-orange-500" />
        <KpiCard label="Downtime" value={`${summary.downtime_minutes} min`} icon={AlertTriangle} color="bg-red-500" />
        <KpiCard label="OEE %" value={`${summary.oee_pct}%`} icon={Zap} color="bg-violet-500" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-800">Live Production Grid</h2>
            <DataTable columns={columns} data={grid} searchKeys={["machine_name", "work_order_number", "product_name"]} showPagination={false} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-sm font-bold text-slate-800">Production Timeline</h2>
            <div className="space-y-3">
              {timeline.map((block, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="w-14 text-xs font-semibold text-slate-500">{block.slot}</span>
                  <div className="flex-1">
                    <div
                      className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white"
                      style={{ width: `${(block.span_slots / 3) * 100}%`, minWidth: "120px" }}
                    >
                      {block.product_name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-amber-900">Live Alerts</h3>
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {a.message}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-800">Factory Layout</h3>
            <div className="grid grid-cols-2 gap-3">
              {layout.map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-700">{m.name}</p>
                  <p className="mt-1 text-lg">{shopStatusDot(m.status)}</p>
                  <p className="text-[10px] capitalize text-slate-500">{shopStatusLabel(m.status)}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 px-4 py-3">
        {SHOP_FLOW_STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-teal-600">{step}</span>
            {i < SHOP_FLOW_STEPS.length - 1 && <span className="text-slate-300">↓</span>}
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}
