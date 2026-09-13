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

    // --- Orders that PAID with a cashback voucher. These are website orders:
    // the coupon code lands in the Shopify order's discount_codes. `purchase`
    // is the order before any discount; `spent` is what the voucher actually
    // covered, which can be under its face value (915.81 applied as 899). ---
    type CbRow = {
      order_date: string;
      total_price: number;
      total_discounts: number;
      codes: { code?: string; amount?: string }[] | null;
    };
    // Read to today, not to `to`: a voucher issued inside the window is often
    // spent after it, and "how much of what we gave has come back" has to count
    // that. `spent` is what Shopify actually applied, which can be under the
    // voucher's face value (915.81 applied as 899) but never over it.
    const redeemRows = await pageAll<CbRow>(() =>
      sb
        .from("orders")
        .select("order_date,total_price,total_discounts,codes:raw->discount_codes")
        .eq("channel", "online")
        .gte("order_date", fetchFrom)
    );
    const cashbackOrders = redeemRows
      .map((o) => ({
        purchase: Number(o.total_price || 0) + Number(o.total_discounts || 0),
        hits: (o.codes ?? [])
          .filter((d) => CASHBACK_RE.test((d?.code ?? "").trim()))
          .map((d) => ({ code: (d.code ?? "").trim().toLowerCase(), amount: Number(d.amount || 0) })),
      }))
      .filter((o) => o.hits.length > 0);

    // How much has come back on each individual voucher.
    const spentByCode = new Map<string, number>();
    for (const o of cashbackOrders) {
      for (const h of o.hits) spentByCode.set(h.code, (spentByCode.get(h.code) ?? 0) + h.amount);
    }

    // --- Cashback issued at the branches (Odoo ns_loyalty_cashback).
    // A coupon is EARNED here (5% of a branch invoice) and redeemed later,
    // mostly on the website — so this is the other half of the cashback story,
    // not the same number as the redemption rows above. Missing table (before
    // migration_v11 is run) degrades to zero rather than failing the page. ---
    const cbIssuedRows = await pageAll<{
      issued_day: string;
      branch: string | null;
      code: string;
      discount_amount: number;
    }>(() =>
      sb
        .from("cashback_coupons")
        .select("issued_day,branch,code,discount_amount")
        .gte("issued_day", fetchFrom)
        .lte("issued_day", to)
    );
    const issued = cbIssuedRows.map((r) => ({
      day: (r.issued_day ?? "").slice(0, 10),
      branch: r.branch ?? "",
      earned: Number(r.discount_amount || 0), // the 5% put on the voucher
      code: (r.code ?? "").trim().toLowerCase(),
      // What has come back on this very voucher — so used can never outrun
      // earned, however long after the window it was spent.
      spent: spentByCode.get((r.code ?? "").trim().toLowerCase()) ?? 0,
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
     * Cashback for one window. Each row sits where the thing it measures
     * actually happens, which is why a row is filled on one side and blank on
     * the other — cashback is earned in the shops and spent on the website.
     *
     * All three follow ONE set of vouchers: the ones the shop issued inside the
     * window. Measuring Used against whatever was spent in the window instead
     * let a shop that gave 1,000 show 2,000 used, because the extra came from
     * older vouchers. Tying them together makes Used ≤ Earned by construction.
     *
     *  earned    — the 5% put onto those vouchers
     *  spent     — how much of them has come back, whenever it was spent, and
     *              the amount actually applied: handed 5,000, spends 4,000,
     *              counts as 4,000
     *  purchases — what the orders those vouchers paid for were worth
     *
     * Earned shows under the shops that gave the vouchers out; Used and
     * Purchases show under Website, where they are spent. Each row therefore
     * has a side it cannot speak for, which prints as a dash. Total is the
     * honest line to read across: given X, Y of it came back, on orders worth Z.
     *
     * Branch columns exist only for branches that also have sales rows, so
     * Total covers all 20-odd and can exceed the columns beside it.
     */
    const cashbackAgg = (pf: string, pt: string) => {
      const blank = () => ({ purchases: 0, earned: 0, spent: 0 });
      const out: Record<string, ReturnType<typeof blank>> = {};
      for (const label of branchLabels) out[label] = blank();
      const total = blank();

      // One pass over the vouchers issued in the window: what they were worth,
      // what has come back on them, and what they bought. All three follow the
      // same vouchers, so Used can never exceed Earned.
      // Earned sits under the shop that handed the voucher out.
      const cohort = new Set<string>();
      for (const c of issued) {
        if (c.day < pf || c.day > pt) continue;
        cohort.add(c.code);
        total.earned += c.earned;
        total.spent += c.spent;
        const col = rawToColumn.get(c.branch);
        if (col && out[col]) out[col].earned += c.earned;
      }

      // Used and Purchases sit under Website, because that is where a voucher
      // is spent — every redemption we can see is an online order. An order
      // counts once however many of its vouchers belong to this cohort.
      const web = blank();
      for (const o of cashbackOrders) {
        if (!o.hits.some((h) => cohort.has(h.code))) continue;
        total.purchases += o.purchase;
        web.purchases += o.purchase;
      }
      web.spent = total.spent;
      out[WEBSITE] = web;
      out.Total = total;

      // One block per row the table draws, so the client stays a dumb printer.
      // `na` marks the side a row cannot apply to — the shops never redeem in
      // a way Odoo reports, the website never issues — so the table can print
      // a dash there instead of a zero that reads like missing data.
      const pick = (k: "purchases" | "earned" | "spent") => {
        const b: Record<string, { orders: number; value: number; na?: boolean }> = {};
        for (const [col, v] of Object.entries(out)) {
          // Earned is a shop fact, Used and Purchases are website facts; the
          // other side of each gets a dash rather than a misleading zero.
          const na =
            col !== "Total" && (k === "earned" ? col === WEBSITE : col !== WEBSITE);
          b[col] = { orders: 0, value: v[k], na };
        }
        return b;
      };
      return { purchases: pick("purchases"), earned: pick("earned"), spent: pick("spent") };
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
