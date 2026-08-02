import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { shiftMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Channel summary (like the ops sheet): orders + value per channel for the
 * selected period, MTD and last month.
 *  - Physical branches (Maadi, Semoha, …) come from the Odoo NS Home invoices.
 *  - Online ("Website") comes from Shopify (daily_metrics: total_sales,
 *    orders_count) — the same numbers as the rest of the dashboard.
 * ?day=YYYY-MM-DD for a single day, or ?from=&to= for a range.
 */

const WEBSITE = "Website";
const KNOWN: { test: (b: string) => boolean; label: string }[] = [
  { test: (b) => b.includes("المعادي") || b.includes("زهراء"), label: "Maadi" },
  { test: (b) => b.includes("سموحة") || b.includes("الاسكندر"), label: "Semoha" },
];
function branchLabel(branch: string): string {
  return KNOWN.find((k) => k.test(branch))?.label ?? branch ?? "—";
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}


export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const day = sp.get("day");
    const from = sp.get("from") || day || ymd(new Date());
    const to = sp.get("to") || day || from;

    // Reference = end date → derive MTD and last-month windows from it.
    const [ey, em] = to.split("-").map(Number);
    const monthStart = `${ey}-${String(em).padStart(2, "0")}-01`;
    const lm = new Date(Date.UTC(ey, em - 2, 1)); // previous month
    const lmStart = ymd(new Date(Date.UTC(lm.getUTCFullYear(), lm.getUTCMonth(), 1)));

    // "Last month" = the SAME day (or the same range) one month back — not the
    // whole month. Picking 2 Aug compares against 2 Jul, so the row is a like
    // for like figure rather than a 31-day total the day can never reach.
    const lmFrom = shiftMonth(from, -1);
    const lmTo = shiftMonth(to, -1);
    // MTD, however, needs last month measured to the same point in the month,
    // so "MTD vs last month" compares 1–2 Jul against 1–2 Aug.
    const lmMtdEnd = lmTo;

    const fetchFrom = [from, monthStart, lmStart, lmFrom].sort()[0];
    const sb = createServiceClient();

    // --- Branches: pre-aggregated per-day/branch (offline_branch_sales).
    // orders already exclude refunds; value is refund-signed. Read from
    // Supabase — fast — instead of hitting Odoo live (which times out). ---
    const { data: brData } = await sb
      .from("offline_branch_sales")
      .select("day,branch,orders,value")
      .gte("day", fetchFrom)
      .lte("day", to);
    const branchRows = ((brData ?? []) as { day: string; branch: string; orders: number; value: number }[]).map(
      (r) => ({ ...r, label: branchLabel(r.branch) })
    );

    // --- Online: Shopify daily_metrics (same source as the dashboard) ---
    const { data: dmRows } = await sb
      .from("daily_metrics")
      .select("day,total_sales,orders_count")
      .gte("day", fetchFrom)
      .lte("day", to);
    const online = (dmRows ?? []) as { day: string; total_sales: number; orders_count: number }[];

    // Channels: physical branches (sorted) first, then Website (online).
    const branchLabels = [...new Set(branchRows.map((r) => r.label))].sort((a, b) => a.localeCompare(b));
    const channels = [
      ...branchLabels.map((label) => ({ label, type: "Branches" as const })),
      { label: WEBSITE, type: "Online" as const },
    ];

    const periodAgg = (pf: string, pt: string) => {
      const res: Record<string, { orders: number; value: number }> = {};
      for (const label of branchLabels) res[label] = { orders: 0, value: 0 };
      for (const r of branchRows) {
        const d = (r.day ?? "").slice(0, 10);
        if (d < pf || d > pt) continue;
        res[r.label].orders += Number(r.orders || 0);
        res[r.label].value += Number(r.value || 0);
      }
      // Online from Shopify daily_metrics
      let webOrders = 0;
      let webValue = 0;
      for (const m of online) {
        const d = (m.day ?? "").slice(0, 10);
        if (d < pf || d > pt) continue;
        webOrders += Number(m.orders_count || 0);
        webValue += Number(m.total_sales || 0);
      }

      const out: Record<string, { orders: number; value: number }> = {};
      let tOrders = 0;
      let tValue = 0;
      for (const label of branchLabels) {
        out[label] = { orders: res[label].orders, value: res[label].value };
        tOrders += res[label].orders;
        tValue += res[label].value;
      }
      out[WEBSITE] = { orders: webOrders, value: webValue };
      tOrders += webOrders;
      tValue += webValue;
      out.Total = { orders: tOrders, value: tValue };
      return out;
    };

    return NextResponse.json({
      ok: true,
      channels,
      period: periodAgg(from, to),
      mtd: periodAgg(monthStart, to),
      lastMonth: periodAgg(lmFrom, lmTo), // same day/range, one month back
      lastMonthMtd: periodAgg(lmStart, lmMtdEnd), // last month to the same day
      meta: {
        from,
        to,
        monthStart,
        lmFrom,
        lmTo,
        lmStart,
        lmMtdEnd,
        single: from === to,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
