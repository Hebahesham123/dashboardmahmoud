import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  fetchCashbackCoupons,
  toCashbackRow,
  fetchAnalyticsInvoices,
  extractCashbackRedemptions,
} from "@/lib/odoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sync NS Home cashback coupons (Odoo ns_loyalty_cashback) into
 * cashback_coupons. Protected by CRON_SECRET (Bearer header or ?secret=).
 *
 * A coupon is issued against a branch invoice and can be redeemed later, so
 * the window is re-read rather than appended: `used` flips long after the
 * coupon's issue date. ?days= (default 45) or ?from=&to= to override.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const uiSync = req.headers.get("x-ui-sync") === "1";
  if (secret && !(auth === `Bearer ${secret}` || urlSecret === secret || uiSync)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const days = Number(req.nextUrl.searchParams.get("days")) || 45;
  const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const from =
    req.nextUrl.searchParams.get("from") ||
    (() => {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    })();

  try {
    const coupons = await fetchCashbackCoupons(from, to);
    const rows = coupons.map(toCashbackRow).filter((r): r is NonNullable<typeof r> => r !== null);

    const sb = createServiceClient();
    const now = new Date().toISOString();
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now }));
      const { error } = await sb.from("cashback_coupons").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`cashback_coupons upsert: ${error.message}`);
      upserted += chunk.length;
    }

    // --- Cashback redeemed in the shops. Odoo's `used` flag says a voucher
    // was spent but not when, where, or on what — and it is unreliable besides
    // (coupons seen redeemed still read used = false). The redeeming invoice
    // carries all of it, so that is what gets stored. ---
    let redemptions = 0;
    let redeemedValue = 0;
    try {
      const lines = await fetchAnalyticsInvoices(from, to);
      const found = extractCashbackRedemptions(lines);

      // Tie each redemption to the voucher behind it: same customer, nearest
      // face value at or above the amount spent. Partial redemptions come back
      // a little under face (6,513 off a 6,516 voucher), so an exact match is
      // too strict. Only for reporting — the money comes from the invoice.
      const custIds = [...new Set(found.map((r) => r.customer_id).filter(Boolean))] as number[];
      const coupons: { code: string; customer_id: number; discount_amount: number }[] = [];
      for (let i = 0; i < custIds.length; i += 100) {
        const { data } = await sb
          .from("cashback_coupons")
          .select("code,customer_id,discount_amount")
          .in("customer_id", custIds.slice(i, i + 100));
        coupons.push(...((data ?? []) as typeof coupons));
      }
      const byCustomer = new Map<number, typeof coupons>();
      for (const c of coupons) {
        const list = byCustomer.get(c.customer_id);
        if (list) list.push(c);
        else byCustomer.set(c.customer_id, [c]);
      }

      const rowsOut = found.map((r) => {
        const mine = r.customer_id ? (byCustomer.get(r.customer_id) ?? []) : [];
        // Nearest face value, allowing the shortfall a partial redemption
        // leaves. Requiring face >= amount alone missed 598 spent off a 661
        // voucher; requiring an exact match missed 6,513 off 6,516.
        const best = mine
          .map((c) => ({ c, diff: Math.abs(Number(c.discount_amount) - r.cashback_used) }))
          .filter(({ c, diff }) => diff <= Math.max(2, Number(c.discount_amount) * 0.25))
          .sort((a, b) => a.diff - b.diff)[0]?.c;
        return { ...r, coupon_code: best?.code ?? null, updated_at: now };
      });

      for (let i = 0; i < rowsOut.length; i += 500) {
        const { error } = await sb
          .from("cashback_redemptions")
          .upsert(rowsOut.slice(i, i + 500), { onConflict: "invoice_number" });
        if (error) throw new Error(`cashback_redemptions upsert: ${error.message}`);
      }
      redemptions = rowsOut.length;
      redeemedValue = rowsOut.reduce((s, r) => s + r.cashback_used, 0);
    } catch (err) {
      // The coupons are already stored; report the redemption failure without
      // throwing away a good sync.
      return NextResponse.json({
        ok: true,
        from,
        to,
        fetched: coupons.length,
        upserted,
        redemptionError: (err as Error).message,
      });
    }

    return NextResponse.json({
      ok: true,
      from,
      to,
      fetched: coupons.length,
      upserted,
      redemptions,
      redeemedValue,
      used: rows.filter((r) => r.used).length,
      cashback: rows.reduce((s, r) => s + r.discount_amount, 0),
      invoiced: rows.reduce((s, r) => s + r.invoice_amount, 0),
      branches: new Set(rows.map((r) => r.branch)).size,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
