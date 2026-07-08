import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchOdooInvoices, aggregateOffline, odooConfig } from "@/lib/odoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sync offline (استهلاكي) invoices from Odoo into offline_sales.
 * Protected by CRON_SECRET (Bearer header or ?secret=). Call every 6h from
 * an external scheduler. ?from=YYYY-MM-DD&to=YYYY-MM-DD to override window
 * (default: last 120 days).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const uiSync = req.headers.get("x-ui-sync") === "1";
  if (secret && !(auth === `Bearer ${secret}` || urlSecret === secret || uiSync)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rolling window (default 10 days) so each run stays well under Vercel's
  // 60s function limit; the dataset is huge (~430k lines). The 6h cron keeps
  // recent days fresh; use ?from=&to= for one-off historical backfills.
  const days = Number(req.nextUrl.searchParams.get("days")) || 10;
  const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const from =
    req.nextUrl.searchParams.get("from") ||
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    })();

  try {
    const { filter } = odooConfig();
    const rows = await fetchOdooInvoices(from, to);
    const days = aggregateOffline(rows, filter);

    const sb = createServiceClient();
    if (days.length) {
      const now = new Date().toISOString();
      const { error } = await sb
        .from("offline_sales")
        .upsert(
          days.map((d) => ({ ...d, updated_at: now })),
          { onConflict: "day" }
        );
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      from,
      to,
      totalLines: rows.length,
      daysUpserted: days.length,
      invoices: days.reduce((s, d) => s + d.invoices, 0),
      amount: days.reduce((s, d) => s + d.amount, 0),
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
