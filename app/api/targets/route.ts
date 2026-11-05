import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Monthly sales targets per Summary column (branch label or "Website").
 *  GET  → { ok, targets: { [channel]: number } } — only channels that were set.
 *  POST { targets: { [channel]: number } } → upserts them.
 * Needs supabase/migration_v18.sql. Before it is run, GET returns no targets
 * (the page falls back to the defaults) and POST reports the missing table.
 */
export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb.from("sales_targets").select("channel,target");
  if (error) return NextResponse.json({ ok: true, targets: {}, warning: error.message });
  const targets: Record<string, number> = {};
  for (const r of (data ?? []) as { channel: string; target: number }[]) targets[r.channel] = Number(r.target);
  return NextResponse.json({ ok: true, targets });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { targets?: Record<string, unknown> };
    const rows = Object.entries(body.targets ?? {}).map(([channel, v]) => ({
      channel: channel.trim(),
      target: Number(v),
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) return NextResponse.json({ ok: false, error: "No targets sent" }, { status: 400 });
    if (rows.some((r) => !r.channel || !Number.isFinite(r.target) || r.target < 0)) {
      return NextResponse.json({ ok: false, error: "Targets must be numbers of 0 or more" }, { status: 400 });
    }
    const sb = createServiceClient();
    const { error } = await sb.from("sales_targets").upsert(rows, { onConflict: "channel" });
    if (error) {
      const missing = /sales_targets/.test(error.message) && /exist|schema cache/i.test(error.message);
      return NextResponse.json(
        { ok: false, error: missing ? "Run supabase/migration_v18.sql in Supabase first." : error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
