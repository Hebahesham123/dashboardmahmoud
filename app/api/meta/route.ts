import { NextRequest, NextResponse } from "next/server";
import { metaConfig, fetchMetaReport, sampleMetaReport } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/meta?from=YYYY-MM-DD&to=YYYY-MM-DD[&sample=1]
 * Meta ads performance for the window. Without credentials it answers
 * { configured: false } — or made-up numbers when sample=1 is passed.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const from = q.get("from") || "";
  const to = q.get("to") || "";
  if (!ISO.test(from) || !ISO.test(to) || from > to) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD, from ≤ to" }, { status: 400 });
  }

  const cfg = metaConfig();
  if (q.get("sample") === "1") {
    return NextResponse.json({ ok: true, configured: !!cfg, report: sampleMetaReport(from, to) });
  }
  if (!cfg) return NextResponse.json({ ok: false, configured: false });

  try {
    const report = await fetchMetaReport(cfg, from, to);
    return NextResponse.json({ ok: true, configured: true, report });
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, error: (e as Error).message }, { status: 502 });
  }
}
