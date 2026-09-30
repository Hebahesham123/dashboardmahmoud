-- =============================================================
-- Migration v16 — online stock by type
--   A snapshot of what the website is holding, one row per product.
--   Shopify's product_type on an active product is already the NS Home
--   taxonomy ("Bathroom Textile/Towels", "Bed Linen/Duvet Covers"), the
--   same shape Odoo uses minus the "NS Home / " prefix, so stock and sales
--   line up on category without any matching by name.
--
--   Snapshot, not history: stock is what it is right now, and the Stock
--   page reports the current holding against sales for a chosen period.
-- =============================================================

create table if not exists public.stock_levels (
  product_id   bigint primary key,
  title        text,
  product_type text,               -- raw Shopify type, e.g. "Bathroom Textile/Towels"
  room         text,               -- Bedroom / Living Room / Bathroom / Other
  category     text,               -- e.g. "Bathroom Textile"
  subcategory  text,               -- e.g. "Towels"
  stock        integer not null default 0,   -- summed over the variants
  variants     integer not null default 0,
  price        numeric not null default 0,   -- the cheapest variant, as a guide
  status       text,
  updated_at   timestamptz not null default now()
);

create index if not exists stock_levels_room_idx        on public.stock_levels (room);
create index if not exists stock_levels_subcategory_idx on public.stock_levels (subcategory);

alter table public.stock_levels enable row level security;

drop policy if exists "stock_levels public read" on public.stock_levels;
create policy "stock_levels public read"
  on public.stock_levels for select
  using (true);

grant select on public.stock_levels to anon, authenticated;
