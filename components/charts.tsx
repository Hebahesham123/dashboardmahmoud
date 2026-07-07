"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { DailyMetric } from "@/lib/types";
import { fmtMoney, fmtNum } from "@/lib/format";

const mmdd = (iso: string) => iso.slice(5);

/** Sales (bars) + Orders (line) over the month. */
export function SalesTrend({ data }: { data: DailyMetric[] }) {
  const d = data.map((m) => ({
    date: mmdd(m.day),
    sales: Number(m.total_sales),
    orders: Number(m.orders_count),
  }));
  return (
    <div className="h-72 w-full px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={d} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis yAxisId="l" fontSize={11} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="r" orientation="right" fontSize={11} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            formatter={(v: number, n: string) => (n === "Sales" ? fmtMoney(v) : fmtNum(v))}
            contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="l" dataKey="sales" name="Sales" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line yAxisId="r" type="monotone" dataKey="orders" name="Orders" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sessions vs Visitors area chart. */
export function TrafficTrend({ data }: { data: DailyMetric[] }) {
  const d = data.map((m) => ({
    date: mmdd(m.day),
    sessions: Number(m.sessions),
    visitors: Number(m.visitors),
  }));
  return (
    <div className="h-72 w-full px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gSess" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gVis" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#0ea5e9" fill="url(#gSess)" strokeWidth={2} />
          <Area type="monotone" dataKey="visitors" name="Visitors" stroke="#8b5cf6" fill="url(#gVis)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Conversion-rate line over time (%). */
/** Daily unique visitors & sessions (bars) + visitors-per-session (line). */
export function VisitorsPerSession({ data }: { data: DailyMetric[] }) {
  const d = data.map((m) => {
    const v = Number(m.visitors);
    const s = Number(m.sessions);
    return {
      date: mmdd(m.day),
      visitors: v,
      sessions: s,
      perSession: s > 0 ? Number((v / s).toFixed(2)) : 0, // unique visitors per session
    };
  });
  return (
    <div className="h-72 w-full px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={d} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis yAxisId="l" fontSize={11} tickLine={false} axisLine={false} width={40} />
          <YAxis yAxisId="r" orientation="right" fontSize={11} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="l" dataKey="visitors" name="Unique Visitors" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="l" dataKey="sessions" name="Sessions" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="perSession" name="Visitors / Session" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ConversionTrend({ data }: { data: DailyMetric[] }) {
  const d = data.map((m) => ({
    date: mmdd(m.day),
    conv: Number((m.conversion_rate * 100).toFixed(2)),
  }));
  return (
    <div className="h-72 w-full px-2 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={d} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gConv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis fontSize={11} tickLine={false} axisLine={false} width={40} unit="%" />
          <Tooltip
            formatter={(v: number) => `${v}%`}
            contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
          />
          <Area type="monotone" dataKey="conv" name="Conversion %" stroke="#10b981" fill="url(#gConv)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Conversion funnel: Visitors → Sessions → Cart → Checkout → Orders. */
export function FunnelBars({
  steps,
}: {
  steps: { label: string; value: number }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  const colors = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#f97316", "#10b981"];
  return (
    <div className="space-y-3 p-5">
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100;
        const conv = i === 0 ? 100 : (s.value / (steps[0].value || 1)) * 100;
        return (
          <div key={s.label}>
            <div className="mb-1 flex justify-between text-xs text-gray-600">
              <span className="font-medium">{s.label}</span>
              <span>
                {fmtNum(s.value)} <span className="text-gray-400">({conv.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-lg bg-gray-100">
              <div
                className="flex h-full items-center rounded-lg transition-all"
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: colors[i % colors.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Online vs Offline donut. */
export function ChannelDonut({ online, offline }: { online: number; offline: number }) {
  const data = [
    { name: "Online", value: online },
    { name: "Offline", value: offline },
  ];
  const colors = ["#6366f1", "#cbd5e1"];
  const total = online + offline;
  return (
    <div className="relative h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 top-[-28px] flex flex-col items-center justify-center">
        <span className="text-[11px] text-gray-400">Total</span>
        <span className="text-sm font-bold text-gray-800">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}
