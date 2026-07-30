"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { createBrowserClient } from "@/lib/supabase";
import { currentMonth, monthBounds, isFullMonth, toISODate } from "@/lib/format";
import { computeAggregate, Aggregate } from "@/lib/metrics";
import type { DailyMetric, ChannelSales, BestSeller } from "@/lib/types";

interface TrafficRow {
  traffic_date: string;
  visitors: number;
  sessions: number;
  add_to_cart: number;
  reached_checkout: number;
  updated_at: string;
}

interface MonthlyTraffic {
  month: string;
  visitors: number;
  sessions: number;
  add_to_cart: number;
  reached_checkout: number;
}

/** Totals for the comparison period, so each KPI can show a vs-last-month delta. */
export interface PrevPeriod {
  label: string; // "2026-06" for a full month, else "2026-06-24 → 2026-06-30"
  salesAfter: number;
  orders: number;
  offlineAmount: number;
  offlineInvoices: number;
  abandonedCount: number;
}

/**
 * The period each KPI is compared against: the previous calendar month when the
 * selected range is exactly one month, otherwise the equally-long window
 * immediately before it (so a 7-day range compares to the 7 days before it).
 */
function previousRange(start: string, end: string): { start: string; end: string } {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (isFullMonth(start, end)) {
    const pm = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1));
    return monthBounds(`${pm.getUTCFullYear()}-${String(pm.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const pEnd = new Date(s.getTime() - 86_400_000);
  const pStart = new Date(pEnd.getTime() - (days - 1) * 86_400_000);
  return { start: toISODate(pStart), end: toISODate(pEnd) };
}

interface DashState {
  month: string;
  setMonth: (m: string) => void;
  range: { start: string; end: string };
  setRange: (start: string, end: string) => void;
  rangeLabel: string;
  metrics: DailyMetric[];
  channels: ChannelSales[];
  bestSellers: BestSeller[];
  traffic: TrafficRow[];
  monthlyTraffic: MonthlyTraffic | null;
  abandonedCount: number; // real Shopify abandoned checkouts in the month
  abandonedValue: number;
  offlineAmount: number; // Odoo استهلاكي sales in range (net of refunds)
  offlineInvoices: number;
  offlineDaily: { day: string; amount: number; invoices: number }[]; // per-day Odoo
  prev: PrevPeriod | null; // comparison period (see previousRange)
  agg: Aggregate;
  days: string[];
  lastSync: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<DashState | null>(null);

export function useDash() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDash must be used inside <DataProvider>");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [range, setRangeState] = useState<{ start: string; end: string }>(() =>
    monthBounds(currentMonth())
  );
  const month = range.start.slice(0, 7);
  const setMonth = useCallback((m: string) => setRangeState(monthBounds(m)), []);
  const setRange = useCallback((start: string, end: string) => {
    // guard against reversed input
    if (start > end) setRangeState({ start: end, end: start });
    else setRangeState({ start, end });
  }, []);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [channels, setChannels] = useState<ChannelSales[]>([]);
  const [bestSellers, setBestSellers] = useState<BestSeller[]>([]);
  const [traffic, setTraffic] = useState<TrafficRow[]>([]);
  const [monthlyTraffic, setMonthlyTraffic] = useState<MonthlyTraffic | null>(null);
  const [abandonedCount, setAbandonedCount] = useState(0);
  const [abandonedValue, setAbandonedValue] = useState(0);
  const [offlineAmount, setOfflineAmount] = useState(0);
  const [offlineInvoices, setOfflineInvoices] = useState(0);
  const [offlineDaily, setOfflineDaily] = useState<
    { day: string; amount: number; invoices: number }[]
  >([]);
  const [prev, setPrev] = useState<PrevPeriod | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = range;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pr = previousRange(start, end);
      const [mRes, cRes, bRes, tRes, mtRes, sRes, oRes, pmRes, poRes] = await Promise.all([
        supabase.from("daily_metrics").select("*").gte("day", start).lte("day", end).order("day"),
        supabase
          .from("daily_orders_by_channel")
          .select("*")
          .gte("order_date", start)
          .lte("order_date", end),
        supabase.rpc("best_selling_products", { start_date: start, end_date: end, max_rows: 50 }),
        supabase
          .from("daily_traffic")
          .select("*")
          .gte("traffic_date", start)
          .lte("traffic_date", end),
        supabase.from("monthly_traffic").select("*").eq("month", month).maybeSingle(),
        supabase.from("sync_state").select("last_run_at").eq("id", "orders").single(),
        supabase
          .from("offline_sales")
          .select("day,amount,invoices")
          .gte("day", start)
          .lte("day", end),
        // --- comparison period (previous month / preceding window) ---
        supabase.from("daily_metrics").select("*").gte("day", pr.start).lte("day", pr.end).order("day"),
        supabase.from("offline_sales").select("day,amount,invoices").gte("day", pr.start).lte("day", pr.end),
      ]);
      if (mRes.error) throw mRes.error;
      if (cRes.error) throw cRes.error;
      if (bRes.error) throw bRes.error;

      setMetrics((mRes.data as DailyMetric[]) ?? []);
      setChannels((cRes.data as ChannelSales[]) ?? []);
      setBestSellers((bRes.data as BestSeller[]) ?? []);
      setTraffic((tRes.data as TrafficRow[]) ?? []);
      setMonthlyTraffic((mtRes.data as MonthlyTraffic) ?? null);
      setLastSync(sRes.data?.last_run_at ?? null);
      const off = (oRes.data as { day: string; amount: number; invoices: number }[]) ?? [];
      setOfflineAmount(off.reduce((s, r) => s + Number(r.amount || 0), 0));
      setOfflineInvoices(off.reduce((s, r) => s + Number(r.invoices || 0), 0));
      setOfflineDaily(
        off.map((r) => ({ day: r.day, amount: Number(r.amount || 0), invoices: Number(r.invoices || 0) }))
      );

      // Comparison-period totals (abandoned is filled in below, once fetched).
      const prevAgg = computeAggregate((pmRes.data as DailyMetric[]) ?? []);
      const prevOff = (poRes.data as { amount: number; invoices: number }[]) ?? [];
      const prevBase = {
        label: isFullMonth(pr.start, pr.end) ? pr.start.slice(0, 7) : `${pr.start} → ${pr.end}`,
        salesAfter: Number(prevAgg.total_sales) || 0,
        orders: prevAgg.orders_count,
        offlineAmount: prevOff.reduce((s, r) => s + Number(r.amount || 0), 0),
        offlineInvoices: prevOff.reduce((s, r) => s + Number(r.invoices || 0), 0),
      };

      // Real abandoned checkouts from Shopify, filtered to the selected month.
      try {
        const abRes = await fetch("/api/abandoned?summary=1");
        const abJson = await abRes.json();
        const list: { created_at: string; total_price: number }[] = abJson.checkouts ?? [];
        const within = (a: string, b: string) =>
          list.filter((c) => {
            const d = (c.created_at || "").slice(0, 10);
            return d >= a && d <= b;
          });
        const inMonth = within(start, end);
        setAbandonedCount(inMonth.length);
        setAbandonedValue(inMonth.reduce((s, c) => s + Number(c.total_price || 0), 0));
        setPrev({ ...prevBase, abandonedCount: within(pr.start, pr.end).length });
      } catch {
        setAbandonedCount(0);
        setAbandonedValue(0);
        setPrev({ ...prevBase, abandonedCount: 0 });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [supabase, start, end, month]);

  useEffect(() => {
    reload();
  }, [reload]);

  const fullMonth = isFullMonth(start, end);
  const agg = useMemo(() => {
    const base = computeAggregate(metrics);
    // Imported monthly traffic total overrides summed daily traffic, but ONLY
    // when the range is exactly that whole month (otherwise use daily sums).
    if (monthlyTraffic && fullMonth) {
      base.visitors = monthlyTraffic.visitors;
      base.sessions = monthlyTraffic.sessions;
      base.add_to_cart = monthlyTraffic.add_to_cart;
      base.reached_checkout = monthlyTraffic.reached_checkout;
      base.checkout_count = Math.max(monthlyTraffic.reached_checkout - base.orders_count, 0);
    }
    return base;
  }, [metrics, monthlyTraffic, fullMonth]);
  const days = useMemo(() => metrics.map((m) => m.day), [metrics]);

  const rangeLabel = fullMonth ? month : `${start} → ${end}`;

  const value: DashState = {
    month,
    setMonth,
    range,
    setRange,
    rangeLabel,
    metrics,
    channels,
    bestSellers,
    traffic,
    monthlyTraffic,
    abandonedCount,
    abandonedValue,
    offlineAmount,
    offlineInvoices,
    offlineDaily,
    prev,
    agg,
    days,
    lastSync,
    loading,
    error,
    reload,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
