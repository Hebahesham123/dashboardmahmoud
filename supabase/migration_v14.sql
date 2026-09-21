-- =============================================================
-- Migration v14 — separate product lines from discounts and shipping
--   Odoo files the discount and shipping products under the bare "NS Home"
--   category, with no sub-category of their own. v13 dropped them, which
--   made the Insights revenue a BEFORE-discount figure: for 1-14 Sep it
--   showed 491,848 of product lines while 95,409 of discount and 12,800 of
--   shipping sat outside the total.
--
--   They are kept now and marked, so per-category figures can stay on
--   product lines (a discount cannot be attributed to Towels) while the
--   headline can still show real total sales.
-- =============================================================

alter table public.product_sales
  add column if not exists kind text not null default 'product';  -- product | discount | shipping

create index if not exists product_sales_kind_idx on public.product_sales (kind);

-- Rows written by v13 are all product lines, which the default already says.
