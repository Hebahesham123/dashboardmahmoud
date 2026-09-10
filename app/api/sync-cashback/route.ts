import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchCashbackCoupons, toCashbackRow } from "@/lib/odoo";

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

    return NextResponse.json({
      ok: true,
      from,
      to,
      fetched: coupons.length,
      upserted,
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
