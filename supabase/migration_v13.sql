-- =============================================================
-- Migration v13 — product sales by category (Odoo analytics invoices)
--   One row per day / branch / product, so the Insights page can group by
--   room, category and price band without hitting Odoo live (508k invoice
--   lines since 2025 — far too slow to read per request).
--
--   Odoo's taxonomy is "NS Home / <category>/<subcategory>", e.g.
--   "NS Home / Bathroom Textile/Towels". Both halves are split out on the
--   way in so they can be grouped without parsing strings in SQL.
-- =============================================================

create table if not exists public.product_sales (
  day          date    not null,
  branch       text    not null,
  product_id   bigint  not null,
  product_name text,
  room         text,               -- Bedroom / Living Room / Bathroom / Other
  category     text,               -- e.g. "Bathroom Textile"
  subcategory  text,               -- e.g. "Towels"
  qty          numeric not null default 0,
  value        numeric not null default 0,  -- refund-signed
  updated_at   timestamptz not null default now(),
  primary key (day, branch, product_id)
);

create index if not exists product_sales_day_idx         on public.product_sales (day);
create index if not exists product_sales_room_idx        on public.product_sales (room);
create index if not exists product_sales_subcategory_idx on public.product_sales (subcategory);
create index if not exists product_sales_product_idx     on public.product_sales (product_id);

alter table public.product_sales enable row level security;

drop policy if exists "product_sales public read" on public.product_sales;
create policy "product_sales public read"
  on public.product_sales for select
  using (true);

grant select on public.product_sales to anon, authenticated;
