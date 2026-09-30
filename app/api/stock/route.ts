import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Online stock by type, against what sold.
 *
 * Stock is a snapshot — what the website is holding now. Sales are for the
 * window asked for (?from=&to=, default the last 30 days), so the two answer
 * "what have I got, and how fast is it going".
 */

interface StockRow {
  product_id: number;
  title: string | null;
  product_type: string | null;
  room: string | null;
  category: string | null;
  subcategory: string | null;
  stock: number;
  variants: number;
  price: number;
  status: string | null;
}
interface SoldRow {
  branch: string;
  product_name: string | null;
  subcategory: string | null;
  room: string | null;
  qty: number;
  returned_qty: number;
  value: number;
  returned_value: number;
  kind: string;
}

/** PostgREST caps a response at 1000 rows whatever `limit` says. */
async function pageAll<T>(
  build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await build().range(page * size, page * size + size - 1);
    if (error) return all;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const to = sp.get("to") || ymd(new Date());
    const from =
      sp.get("from") ||
      (() => {
        const d = new Date(`${to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 29);
        return ymd(d);
      })();
    const room = sp.get("room");

    const sb = createServiceClient();
    const stock = await pageAll<StockRow>(() => {
      let q = sb
        .from("stock_levels")
        .select("product_id,title,product_type,room,category,subcategory,stock,variants,price,status");
      if (room) q = q.eq("room", room);
      return q as unknown as {
        range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    });

    // Sales for the window. Online only, to match what the stock is: holding
    // on the website against selling on the website.
    const sold = await pageAll<SoldRow>(() =>
      sb
        .from("product_sales")
        .select("branch,product_name,subcategory,room,qty,returned_qty,value,returned_value,kind")
        .gte("day", from)
        .lte("day", to)
    );
    const isWeb = (b: string) => /shopify|online/i.test(b ?? "");
    const soldOnline = sold.filter((r) => isWeb(r.branch) && (r.kind ?? "product") === "product");

    // Everything that went out, returns and refunds included — the question is
    // how many left the shelf, and a piece that came back still did.
    const soldBySub = new Map<string, { qty: number; value: number; returned: number }>();
    const soldByProduct = new Map<string, { qty: number; value: number; returned: number }>();
    const add = (m: Map<string, { qty: number; value: number; returned: number }>, k: string, r: SoldRow) => {
      const e = m.get(k) ?? { qty: 0, value: 0, returned: 0 };
      e.qty += Number(r.qty || 0);
      e.value += Number(r.value || 0);
      e.returned += Number(r.returned_qty || 0);
      m.set(k, e);
    };
    for (const r of soldOnline) {
      add(soldBySub, (r.subcategory ?? "—").trim(), r);
      const name = (r.product_name ?? "").trim();
      if (name) add(soldByProduct, name, r);
    }

    // One line per type: what is held against what went.
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const byType = new Map<
      string,
      { room: string; category: string; subcategory: string; products: number; stock: number; value: number }
    >();
    for (const s of stock) {
      const key = `${s.category ?? "—"}/${s.subcategory ?? "—"}`;
      const e = byType.get(key) ?? {
        room: s.room ?? "Other",
        category: s.category ?? "—",
        subcategory: s.subcategory ?? "—",
        products: 0,
        stock: 0,
        value: 0,
      };
      e.products += 1;
      e.stock += Number(s.stock || 0);
      e.value += Number(s.stock || 0) * Number(s.price || 0);
      byType.set(key, e);
    }

    const types = [...byType.values()]
      .map((t) => {
        const sold = soldBySub.get(t.subcategory);
        return {
          ...t,
          label: `${t.category} / ${t.subcategory}`,
          sold: sold?.qty ?? 0,
          soldValue: sold?.value ?? 0,
          returned: sold?.returned ?? 0,
        };
      })
      .sort((a, b) => b.stock - a.stock);

    const rooms = [...new Set(types.map((t) => t.room))].map((r) => ({
      label: r,
      products: types.filter((t) => t.room === r).reduce((a, t) => a + t.products, 0),
      stock: types.filter((t) => t.room === r).reduce((a, t) => a + t.stock, 0),
      sold: types.filter((t) => t.room === r).reduce((a, t) => a + t.sold, 0),
      soldValue: types.filter((t) => t.room === r).reduce((a, t) => a + t.soldValue, 0),
      value: types.filter((t) => t.room === r).reduce((a, t) => a + t.value, 0),
    }));
    rooms.sort((a, b) => b.stock - a.stock);

    const products = stock
      .map((s) => ({
        product_id: s.product_id,
        title: s.title ?? "",
        label: `${s.category ?? "—"} / ${s.subcategory ?? "—"}`,
        room: s.room ?? "Other",
        stock: Number(s.stock || 0),
        variants: s.variants,
        price: Number(s.price || 0),
        sold: soldByProduct.get((s.title ?? "").trim())?.qty ?? 0,
        soldValue: soldByProduct.get((s.title ?? "").trim())?.value ?? 0,
        returned: soldByProduct.get((s.title ?? "").trim())?.returned ?? 0,
        status: s.status ?? "active",
      }))
      .sort((a, b) => b.stock - a.stock);

    return NextResponse.json({
      ok: true,
      window: { from, to, days },
      totals: {
        products: stock.length,
        stock: stock.reduce((a, s) => a + Number(s.stock || 0), 0),
        value: stock.reduce((a, s) => a + Number(s.stock || 0) * Number(s.price || 0), 0),
        sold: types.reduce((a, t) => a + t.sold, 0),
        soldValue: types.reduce((a, t) => a + t.soldValue, 0),
        returned: types.reduce((a, t) => a + t.returned, 0),
        draftProducts: stock.filter((s) => s.status === "draft").length,
        draftStock: stock.filter((s) => s.status === "draft").reduce((a, s) => a + Number(s.stock || 0), 0),
        outOfStock: stock.filter((s) => Number(s.stock || 0) <= 0).length,
      },
      rooms,
      types,
      products,
      options: { rooms: [...new Set(stock.map((s) => s.room).filter(Boolean))].sort() as string[] },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
