/**
 * One-time historical backfill of Odoo per-branch daily totals into
 * `offline_branch_sales` (and `offline_sales` from the same fetch).
 *
 * The /api/sync-odoo route only walks a 3-day rolling window so it stays under
 * Vercel's 60s limit, so a newly created table has no history — which makes the
 * Summary page's MTD / Last Month branch columns read ~0. Run this locally once
 * after adding the table (or after a gap in syncing):
 *
 *   npx tsx scripts/backfill-odoo-branches.ts 2026-05-01 2026-07-30
 *
 * Both dates are optional: default is 120 days back → today. Fetches in weekly
 * chunks so each Odoo request stays small.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  fetchOdooInvoices,
  aggregateOffline,
  aggregateOfflineByBranch,
  odooConfig,
} from "../lib/odoo";

config({ path: ".env.local" });

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

(async () => {
  const to = process.argv[3] || ymd(new Date());
  const from =
    process.argv[2] ||
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 120);
      return ymd(d);
    })();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing from .env.local");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { filter, excludeBranches } = odooConfig();
  const CHUNK = 7;
  let totalLines = 0;
  let branchRows = 0;
  let dayRows = 0;
  const branches = new Set<string>();

  console.log(`Backfilling Odoo branch totals ${from} → ${to} (${CHUNK}-day chunks)…`);

  for (let start = from; start <= to; start = addDays(start, CHUNK)) {
    const end = addDays(start, CHUNK - 1) > to ? to : addDays(start, CHUNK - 1);
    const rows = await fetchOdooInvoices(start, end);
    totalLines += rows.length;

    const days = aggregateOffline(rows, filter, excludeBranches);
    const byBranch = aggregateOfflineByBranch(rows, filter, excludeBranches);
    byBranch.forEach((b) => branches.add(b.branch));
    const now = new Date().toISOString();

    if (days.length) {
      const { error } = await sb
        .from("offline_sales")
        .upsert(days.map((d) => ({ ...d, updated_at: now })), { onConflict: "day" });
      if (error) throw error;
      dayRows += days.length;
    }
    if (byBranch.length) {
      const { error } = await sb
        .from("offline_branch_sales")
        .upsert(byBranch.map((d) => ({ ...d, updated_at: now })), { onConflict: "day,branch" });
      if (error) throw error;
      branchRows += byBranch.length;
    }

    console.log(
      `  ${start} → ${end}: ${rows.length} lines, ${days.length} days, ${byBranch.length} branch-days`
    );
  }

  console.log(
    `\nDone. ${totalLines} lines · ${dayRows} offline_sales rows · ${branchRows} offline_branch_sales rows`
  );
  console.log(`Branches seen: ${[...branches].join(", ") || "(none)"}`);
  process.exit(0);
})().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
