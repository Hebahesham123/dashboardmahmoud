import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { parseCsv, mapTrafficCsv, aggregateTraffic } from "@/lib/csv";
import { fetchProductHandlesInCollectionsMatching } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * POST /api/traffic
 * Body: raw CSV text (Content-Type: text/csv) OR JSON { csv: "..." }.
 * Parses a Shopify Analytics export and upserts daily_traffic.
 * Returns the detected column mapping and number of rows imported.
 */
export async function POST(req: NextRequest) {
  let cells: string[][] | null = null;
  let targetMonth: string | null = null;
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (typeof body.month === "string") targetMonth = body.month;

      // Manual entry: full typed rows — upsert directly (all 4 columns).
      if (Array.isArray(body.rows)) {
        const now = new Date().toISOString();
        const payload = body.rows
          .filter((r: { traffic_date?: string }) => r.traffic_date)
          .map((r: Record<string, unknown>) => ({
            traffic_date: String(r.traffic_date),
            visitors: Number(r.visitors) || 0,
            sessions: Number(r.sessions) || 0,
            add_to_cart: Number(r.add_to_cart) || 0,
            reached_checkout: Number(r.reached_checkout) || 0,
            updated_at: now,
          }));
        if (payload.length === 0) {
          return NextResponse.json({ error: "No valid rows (date required)." }, { status: 422 });
        }
        const supabase = createServiceClient();
        const { error } = await supabase
          .from("daily_traffic")
          .upsert(payload, { onConflict: "traffic_date" });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, imported: payload.length, mode: "manual" });
      }

      if (Array.isArray(body.cells)) {
        // pre-parsed rows from the browser (handles .xlsx / .xls / .csv)
        cells = body.cells.map((row: unknown[]) => row.map((v) => String(v ?? "")));
      } else if (typeof body.csv === "string") {
        cells = parseCsv(body.csv);
      }
    } else {
      cells = parseCsv(await req.text());
    }
  } catch {
    return NextResponse.json({ error: "Could not read request body." }, { status: 400 });
  }

  if (!cells || cells.length === 0) {
    return NextResponse.json({ error: "Empty file." }, { status: 400 });
  }

  const { rows, mapping, headers, errors } = mapTrafficCsv(cells);

  // No per-day rows found. If the file still has traffic metric columns
  // (e.g. a "by landing page" report), aggregate every row into a single
  // monthly total for the selected month.
  if (rows.length === 0) {
    // Product pages count only if they're in the "ns-home" collection.
    let productHandles: Set<string> | undefined;
    try {
      productHandles = await fetchProductHandlesInCollectionsMatching("ns-home");
    } catch {
      productHandles = undefined;
    }
    const agg = aggregateTraffic(cells, { productHandles });
    if (agg) {
      if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
        return NextResponse.json(
          { error: "This report has no dates — pick a Month first, then re-upload to store it as that month's total.", headers: agg.headers },
          { status: 422 }
        );
      }
      const supabase = createServiceClient();
      const { error } = await supabase.from("monthly_traffic").upsert(
        {
          month: targetMonth,
          visitors: agg.visitors,
          sessions: agg.sessions,
          add_to_cart: agg.add_to_cart,
          reached_checkout: agg.reached_checkout,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "month" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        mode: "monthly",
        month: targetMonth,
        totals: {
          visitors: agg.visitors,
          sessions: agg.sessions,
          add_to_cart: agg.add_to_cart,
          reached_checkout: agg.reached_checkout,
        },
      });
    }
    return NextResponse.json({ error: errors.join(" "), mapping, headers }, { status: 422 });
  }

  // Partial upsert: only write columns this file actually has, so uploading
  // multiple daily reports (e.g. visitors in one, funnel in another) MERGES
  // by date instead of overwriting missing columns with zero.
  const fields = (["visitors", "sessions", "add_to_cart", "reached_checkout"] as const).filter(
    (f) => mapping[f]
  );
  const now = new Date().toISOString();
  const payload = rows.map((r) => {
    const o: Record<string, unknown> = { traffic_date: r.traffic_date, updated_at: now };
    for (const f of fields) o[f] = r[f];
    return o;
  });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("daily_traffic")
    .upsert(payload, { onConflict: "traffic_date" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported: rows.length,
    columnsWritten: fields,
    mapping,
    warnings: errors,
  });
}

/** DELETE /api/traffic?date=YYYY-MM-DD — remove one day's traffic row. */
export async function DELETE(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });
  const supabase = createServiceClient();
  const { error } = await supabase.from("daily_traffic").delete().eq("traffic_date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: date });
}
