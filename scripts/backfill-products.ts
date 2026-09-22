/**
 * One-time historical backfill of NS Home product sales into `product_sales`,
 * which is what the Insights page reads.
 *
 * /api/sync-products only walks a 3-day rolling window so it stays under
 * Vercel's 60s limit. The analytics feed holds roughly half a million invoice
 * lines since 2025, so "from the beginning" has to be filled in once, locally:
 *
 *   npx tsx scripts/backfill-products.ts 2025-01-01 2026-09-21
 *
 * Both dates are optional: default is 2025-01-01 → today, which is everything
 * on record. Fetches a week at a time so each Odoo request stays small, and is
 * safe to re-run — rows upsert on (day, branch, product_id).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fetchAnalyticsInvoices, aggregateProductSales } from "../lib/odoo";

config({ path: ".env.local" });

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

(async () => {
  const from = process.argv[2] || "2025-01-01";
  const to = process.argv[3] || ymd(new Date());

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Backfilling product sales ${from} → ${to}`);
  let totalRows = 0;
  let totalLines = 0;
  let totalValue = 0;

  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6) > to ? to : addDays(start, 6);
    const lines = await fetchAnalyticsInvoices(start, end);
    const rows = aggregateProductSales(lines);
    totalLines += lines.length;

    const now = new Date().toISOString();
    // Clear the week before writing it, so a shop renamed in Odoo does not
    // leave its old rows behind under the previous name.
    const { error: delErr } = await sb.from("product_sales").delete().gte("day", start).lte("day", end);
    if (delErr) throw new Error(`${start}: ${delErr.message}`);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now }));
      const { error } = await sb
        .from("product_sales")
        .upsert(chunk, { onConflict: "day,branch,product_id" });
      if (error) throw new Error(`${start}: ${error.message}`);
    }
    totalRows += rows.length;
    totalValue += rows.reduce((s, r) => s + r.value, 0);
    console.log(
      `  ${start} → ${end}: ${lines.length} lines, ${rows.length} product-days, ${Math.round(
        rows.reduce((s, r) => s + r.value, 0)
      ).toLocaleString()} EGP`
    );
  }

  console.log(
    `Done. ${totalLines.toLocaleString()} lines read, ${totalRows.toLocaleString()} rows written, ${Math.round(
      totalValue
    ).toLocaleString()} EGP of NS Home product sales.`
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
