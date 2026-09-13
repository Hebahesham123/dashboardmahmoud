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

/**
 * Cashback discount codes. The loyalty app issues a one-off voucher per
 * customer whose code is an auto-generated "044d-4fc8-42c8" triplet, unlike
 * the hand-made marketing codes (NS-15H, HomeVIP, …). Set
 * CASHBACK_CODE_PATTERN to override the match without touching this file.
 */
const CASHBACK_RE = new RegExp(
  process.env.CASHBACK_CODE_PATTERN || "^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$|cashback",
  "i"
);


/**
 * PostgREST caps a response at 1000 rows whatever `limit` says, so anything
 * that can exceed that has to be walked a page at a time. cashback_coupons
 * passed 1000 within a fortnight of the module going live.
 */
async function pageAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await build().range(page * size, page * size + size - 1);
    if (error) return all; // missing table / permission — degrade to what we have
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
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

    // --- Orders that PAID with a cashback voucher, both ways.
    // Online: the voucher code lands in the Shopify order's discount_codes.
    // Offline: Odoo puts the redemption on the redeeming invoice as a negative
    // "per point" line, which /api/sync-cashback stores per invoice.
    // Everything below is counted on the day the purchase happened, so all
    // three rows describe one set of orders. ---
    type CbRow = {
      order_date: string;
      total_price: number;
      total_discounts: number;
      codes: { code?: string; amount?: string }[] | null;
    };
    const redeemRows = await pageAll<CbRow>(() =>
      sb
        .from("orders")
        .select("order_date,total_price,total_discounts,codes:raw->discount_codes")
        .eq("channel", "online")
        .gte("order_date", fetchFrom)
        .lte("order_date", to)
    );
    const onlineCashback = redeemRows
      .map((o) => {
        const hits = (o.codes ?? []).filter((d) => CASHBACK_RE.test((d?.code ?? "").trim()));
        return {
          day: (o.order_date ?? "").slice(0, 10),
          // The order before any discount, so it is the same measure as the
          // branches' invoice_gross.
          purchase: Number(o.total_price || 0) + Number(o.total_discounts || 0),
          // What the voucher actually covered — can be under its face value.
          spent: hits.reduce((sum, d) => sum + Number(d.amount || 0), 0),
          hit: hits.length > 0,
        };
      })
      .filter((o) => o.hit);

    // Missing table (before migration_v12 is run) degrades to zero rather than
    // failing the page.
    const offlineCashback = await pageAll<{
      day: string;
      branch: string | null;
      cashback_used: number;
      invoice_gross: number;
    }>(() =>
      sb
        .from("cashback_redemptions")
        .select("day,branch,cashback_used,invoice_gross")
        .gte("day", fetchFrom)
        .lte("day", to)
    );

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

    // Map a raw Odoo branch name to the column it belongs to, learnt from the
    // sales rows themselves. branchLabel()'s fuzzy tests can't be used here:
    // cashback runs at 20+ branches and "فرع الاسكندرية" and
    // "فرع الاسكندرية-سموحة" would both collapse into Semoha.
    const rawToColumn = new Map(branchRows.map((r) => [r.branch, r.label]));

    /**
     * Cashback orders for one window, counted on the day of the purchase:
     * how many there were, how much cashback they spent, and what they came
     * to. Branch columns are shop redemptions, Website is online ones, and
     * every row describes the same set of orders — so the three read down a
     * column together instead of one of them answering a different question.
     *
     * Branch columns exist only for branches that also have sales rows, so
     * Total covers them all and can exceed the columns beside it.
     */
    const cashbackAgg = (pf: string, pt: string) => {
      const blank = () => ({ orders: 0, spent: 0, purchases: 0 });
      const out: Record<string, ReturnType<typeof blank>> = {};
      for (const label of branchLabels) out[label] = blank();
      const total = blank();

      for (const r of offlineCashback) {
        const day = (r.day ?? "").slice(0, 10);
        if (day < pf || day > pt) continue;
        const used = Number(r.cashback_used || 0);
        const gross = Number(r.invoice_gross || 0);
        total.orders += 1;
        total.spent += used;
        total.purchases += gross;
        const col = rawToColumn.get(r.branch ?? "");
        if (col && out[col]) {
          out[col].orders += 1;
          out[col].spent += used;
          out[col].purchases += gross;
        }
      }

      const web = blank();
      for (const o of onlineCashback) {
        if (o.day < pf || o.day > pt) continue;
        web.orders += 1;
        web.spent += o.spent;
        web.purchases += o.purchase;
      }
      out[WEBSITE] = web;
      total.orders += web.orders;
      total.spent += web.spent;
      total.purchases += web.purchases;
      out.Total = total;

      // One block per row the table draws, so the client stays a dumb printer.
      const pick = (k: "orders" | "spent" | "purchases") => {
        const b: Record<string, { orders: number; value: number }> = {};
        for (const [col, v] of Object.entries(out)) {
          b[col] = { orders: k === "orders" ? v.orders : 0, value: k === "orders" ? 0 : v[k] };
        }
        return b;
      };
      return { orders: pick("orders"), spent: pick("spent"), purchases: pick("purchases") };
    };

    return NextResponse.json({
      ok: true,
      channels,
      period: periodAgg(from, to),
      mtd: periodAgg(monthStart, to),
      lastMonth: periodAgg(lmFrom, lmTo), // same day/range, one month back
      lastMonthMtd: periodAgg(lmStart, lmMtdEnd), // last month to the same day
      cashback: cashbackAgg(from, to),
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
