-- =============================================================
-- Migration v19 — order numbers on product sales
--   The Insights page counts orders, not pieces. product_sales is one row
--   per day / branch / product, so it cannot tell how many orders those
--   pieces came in. This keeps the sales invoice numbers behind each row
--   (credit notes left out), so the page can count distinct orders for any
--   room, sub-category, price band or product without counting a basket
--   twice.
--
--   After running this, re-run the backfill to fill it for past days:
--     npx tsx scripts/backfill-products.ts
-- =============================================================

alter table public.product_sales
  add column if not exists invoices text[] not null default '{}';
