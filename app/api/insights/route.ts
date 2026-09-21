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
  kind: string; // product | discount | shipping
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
    const channel = sp.get("channel"); // "online" | "offline"

    // Odoo bills the website as branch "shopify"; everything else is a shop.
    const isOnline = (branch: string) => /shopify|online/i.test(branch ?? "");

    const sb = createServiceClient();
    const read = (cols: string) =>
      pageAll<Row>(() => {
        let q = sb.from("product_sales").select(cols);
        if (from) q = q.gte("day", from);
        if (to) q = q.lte("day", to);
        if (room) q = q.eq("room", room);
        if (category) q = q.eq("category", category);
        if (subcategory) q = q.eq("subcategory", subcategory);
        return q as unknown as {
          range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
        };
      });

    const COLS = "day,branch,product_id,product_name,room,category,subcategory,qty,value";
    // `kind` arrives with migration_v14. Before it is run the column is not
    // there and selecting it returns nothing, so fall back to the old shape
    // rather than showing an empty page.
    let allRows = await read(`${COLS},kind`);
    if (allRows.length === 0) allRows = await read(COLS);

    // Channel is filtered here rather than in the query: room and category are
    // exact matches the database can do, but branch is a pattern.
    const rows = channel
      ? allRows.filter((r) => (channel === "online" ? isOnline(r.branch) : !isOnline(r.branch)))
      : allRows;

    // Odoo files discounts and shipping with no sub-category, so every
    // per-category view is built from product lines alone. They rejoin below
    // for the sales totals, which is what makes those totals real sales
    // rather than a before-discount figure.
    const productRows = rows.filter((r) => (r.kind ?? "product") === "product");
    const sumKind = (k: string) =>
      rows.filter((r) => r.kind === k).reduce((acc, r) => acc + Number(r.value || 0), 0);
    const discountValue = sumKind("discount");
    const shippingValue = sumKind("shipping");

    // Unit price decides the band. Rows that net to zero units (a sale and its
    // refund landing on the same day) have no meaningful price, so they are
    // left out of the banding but still count in the totals.
    const priced = productRows.map((r) => ({
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

    const tally = (list: typeof inBand) => ({
      units: list.reduce((acc, r) => acc + r.qty, 0),
      value: list.reduce((acc, r) => acc + r.value, 0),
      orders: list.length,
    });

    const days = rows.map((r) => r.day).sort();

    return NextResponse.json({
      ok: true,
      filters: { from, to, room, category, subcategory, minPrice, maxPrice, channel },
      coverage: { first: days[0] ?? null, last: days[days.length - 1] ?? null, rows: rows.length },
      totals: {
        units: inBand.reduce((acc, r) => acc + r.qty, 0),
        // gross = the product lines. discounts are negative. totalSales is what
        // was actually billed, and is the figure comparable with the rest of
        // the dashboard.
        gross: inBand.reduce((acc, r) => acc + r.value, 0),
        discounts: discountValue,
        shipping: shippingValue,
        totalSales: inBand.reduce((acc, r) => acc + r.value, 0) + discountValue + shippingValue,
        products: byProduct.size,
      },
      // Gross only on these two: a discount line names no branch category.
      channels: [
        { label: "Online", ...tally(inBand.filter((r) => isOnline(r.branch))) },
        { label: "Branches", ...tally(inBand.filter((r) => !isOnline(r.branch))) },
      ],
      branches: [...new Set(productRows.map((r) => r.branch))]
        .map((b) => ({ label: b, ...tally(inBand.filter((r) => r.branch === b)) }))
        .sort((a, b) => b.value - a.value),
      rooms: sum(inBand, (r) => (r.room ?? "Other") as string),
      categories: sum(inBand, (r) => (r.category ?? "—") as string),
      subcategories: sum(inBand, (r) => (r.subcategory ?? "—") as string),
      bands,
      topProducts,
      // Everything the page needs to build its dropdowns, taken before the
      // room/category filters so choosing one does not empty the others.
      options: {
        rooms: [...new Set(allRows.map((r) => r.room).filter(Boolean))].sort() as string[],
        categories: [...new Set(allRows.map((r) => r.category).filter(Boolean))].sort() as string[],
        subcategories: [...new Set(allRows.map((r) => r.subcategory).filter(Boolean))].sort() as string[],
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
