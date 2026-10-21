import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchVariantsFor, fetchProductVariants, type StockVariant } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Variants with their stock, price, SKU and barcode live from Shopify, and
 * sold from the Shopify order lines in the window (?from=&to=). Cancelled
 * orders are left out — they sold nothing.
 *
 * With ?product_id= it answers for that one product (the row drop-down);
 * with ?ids=1,2,3 for those products, keyed by product id (the export).
 */

interface ItemRow {
  product_id: number | null;
  variant_id: number | null;
  quantity: number;
  price: number;
  order_id: number;
}

type Q = { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** PostgREST caps a response at 1000 rows whatever `limit` says. */
async function pageAll<T>(build: () => Q): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build().range(page * size, page * size + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const productId = Number(sp.get("product_id")) || null;
    const ids = (sp.get("ids") ?? "")
      .split(",")
      .map(Number)
      .filter((n) => n > 0);
    const from = sp.get("from");
    const to = sp.get("to");
    if (!from || !to) {
      return NextResponse.json({ ok: false, error: "from and to are required" }, { status: 400 });
    }
    if (!productId && !ids.length) {
      return NextResponse.json({ ok: false, error: "product_id or ids is required" }, { status: 400 });
    }

    const sb = createServiceClient();
    const [variantsByProduct, items] = await Promise.all([
      productId
        ? fetchProductVariants(productId).then((v) => new Map<number, StockVariant[]>([[productId, v]]))
        : fetchVariantsFor(ids),
      pageAll<ItemRow>(() => {
        let q = sb
          .from("order_items")
          .select("product_id,variant_id,quantity,price,order_id")
          .gte("order_date", from)
          .lte("order_date", to);
        if (productId) q = q.eq("product_id", productId);
        return q as unknown as Q;
      }),
    ]);

    // Cancelled orders in the window — order_items carry the order date, so
    // the same window finds their orders.
    const orders = await pageAll<{ id: number; cancelled_at: string | null }>(
      () =>
        sb
          .from("orders")
          .select("id,cancelled_at")
          .gte("order_date", from)
          .lte("order_date", to)
          .not("cancelled_at", "is", null) as unknown as Q
    );
    const cancelled = new Set(orders.map((o) => o.id));

    const sold = new Map<number, { qty: number; value: number }>();
    for (const it of items) {
      if (cancelled.has(it.order_id) || !it.variant_id) continue;
      const e = sold.get(it.variant_id) ?? { qty: 0, value: 0 };
      e.qty += Number(it.quantity || 0);
      e.value += Number(it.quantity || 0) * Number(it.price || 0);
      sold.set(it.variant_id, e);
    }

    const withSold = (vs: StockVariant[]) =>
      vs.map((v) => ({
        ...v,
        sold: sold.get(v.variant_id)?.qty ?? 0,
        soldValue: sold.get(v.variant_id)?.value ?? 0,
      }));

    if (productId) {
      return NextResponse.json({ ok: true, variants: withSold(variantsByProduct.get(productId) ?? []) });
    }
    const byProduct: Record<string, ReturnType<typeof withSold>> = {};
    for (const [id, vs] of variantsByProduct) byProduct[id] = withSold(vs);
    return NextResponse.json({ ok: true, byProduct });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
