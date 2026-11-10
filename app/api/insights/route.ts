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
  invoices?: string[]; // sales invoice numbers (migration_v19)
}

/** Distinct orders behind a set of rows: one invoice counts once, however many
 *  of its products are in the set. */
const ordersOf = (list: { invoices?: string[] }[]) => {
  const s = new Set<string>();
  for (const r of list) for (const i of r.invoices ?? []) s.add(i);
  return s.size;
};

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
    let allRows = await read(`${COLS},kind,invoices`);
    if (allRows.length === 0) allRows = await read(`${COLS},kind`);
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
    // Order numbers exist once migration_v19 has run and the backfill has
    // filled them. Until then order counts below are null and the page says so.
    const hasInvoices = productRows.some((r) => (r.invoices?.length ?? 0) > 0);
    const countOrders = (list: { invoices?: string[] }[]) => (hasInvoices ? ordersOf(list) : null);
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

    /**
     * Odoo books a discount against no category, so a room cannot be told what
     * share of one it caused. The discount is spread across the product lines
     * in proportion to their value — a uniform factor, which is what pro-rata
     * by value comes to — so every per-category figure is after discount and
     * the parts still add up to the whole they came from.
     *
     * It is an apportionment, not a fact about any single sale, and the page
     * says so.
     */
    const grossAll = productRows.reduce(
      (acc, r) => acc + (Number(r.value || 0) - Number(r.returned_value || 0)),
      0
    );


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
    let shopifyOrders = 0;
    // Orders per branch, the same counts the Summary page shows. product_sales
    // has no invoice numbers, so orders can only come from here — which means
    // they exist only for the whole channel, not for a room or a price band.
    const branchOrders = new Map<string, number>();
    if (!categoryFiltered) {
      let q = sb.from("daily_metrics").select("day,total_sales,orders_count");
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const { data: dm } = await q;
      for (const r of (dm ?? []) as { total_sales: number; orders_count: number }[]) {
        shopifyOnline += Number(r.total_sales || 0);
        shopifyOrders += Number(r.orders_count || 0);
      }

      let bq = sb.from("offline_branch_sales").select("day,branch,orders");
      if (from) bq = bq.gte("day", from);
      if (to) bq = bq.lte("day", to);
      const { data: bo } = await bq;
      for (const r of (bo ?? []) as { branch: string; orders: number }[]) {
        const k = (r.branch ?? "").trim();
        branchOrders.set(k, (branchOrders.get(k) ?? 0) + Number(r.orders || 0));
      }
    }
    const onlineSource = categoryFiltered ? "odoo" : "shopify";

    /**
     * Whether the website belongs in this view at all.
     *
     * The Shopify total is read whole, with no branch in it, so it was being
     * added however the page was filtered: picking مدينة نصر reported 323,311
     * — its own 123,405 plus the entire website's 199,906. A shop's figure has
     * to be the shop's.
     */
    const includeOnline = channel !== "offline" && (!branch || isOnline(branch));
    /**
     * Pieces the way the Summary page counts them. Shops: pieces sold on Odoo
     * invoices, returns not taken off (Summary lists them apart). Online: the
     * Shopify order lines, cancelled orders left out. Odoo invoices website
     * orders in batches, so its shopify branch on one day can hold the pieces
     * of many older orders — which read "12 orders · 441 pcs" beside Shopify's
     * order count. Shopify knows no rooms, so a room, sub-category or price
     * filter falls back to Odoo's online lines.
     */
    const shopifyPieces = onlineSource === "shopify" && includeOnline;
    const onlinePiecesByDay = new Map<string, number>();
    if (shopifyPieces) {
      const [cancelledRows, items] = await Promise.all([
        pageAll<{ id: number }>(() => sb.from("orders").select("id").not("cancelled_at", "is", null) as never),
        pageAll<{ order_id: number; quantity: number; order_date: string }>(
          () => sb.from("order_items").select("order_id,quantity,order_date") as never
        ),
      ]);
      const cancelled = new Set(cancelledRows.map((o) => o.id));
      for (const it of items) {
        if (cancelled.has(it.order_id)) continue;
        const d = (it.order_date ?? "").slice(0, 10);
        if (!d) continue;
        onlinePiecesByDay.set(d, (onlinePiecesByDay.get(d) ?? 0) + Number(it.quantity || 0));
      }
    }
    const onlinePiecesIn = (lo: string | null, hi: string | null) => {
      let n = 0;
      for (const [d, q] of onlinePiecesByDay) if ((!lo || d >= lo) && (!hi || d <= hi)) n += q;
      return n;
    };
    const soldOf = (list: { soldQty: number }[]) => list.reduce((a, r) => a + r.soldQty, 0);
    /** Pieces for a set of product lines over [lo, hi]. */
    const piecesOf = (list: typeof inBand, lo: string | null, hi: string | null) =>
      soldOf(list.filter((r) => !isOnline(r.branch))) +
      (shopifyPieces ? onlinePiecesIn(lo, hi) : soldOf(list.filter((r) => isOnline(r.branch))));
    const onlinePieces = shopifyPieces
      ? onlinePiecesIn(from, to)
      : soldOf(inBand.filter((r) => isOnline(r.branch)));

    const netOf = (r: { value: number; returned_value: number }) =>
      Number(r.value || 0) - Number(r.returned_value || 0);
    const salesOf = (pred: (r: { branch: string }) => boolean) =>
      priceFiltered
        ? inBand.filter(pred).reduce((a, r) => a + r.value, 0)
        : rows.filter(pred).reduce((a, r) => a + netOf(r), 0);

    const onlineSales = !includeOnline
      ? 0
      : onlineSource === "shopify"
        ? shopifyOnline
        : salesOf((r) => isOnline(r.branch));
    const branchSales = salesOf((r) => !isOnline(r.branch));
    const totalSales = onlineSales + branchSales;

    // Scale the per-category figures so they add up to the total they came
    // from. Everything unattributable rides along pro-rata: the discount Odoo
    // books against no category, the shipping line, and the gap between Odoo's
    // copy of the website and Shopify's own. Before this the rooms summed to
    // 657,677 under a 744,060 total and there was no way to see why.
    const netFactor = grossAll > 0 ? totalSales / grossAll : 1;
    const net = (v: number) => v * netFactor;

    const sum = <K extends string>(list: typeof inBand, key: (r: (typeof inBand)[number]) => K) => {
      const m = new Map<K, { units: number; value: number; rows: typeof inBand }>();
      for (const r of list) {
        const k = key(r);
        const e = m.get(k) ?? { units: 0, value: 0, rows: [] };
        e.units += r.qty;
        e.value += r.value;
        e.rows.push(r);
        m.set(k, e);
      }
      return [...m.entries()]
        .map(([label, v]) => ({ label, units: v.units, value: net(v.value), orders: countOrders(v.rows) }))
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
        invoiceSet: Set<string>;
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
        invoiceSet: new Set<string>(),
      };
      for (const i of r.invoices ?? []) e.invoiceSet.add(i);
      e.units += r.qty;
      e.value += r.value;
      e.returnedUnits += r.returnedQty;
      e.returnedValue += r.returnedValue;
      if (r.qty > 0 && r.day > e.lastSold) e.lastSold = r.day;
      byProduct.set(r.product_id, e);
    }
    const products = [...byProduct.entries()].map(([product_id, { invoiceSet, ...v }]) => ({
      product_id,
      ...v,
      value: net(v.value),
      orders: hasInvoices ? invoiceSet.size : null,
    }));
    const topProducts = [...products].sort((a, b) => b.value - a.value).slice(0, 10);

    // Slow movers: fewest units shifted, among things that did sell. Products
    // with no net movement (a sale cancelled by its refund) are a different
    // problem and would crowd out the genuinely slow ones. `lastSold` is the
    // column that makes the list actionable — a low count from last week is
    // not the same as a low count from March.
    // Slowest = fewest orders once order numbers are stored, else fewest pieces.
    const slowProducts = products
      .filter((p) => p.units > 0)
      .sort((a, b) =>
        hasInvoices
          ? (a.orders ?? 0) - (b.orders ?? 0) || a.value - b.value
          : a.units - b.units || a.value - b.value
      )
      .slice(0, 10);

    const bands = PRICE_BANDS.map((b) => {
      const hit = inBand.filter((r) => r.unit >= b.min && (b.max === null || r.unit < b.max));
      return {
        label: b.label,
        min: b.min,
        max: b.max,
        units: hit.reduce((s, r) => s + r.qty, 0),
        value: net(hit.reduce((s, r) => s + r.value, 0)),
        orders: countOrders(hit),
      };
    });

    const tally = (list: typeof inBand) => ({
      units: list.reduce((acc, r) => acc + r.qty, 0),
      value: list.reduce((acc, r) => acc + r.value, 0),
      orders: countOrders(list),
    });

    const days = rows.map((r) => r.day).sort();

    // The charts do not need apportioning: summing every line of a day, the
    // discount ones included, is exact. Online comes from Shopify per day so a
    // column and the headline agree.
    const onlineByDay = new Map<string, number>();
    if (onlineSource === "shopify" && includeOnline) {
      const { data: dmAll } = await sb.from("daily_metrics").select("day,total_sales");
      for (const r of (dmAll ?? []) as { day: string; total_sales: number }[]) {
        onlineByDay.set((r.day ?? "").slice(0, 10), Number(r.total_sales || 0));
      }
    }
    const seriesFor = (src: Row[], keyOf: (day: string) => string) => {
      const m = new Map<string, { units: number; value: number; inv: Set<string> }>();
      const touch = (k: string) => {
        const e = m.get(k) ?? { units: 0, value: 0, inv: new Set<string>() };
        m.set(k, e);
        return e;
      };
      for (const r of src) {
        const e = touch(keyOf(r.day));
        if ((r.kind ?? "product") === "product") {
          // Pieces as Summary counts them; Shopify's online pieces are added below.
          if (!(shopifyPieces && isOnline(r.branch))) e.units += Number(r.qty || 0);
          for (const i of r.invoices ?? []) e.inv.add(i);
        }
        // Online value comes from Shopify below; Odoo's copy of it is skipped.
        if (onlineSource === "shopify" && includeOnline && isOnline(r.branch)) continue;
        e.value += netOf(r);
      }
      if (onlineSource === "shopify" && includeOnline) {
        const lo = src.length ? src.reduce((a, r) => (r.day < a ? r.day : a), src[0].day) : null;
        const hi = src.length ? src.reduce((a, r) => (r.day > a ? r.day : a), src[0].day) : null;
        for (const [day, v] of onlineByDay) {
          if (lo && hi && (day < lo || day > hi)) continue;
          touch(keyOf(day)).value += v;
        }
      }
      if (shopifyPieces) {
        const lo = src.length ? src.reduce((a, r) => (r.day < a ? r.day : a), src[0].day) : null;
        const hi = src.length ? src.reduce((a, r) => (r.day > a ? r.day : a), src[0].day) : null;
        for (const [day, q] of onlinePiecesByDay) {
          if (lo && hi && (day < lo || day > hi)) continue;
          touch(keyOf(day)).units += q;
        }
      }
      return [...m.entries()]
        .map(([label, v]) => ({
          label,
          units: v.units,
          value: v.value,
          orders: hasInvoices ? v.inv.size : null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    };

    const byMonth = new Map<string, { units: number; value: number }>();
    for (const r of inBand) {
      const m = r.day.slice(0, 7);
      const e = byMonth.get(m) ?? { units: 0, value: 0 };
      e.units += r.qty;
      e.value += r.value;
      byMonth.set(m, e);
    }
    const timeseries = seriesFor(rows, (d) => d.slice(0, 7));

    // Months across the whole record, ignoring the date filter but keeping the
    // rest: the day chart answers "how is this month going", this one answers
    // "how do the months compare", and that second question is not about the
    // selected window. It needs its own read — the main one is date-bounded.
    let allTimeRows = allRows;
    if (from || to) {
      allTimeRows = await read(`${COLS},kind,invoices`, null, null);
      if (allTimeRows.length === 0) allTimeRows = await read(`${COLS},kind`, null, null);
    }
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
    const monthly = seriesFor(allTimeScoped, (d) => d.slice(0, 7));

    // The same shape by day. A short window wants days; a long one wants
    // months, and the page picks whichever suits the range it is showing.
    const byDay = new Map<string, { units: number; value: number }>();
    for (const r of inBand) {
      const e = byDay.get(r.day) ?? { units: 0, value: 0 };
      e.units += r.qty;
      e.value += r.value;
      byDay.set(r.day, e);
    }
    const daily = seriesFor(rows, (d) => d);

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
    if (onlineSource === "shopify" && includeOnline) {
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
      monthOnlineSales = includeOnline
        ? monthRows.filter((r) => isOnline(r.branch)).reduce((acc, r) => acc + netOf(r), 0)
        : 0;
    }
    const monthProductRows = monthRows.filter((r) => (r.kind ?? "product") === "product");
    const monthUnits =
      monthProductRows
        .filter((r) => !(shopifyPieces && isOnline(r.branch)))
        .reduce((acc, r) => acc + Number(r.qty || 0), 0) + (shopifyPieces ? onlinePiecesIn(monthFrom, monthTo) : 0);
    const monthOrders = countOrders(monthProductRows);

    const monthDays = Math.max(1, daysBetween(monthFrom, monthTo));
    const windowFrom = from ?? days[0] ?? monthFrom;
    const windowTo = to ?? lastDay;
    const windowDays = Math.max(1, daysBetween(windowFrom, windowTo));

    const currentValue = onlineSales + branchSales;
    const currentUnits = piecesOf(inBand, from, to);
    // Both sides of the orders trend count Odoo invoices, so they compare like
    // for like (the headline online count is Shopify's, on its own clock).
    const currentOrdersOdoo = countOrders(inBand);
    const trend = {
      // Per day, on both sides, so any window length compares like for like.
      current: {
        from: windowFrom,
        to: windowTo,
        days: windowDays,
        value: currentValue / windowDays,
        units: currentUnits / windowDays,
        orders: currentOrdersOdoo === null ? null : currentOrdersOdoo / windowDays,
      },
      baseline: {
        label: `daily average, ${baseMonth}`,
        from: monthFrom,
        to: monthTo,
        days: monthDays,
        value: (monthBranchSales + monthOnlineSales) / monthDays,
        units: monthUnits / monthDays,
        orders: monthOrders === null ? null : monthOrders / monthDays,
      },
    };

    // Headline orders. For the whole channel: Shopify orders online plus each
    // shop's invoice count — the Summary page's numbers. Drilled into a room,
    // sub-category or price band: distinct invoices holding something in it.
    const shopsInView = [...new Set(rows.filter((r) => !isOnline(r.branch)).map((r) => r.branch.trim()))];
    const totalOrders = categoryFiltered
      ? countOrders(inBand)
      : (includeOnline ? shopifyOrders : 0) + shopsInView.reduce((a, b) => a + (branchOrders.get(b) ?? 0), 0);

    return NextResponse.json({
      ok: true,
      filters: { from, to, room, category, subcategory, minPrice, maxPrice, channel, branch },
      coverage: {
        first: days[0] ?? null,
        last: days[days.length - 1] ?? null,
        rows: rows.length,
        // Rows held regardless of the date filter, so the page can tell "no
        // sales that day" apart from "nothing synced yet".
        stored: allTimeRows.length,
        latest: [...allTimeRows].map((r) => r.day).sort().pop() ?? null,
      },
      totals: {
        units: currentUnits,
        orders: totalOrders,
        hasInvoices,
        // gross = the product lines. discounts are negative. totalSales is what
        // was actually billed, and is the figure comparable with the rest of
        // the dashboard.
        gross: grossAll,
        netFactor,
        discounts: discountValue,
        shipping: shippingValue,
        totalSales,
        priceFiltered,
        onlineSource,
        includeOnline,
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
      // `orders` is a real order count (Shopify orders online, Odoo invoices in
      // the shops) when the view is the whole channel, and null once a room,
      // sub-category or price band is picked — no order count exists there.
      channels: [
        {
          label: "Online",
          ...tally(inBand.filter((r) => isOnline(r.branch))),
          units: onlinePieces,
          value: onlineSales,
          orders: categoryFiltered
            ? countOrders(inBand.filter((r) => isOnline(r.branch)))
            : includeOnline
              ? shopifyOrders
              : 0,
        },
        {
          label: "Branches",
          ...tally(inBand.filter((r) => !isOnline(r.branch))),
          units: soldOf(inBand.filter((r) => !isOnline(r.branch))),
          value: branchSales,
          orders: categoryFiltered
            ? countOrders(inBand.filter((r) => !isOnline(r.branch)))
            : shopsInView.reduce((a, b) => a + (branchOrders.get(b) ?? 0), 0),
        },
      ],
      branches: [...new Set(rows.map((r) => r.branch))]
        .map((b) => ({
          label: b,
          ...tally(inBand.filter((r) => r.branch === b)),
          units: isOnline(b) ? onlinePieces : soldOf(inBand.filter((r) => r.branch === b)),
          value: isOnline(b) ? onlineSales : salesOf((r) => r.branch === b),
          orders: categoryFiltered
            ? countOrders(inBand.filter((r) => r.branch === b))
            : isOnline(b)
              ? shopifyOrders
              : (branchOrders.get(b.trim()) ?? 0),
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
