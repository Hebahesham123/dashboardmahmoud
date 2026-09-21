import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Product insights: what sells, by room, category and price band.
 *
 * ?from=&to= to bound the period (omit both for everything on record),
 * ?room= / ?category= / ?subcategory= to drill in,
 * ?minPrice=&maxPrice= for a custom price band.
 */

/** Default bands, in EGP. `max: null` is the open-ended top band. */
const PRICE_BANDS: { label: string; min: number; max: number | null }[] = [
  { label: "1 – 200", min: 0, max: 200 },
  { label: "200 – 500", min: 200, max: 500 },
  { label: "500 – 1,000", min: 500, max: 1000 },
  { label: "1,000 – 2,000", min: 1000, max: 2000 },
  { label: "2,000 – 5,000", min: 2000, max: 5000 },
  { label: "5,000 +", min: 5000, max: null },
];

interface Row {
  day: string;
  branch: string;
  product_id: number;
  product_name: string | null;
  room: string | null;
  category: string | null;
  subcategory: string | null;
  qty: number;
  value: number;
}

/** PostgREST caps a response at 1000 rows whatever `limit` says. */
async function pageAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let page = 0; page < 500; page++) {
    const { data, error } = await build().range(page * size, page * size + size - 1);
    if (error) return all;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const room = sp.get("room");
    const category = sp.get("category");
    const subcategory = sp.get("subcategory");
    const minPrice = sp.get("minPrice") ? Number(sp.get("minPrice")) : null;
    const maxPrice = sp.get("maxPrice") ? Number(sp.get("maxPrice")) : null;

    const sb = createServiceClient();
    const rows = await pageAll<Row>(() => {
      let q = sb
        .from("product_sales")
        .select("day,branch,product_id,product_name,room,category,subcategory,qty,value");
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      if (room) q = q.eq("room", room);
      if (category) q = q.eq("category", category);
      if (subcategory) q = q.eq("subcategory", subcategory);
      return q as unknown as {
        range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    });

    // Unit price decides the band. Rows that net to zero units (a sale and its
    // refund landing on the same day) have no meaningful price, so they are
    // left out of the banding but still count in the totals.
    const priced = rows.map((r) => ({
      ...r,
      unit: r.qty !== 0 ? r.value / r.qty : 0,
    }));
    const inBand = priced.filter(
      (r) =>
        (minPrice === null || r.unit >= minPrice) && (maxPrice === null || r.unit <= maxPrice)
    );

    const sum = <K extends string>(list: typeof inBand, key: (r: (typeof inBand)[number]) => K) => {
      const m = new Map<K, { units: number; value: number; orders: number }>();
      for (const r of list) {
        const k = key(r);
        const e = m.get(k) ?? { units: 0, value: 0, orders: 0 };
        e.units += r.qty;
        e.value += r.value;
        e.orders += 1;
        m.set(k, e);
      }
      return [...m.entries()]
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.value - a.value);
    };

    // Top products: same product across days and branches is one product.
    const byProduct = new Map<number, { name: string; units: number; value: number; subcategory: string }>();
    for (const r of inBand) {
      const e = byProduct.get(r.product_id) ?? {
        name: r.product_name ?? String(r.product_id),
        units: 0,
        value: 0,
        subcategory: r.subcategory ?? "",
      };
      e.units += r.qty;
      e.value += r.value;
      byProduct.set(r.product_id, e);
    }
    const topProducts = [...byProduct.entries()]
      .map(([product_id, v]) => ({ product_id, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const bands = PRICE_BANDS.map((b) => {
      const hit = inBand.filter((r) => r.unit >= b.min && (b.max === null || r.unit < b.max));
      return {
        label: b.label,
        min: b.min,
        max: b.max,
        units: hit.reduce((s, r) => s + r.qty, 0),
        value: hit.reduce((s, r) => s + r.value, 0),
      };
    });

    const days = rows.map((r) => r.day).sort();

    return NextResponse.json({
      ok: true,
      filters: { from, to, room, category, subcategory, minPrice, maxPrice },
      coverage: { first: days[0] ?? null, last: days[days.length - 1] ?? null, rows: rows.length },
      totals: {
        units: inBand.reduce((s, r) => s + r.qty, 0),
        value: inBand.reduce((s, r) => s + r.value, 0),
        products: byProduct.size,
      },
      rooms: sum(inBand, (r) => (r.room ?? "Other") as string),
      categories: sum(inBand, (r) => (r.category ?? "—") as string),
      subcategories: sum(inBand, (r) => (r.subcategory ?? "—") as string),
      bands,
      topProducts,
      // Everything the page needs to build its dropdowns, taken before the
      // room/category filters so choosing one does not empty the others.
      options: {
        rooms: [...new Set(rows.map((r) => r.room).filter(Boolean))].sort() as string[],
        categories: [...new Set(rows.map((r) => r.category).filter(Boolean))].sort() as string[],
        subcategories: [...new Set(rows.map((r) => r.subcategory).filter(Boolean))].sort() as string[],
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
