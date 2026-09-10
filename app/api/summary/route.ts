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

    // --- Cashback: website orders redeeming an auto-issued cashback voucher.
    // Only the discount_codes slice of the raw Shopify payload is projected,
    // so this stays a small read even over a two-month window. ---
    const { data: cbRows } = await sb
      .from("orders")
      .select("order_date,total_price,total_discounts,codes:raw->discount_codes")
      .eq("channel", "online")
      .gte("order_date", fetchFrom)
      .lte("order_date", to);
    // One entry per redeeming order: the day and what the order was worth
    // before any discount (total_price is already net of them, so add them
    // back). Pre-discount keeps this comparable with the branches'
    // invoice_amount, which is likewise the invoice the 5% was taken from.
    type CbRow = {
      order_date: string;
      total_price: number;
      total_discounts: number;
      codes: { code?: string }[] | null;
    };
    const cashbackOrders = ((cbRows ?? []) as CbRow[])
      .filter((o) => (o.codes ?? []).some((d) => CASHBACK_RE.test((d?.code ?? "").trim())))
      .map((o) => ({
        day: (o.order_date ?? "").slice(0, 10),
        value: Number(o.total_price || 0) + Number(o.total_discounts || 0),
      }));

    // --- Cashback issued at the branches (Odoo ns_loyalty_cashback).
    // A coupon is EARNED here (5% of a branch invoice) and redeemed later,
    // mostly on the website — so this is the other half of the cashback story,
    // not the same number as the redemption rows above. Missing table (before
    // migration_v11 is run) degrades to zero rather than failing the page. ---
    const { data: cbIssuedRows } = await sb
      .from("cashback_coupons")
      .select("issued_day,branch,discount_amount,invoice_amount,used")
      .gte("issued_day", fetchFrom)
      .lte("issued_day", to);
    const issued = ((cbIssuedRows ?? []) as {
      issued_day: string;
      branch: string | null;
      discount_amount: number;
      invoice_amount: number;
      used: boolean;
    }[]).map((r) => ({
      day: (r.issued_day ?? "").slice(0, 10),
      branch: r.branch ?? "",
      value: Number(r.invoice_amount || 0), // what the order itself was worth
      amount: Number(r.discount_amount || 0), // the 5% it earned
      used: Boolean(r.used),
    }));

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
     * Cashback orders for one window, offline and online in the same two rows:
     *  - branch columns = branch orders that earned a voucher (Odoo)
     *  - Website        = orders that paid with one (Shopify)
     * `value` is the order before any discount on both sides, so the two are
     * comparable. Total counts every branch, including the 20-odd that have no
     * sales rows and so get no column of their own.
     */
    const cashbackAgg = (pf: string, pt: string) => {
      const out: Record<string, { orders: number; value: number }> = {};
      for (const label of branchLabels) out[label] = { orders: 0, value: 0 };
      let tOrders = 0;
      let tValue = 0;

      for (const c of issued) {
        if (c.day < pf || c.day > pt) continue;
        tOrders += 1;
        tValue += c.value;
        const col = rawToColumn.get(c.branch);
        if (col && out[col]) {
          out[col].orders += 1;
          out[col].value += c.value;
        }
      }

      const web = cashbackOrders.filter((o) => o.day >= pf && o.day <= pt);
      out[WEBSITE] = { orders: web.length, value: web.reduce((s, o) => s + o.value, 0) };
      tOrders += web.length;
      tValue += out[WEBSITE].value;

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
      cashback: cashbackAgg(from, to), // cashback orders for the picked day/range
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
