import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchStockProducts } from "@/lib/shopify";
import { parseShopifyType } from "@/lib/odoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot what the website is holding into stock_levels.
 * Protected by CRON_SECRET (Bearer header or ?secret=).
 *
 * Only NS Home retail is kept — the fabric/commercial catalogue shares the
 * store and would bury it. `?all=1` keeps everything, for a look at the rest.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const uiSync = req.headers.get("x-ui-sync") === "1";
  if (secret && !(auth === `Bearer ${secret}` || urlSecret === secret || uiSync)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const keepAll = req.nextUrl.searchParams.get("all") === "1";

  try {
    const products = await fetchStockProducts();
    const rows = products
      .map((p) => {
        const cat = parseShopifyType(p.product_type);
        if (!cat && !keepAll) return null;
        return {
          product_id: p.product_id,
          title: p.title,
          product_type: p.product_type,
          room: cat?.room ?? null,
          category: cat?.category ?? null,
          subcategory: cat?.subcategory ?? null,
          stock: p.stock,
          variants: p.variants,
          price: p.price,
          status: p.status,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const sb = createServiceClient();
    const now = new Date().toISOString();

    // A product that went draft, or out of the retail catalogue, should leave
    // the table rather than sit there at its last known count for ever.
    const keep = new Set(rows.map((r) => r.product_id));
    const { data: existing } = await sb.from("stock_levels").select("product_id");
    const stale = ((existing ?? []) as { product_id: number }[])
      .map((r) => r.product_id)
      .filter((id) => !keep.has(id));
    if (stale.length) await sb.from("stock_levels").delete().in("product_id", stale);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now }));
      const { error } = await sb.from("stock_levels").upsert(chunk, { onConflict: "product_id" });
      if (error) throw new Error(`stock_levels upsert: ${error.message}`);
      upserted += chunk.length;
    }

    return NextResponse.json({
      ok: true,
      scanned: products.length,
      upserted,
      removed: stale.length,
      units: rows.reduce((a, r) => a + r.stock, 0),
      types: new Set(rows.map((r) => r.subcategory)).size,
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
