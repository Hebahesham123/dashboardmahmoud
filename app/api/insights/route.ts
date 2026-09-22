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
  returned_qty: number;
  returned_value: number;
  kind: string; // product | discount | shipping
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const minIso = (a: string, b: string) => (a < b ? a : b);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

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
    const branch = sp.get("branch"); // an exact Odoo branch name

    // Odoo bills the website as branch "shopify"; everything else is a shop.
    const isOnline = (branch: string) => /shopify|online/i.test(branch ?? "");

    const sb = createServiceClient();
    const read = (cols: string, lo: string | null = from, hi: string | null = to) =>
      pageAll<Row>(() => {
        let q = sb.from("product_sales").select(cols);
        if (lo) q = q.gte("day", lo);
        if (hi) q = q.lte("day", hi);
        if (room) q = q.eq("room", room);
        if (category) q = q.eq("category", category);
        if (subcategory) q = q.eq("subcategory", subcategory);
        return q as unknown as {
          range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
        };
      });

    const COLS =
      "day,branch,product_id,product_name,room,category,subcategory,qty,value,returned_qty,returned_value";
    // `kind` arrives with migration_v14. Before it is run the column is not
    // there and selecting it returns nothing, so fall back to the old shape
    // rather than showing an empty page.
    let allRows = await read(`${COLS},kind`);
    // The column list grows with each migration; fall back through the older
    // shapes so the page keeps working between a deploy and its migration.
    if (allRows.length === 0)
      allRows = await read("day,branch,product_id,product_name,room,category,subcategory,qty,value,kind");
    if (allRows.length === 0)
      allRows = await read("day,branch,product_id,product_name,room,category,subcategory,qty,value");

    // Channel is filtered here rather than in the query: room and category are
    // exact matches the database can do, but branch is a pattern.
    let rows = channel
      ? allRows.filter((r) => (channel === "online" ? isOnline(r.branch) : !isOnline(r.branch)))
      : allRows;
    if (branch) rows = rows.filter((r) => r.branch === branch);

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
    const priced = productRows.map((r) => {
      const returnedQty = Number(r.returned_qty || 0);
      const returnedValue = Number(r.returned_value || 0);
      // Rank on what was actually kept, but keep the returns visible.
      const netQty = Number(r.qty || 0) - returnedQty;
      const netValue = Number(r.value || 0) - returnedValue;
      return {
        ...r,
        qty: netQty,
        value: netValue,
        soldQty: Number(r.qty || 0),
        returnedQty,
        returnedValue,
        unit: Number(r.qty || 0) !== 0 ? Number(r.value || 0) / Number(r.qty || 0) : 0,
      };
    });
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

    // One product is one product, however many days and branches it sold across.
    const byProduct = new Map<
      number,
      {
        name: string;
        units: number;
        value: number;
        subcategory: string;
        lastSold: string;
        returnedUnits: number;
        returnedValue: number;
      }
    >();
    for (const r of inBand) {
      const e = byProduct.get(r.product_id) ?? {
        name: r.product_name ?? String(r.product_id),
        units: 0,
        value: 0,
        subcategory: r.subcategory ?? "",
        lastSold: r.day,
        returnedUnits: 0,
        returnedValue: 0,
      };
      e.units += r.qty;
      e.value += r.value;
      e.returnedUnits += r.returnedQty;
      e.returnedValue += r.returnedValue;
      if (r.qty > 0 && r.day > e.lastSold) e.lastSold = r.day;
      byProduct.set(r.product_id, e);
    }
    const products = [...byProduct.entries()].map(([product_id, v]) => ({ product_id, ...v }));
    const topProducts = [...products].sort((a, b) => b.value - a.value).slice(0, 10);

    // Slow movers: fewest units shifted, among things that did sell. Products
    // with no net movement (a sale cancelled by its refund) are a different
    // problem and would crowd out the genuinely slow ones. `lastSold` is the
    // column that makes the list actionable — a low count from last week is
    // not the same as a low count from March.
    const slowProducts = products
      .filter((p) => p.units > 0)
      .sort((a, b) => a.units - b.units || a.value - b.value)
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

    /**
     * Sales the way the Summary page counts them: every NS Home line on the
     * invoice, product plus the discount and shipping lines Odoo books under
     * the bare category, net of returns. Product lines alone are a
     * before-discount figure and ran ~12% over Summary — 282,434 against
     * 251,478 for مدينة نصر. With the discount lines back in, the two agree
     * to the pound.
     *
     * A price-band filter cannot apply to a discount line (it has no unit
     * price), so when one is set the totals fall back to the product lines in
     * the band and say so on the page.
     */
    const priceFiltered = minPrice !== null || maxPrice !== null;

    /**
     * Online sales read from Shopify, the same source and the same date basis
     * the Summary page uses, so the two agree. Odoo's shopify-branch invoices
     * describe the same goods on a different clock — an order placed in July
     * and invoiced in August lands in a different month — which put Insights
     * 42k above Summary in July and 80k below it in August.
     *
     * Shopify carries no product categories, so this can only stand in for the
     * whole-channel figure. The moment the page is drilled into a room, a
     * sub-category or a price band, the online number has to come back from
     * Odoo, which is the only side that knows what a towel is. `onlineSource`
     * tells the page which it is looking at.
     */
    const categoryFiltered = Boolean(room || category || subcategory || priceFiltered);
    let shopifyOnline = 0;
    if (!categoryFiltered) {
      let q = sb.from("daily_metrics").select("day,total_sales");
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const { data: dm } = await q;
      shopifyOnline = ((dm ?? []) as { total_sales: number }[]).reduce(
        (acc, r) => acc + Number(r.total_sales || 0),
        0
      );
    }
    const onlineSource = categoryFiltered ? "odoo" : "shopify";
    const netOf = (r: { value: number; returned_value: number }) =>
      Number(r.value || 0) - Number(r.returned_value || 0);
    const salesOf = (pred: (r: { branch: string }) => boolean) =>
      priceFiltered
        ? inBand.filter(pred).reduce((a, r) => a + r.value, 0)
        : rows.filter(pred).reduce((a, r) => a + netOf(r), 0);

    const onlineSales = onlineSource === "shopify" ? shopifyOnline : salesOf((r) => isOnline(r.branch));
    const branchSales = salesOf((r) => !isOnline(r.branch));

    const tally = (list: typeof inBand) => ({
      units: list.reduce((acc, r) => acc + r.qty, 0),
      value: list.reduce((acc, r) => acc + r.value, 0),
      orders: list.length,
    });

    const days = rows.map((r) => r.day).sort();

    // Sales by month, for the trend columns.
    const byMonth = new Map<string, { units: number; value: number }>();
    for (const r of inBand) {
      const m = r.day.slice(0, 7);
      const e = byMonth.get(m) ?? { units: 0, value: 0 };
      e.units += r.qty;
      e.value += r.value;
      byMonth.set(m, e);
    }
    const timeseries = [...byMonth.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Months across the whole record, ignoring the date filter but keeping the
    // rest: the day chart answers "how is this month going", this one answers
    // "how do the months compare", and that second question is not about the
    // selected window. It needs its own read — the main one is date-bounded.
    const allTimeRows = from || to ? await read(`${COLS},kind`, null, null) : allRows;
    let allTimeScoped = channel
      ? allTimeRows.filter((r) => (channel === "online" ? isOnline(r.branch) : !isOnline(r.branch)))
      : allTimeRows;
    if (branch) allTimeScoped = allTimeScoped.filter((r) => r.branch === branch);
    const byMonthAll = new Map<string, { units: number; value: number }>();
    for (const r of allTimeScoped) {
      if ((r.kind ?? "product") !== "product") continue;
      const m = r.day.slice(0, 7);
      const e = byMonthAll.get(m) ?? { units: 0, value: 0 };
      e.units += Number(r.qty || 0) - Number(r.returned_qty || 0);
      e.value += Number(r.value || 0) - Number(r.returned_value || 0);
      byMonthAll.set(m, e);
    }
    const monthly = [...byMonthAll.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // The same shape by day. A short window wants days; a long one wants
    // months, and the page picks whichever suits the range it is showing.
    const byDay = new Map<string, { units: number; value: number }>();
    for (const r of inBand) {
      const e = byDay.get(r.day) ?? { units: 0, value: 0 };
      e.units += r.qty;
      e.value += r.value;
      byDay.set(r.day, e);
    }
    const daily = [...byDay.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => a.label.localeCompare(b.label));

    /**
     * What a day is worth, against what a day of this month is worth.
     *
     * Comparing a day with the day before it says more about which weekday it
     * was than about the business — a Sunday against a Saturday reads as a
     * collapse. The baseline is the month's own daily average instead, on the
     * same footing as the headline (branch sales from Odoo, online from
     * Shopify), so a single day, a week and the whole month are all readable
     * on one scale.
     */
    const lastDay = days[days.length - 1] ?? todayIso();
    const baseMonth = (to ?? lastDay).slice(0, 7);
    const monthFrom = `${baseMonth}-01`;
    const monthTo = minIso(`${baseMonth}-${daysInMonth(baseMonth)}`, todayIso());

    const inMonth = (d: string) => d >= monthFrom && d <= monthTo;
    const monthRows = allTimeScoped.filter((r) => inMonth(r.day));
    const monthBranchSales = monthRows
      .filter((r) => !isOnline(r.branch))
      .reduce((acc, r) => acc + netOf(r), 0);

    let monthOnlineSales = 0;
    if (onlineSource === "shopify") {
      const { data: dmMonth } = await sb
        .from("daily_metrics")
        .select("day,total_sales")
        .gte("day", monthFrom)
        .lte("day", monthTo);
      monthOnlineSales = ((dmMonth ?? []) as { total_sales: number }[]).reduce(
        (acc, r) => acc + Number(r.total_sales || 0),
        0
      );
    } else {
      monthOnlineSales = monthRows.filter((r) => isOnline(r.branch)).reduce((acc, r) => acc + netOf(r), 0);
    }
    const monthUnits = monthRows
      .filter((r) => (r.kind ?? "product") === "product")
      .reduce((acc, r) => acc + (Number(r.qty || 0) - Number(r.returned_qty || 0)), 0);

    const monthDays = Math.max(1, daysBetween(monthFrom, monthTo));
    const windowFrom = from ?? days[0] ?? monthFrom;
    const windowTo = to ?? lastDay;
    const windowDays = Math.max(1, daysBetween(windowFrom, windowTo));

    const currentValue = onlineSales + branchSales;
    const currentUnits = inBand.reduce((acc, r) => acc + r.qty, 0);
    const trend = {
      // Per day, on both sides, so any window length compares like for like.
      current: {
        from: windowFrom,
        to: windowTo,
        days: windowDays,
        value: currentValue / windowDays,
        units: currentUnits / windowDays,
      },
      baseline: {
        label: `daily average, ${baseMonth}`,
        from: monthFrom,
        to: monthTo,
        days: monthDays,
        value: (monthBranchSales + monthOnlineSales) / monthDays,
        units: monthUnits / monthDays,
      },
    };

    return NextResponse.json({
      ok: true,
      filters: { from, to, room, category, subcategory, minPrice, maxPrice, channel, branch },
      coverage: { first: days[0] ?? null, last: days[days.length - 1] ?? null, rows: rows.length },
      totals: {
        units: inBand.reduce((acc, r) => acc + r.qty, 0),
        // gross = the product lines. discounts are negative. totalSales is what
        // was actually billed, and is the figure comparable with the rest of
        // the dashboard.
        gross: inBand.reduce((acc, r) => acc + r.value, 0),
        discounts: discountValue,
        shipping: shippingValue,
        totalSales: onlineSales + branchSales,
        priceFiltered,
        onlineSource,
        products: byProduct.size,
        returnedUnits: inBand.reduce((acc, r) => acc + r.returnedQty, 0),
        returnedValue: inBand.reduce((acc, r) => acc + r.returnedValue, 0),
        soldUnits: inBand.reduce((acc, r) => acc + r.soldQty, 0),
      },
      // Most-returned first — the list worth acting on.
      returnedProducts: [...byProduct.entries()]
        .map(([product_id, v]) => ({ product_id, ...v }))
        .filter((p) => p.returnedUnits > 0)
        .sort((a, b) => b.returnedValue - a.returnedValue)
        .slice(0, 10),
      // Returns, split the same way as sales, so you can see which side of the
      // business the goods come back from.
      returnsByChannel: [
        {
          label: "Online",
          ...(() => {
            const l = inBand.filter((r) => isOnline(r.branch));
            return {
              units: l.reduce((a, r) => a + r.returnedQty, 0),
              value: l.reduce((a, r) => a + r.returnedValue, 0),
              orders: l.filter((r) => r.returnedQty > 0).length,
            };
          })(),
        },
        {
          label: "Branches",
          ...(() => {
            const l = inBand.filter((r) => !isOnline(r.branch));
            return {
              units: l.reduce((a, r) => a + r.returnedQty, 0),
              value: l.reduce((a, r) => a + r.returnedValue, 0),
              orders: l.filter((r) => r.returnedQty > 0).length,
            };
          })(),
        },
      ],
      channels: [
        { label: "Online", ...tally(inBand.filter((r) => isOnline(r.branch))), value: onlineSales },
        { label: "Branches", ...tally(inBand.filter((r) => !isOnline(r.branch))), value: branchSales },
      ],
      branches: [...new Set(rows.map((r) => r.branch))]
        .map((b) => ({
          label: b,
          ...tally(inBand.filter((r) => r.branch === b)),
          value: isOnline(b) ? onlineSales : salesOf((r) => r.branch === b),
        }))
        .sort((a, b) => b.value - a.value),
      rooms: sum(inBand, (r) => (r.room ?? "Other") as string),
      categories: sum(inBand, (r) => (r.category ?? "—") as string),
      // Carries its room so the bars can be coloured by room rather than all
      // one hue — colour follows the entity, so a filter never repaints it.
      subcategories: sum(inBand, (r) => (r.subcategory ?? "—") as string).map((sc) => ({
        ...sc,
        room: inBand.find((r) => (r.subcategory ?? "—") === sc.label)?.room ?? "Other",
      })),
      bands,
      timeseries,
      daily,
      monthly,
      trend,
      topProducts,
      slowProducts,
      // Everything the page needs to build its dropdowns, taken before the
      // room/category filters so choosing one does not empty the others.
      options: {
        rooms: [...new Set(allRows.map((r) => r.room).filter(Boolean))].sort() as string[],
        categories: [...new Set(allRows.map((r) => r.category).filter(Boolean))].sort() as string[],
        subcategories: [...new Set(allRows.map((r) => r.subcategory).filter(Boolean))].sort() as string[],
        branches: [...new Set(allRows.map((r) => r.branch).filter(Boolean))].sort() as string[],
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
