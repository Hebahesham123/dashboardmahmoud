import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { saveAbandonedCheckouts } from "@/lib/abandoned";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/whatsapp-campaigns — saves the latest abandoned checkouts from
 * Shopify, then returns the whole saved history (bought ones left out) for
 * the page to cut into the twice-a-week sheets.
 */
export async function GET() {
  try {
    // A Shopify hiccup shouldn't hide the history already saved.
    let saveError: string | null = null;
    try {
      await saveAbandonedCheckouts();
    } catch (e) {
      saveError = (e as Error).message;
    }

    const sb = createServiceClient();
    const all: { id: number; mobile: string | null; name: string | null; day: string; created_at: string }[] = [];
    for (let page = 0; page < 200; page++) {
      const { data, error } = await sb
        .from("abandoned_checkouts")
        .select("id,mobile,name,day,created_at")
        .is("recovered_at", null)
        .order("created_at", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(error.message);
      all.push(...((data ?? []) as typeof all));
      if ((data ?? []).length < 1000) break;
    }

    const checkouts = all.map((r) => ({ id: r.id, mobile: r.mobile, name: r.name ?? "", date: r.day }));
    return NextResponse.json({ ok: true, count: checkouts.length, saveError, checkouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
