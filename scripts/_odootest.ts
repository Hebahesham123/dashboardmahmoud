import { config } from "dotenv";
config({ path: ".env.local" });
import { fetchOdooInvoices, aggregateOffline, odooConfig } from "../lib/odoo";
(async () => {
  const { filter } = odooConfig();
  const t0 = Date.now();
  // narrow window first to check latency + shape
  const rows = await fetchOdooInvoices("2025-03-01", "2025-03-07");
  console.log("fetched lines:", rows.length, "in", ((Date.now()-t0)/1000).toFixed(1)+"s");
  const types = new Set(rows.map(r=>r.customer_type));
  console.log("customer_types seen:", JSON.stringify([...types]));
  console.log("sample row:", JSON.stringify(rows[0]));
  const days = aggregateOffline(rows, filter);
  console.log("filter =", filter, " -> offline days:", days.length);
  console.log("aggregated:", JSON.stringify(days.slice(0,10)));
  process.exit(0);
})();
