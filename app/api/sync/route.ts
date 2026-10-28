import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { saveAbandonedCheckouts } from "@/lib/abandoned";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow long syncs (Vercel Pro); free tier caps at 60s

/**
 * Hourly sync endpoint. Triggered by Vercel Cron (see vercel.json) and
 * manually for backfills (?full=1). Protected by CRON_SECRET.
 *
 * Auth accepted via either:
 *   - Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this automatically)
 *   - ?secret=<CRON_SECRET>                  (handy for manual triggering)
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");
  // Same-origin "Sync now" button sends this header (open dashboard, no login).
  const uiSync = req.method === "POST" && req.headers.get("x-ui-sync") === "1";

  const authorized =
    !secret || auth === `Bearer ${secret}` || urlSecret === secret || uiSync;

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const full = req.nextUrl.searchParams.get("full") === "1";

  try {
    const result = await runSync(full);
    // Keep abandoned checkouts past Shopify's ~3 months, for the WhatsApp
    // sheets. Its own failure shouldn't fail the order sync.
    const abandoned = await saveAbandonedCheckouts().catch((e) => ({ error: (e as Error).message }));
    return NextResponse.json({ ok: true, ...result, abandoned });
  } catch (err) {
    console.error("sync failed", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
