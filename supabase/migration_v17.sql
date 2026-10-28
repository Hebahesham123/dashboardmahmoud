-- =============================================================
-- Migration v17 — abandoned checkouts, kept for good
--   Shopify only holds abandoned checkouts for about three months. The
--   WhatsApp Campaigns page saves them here every time it loads (and the
--   daily sync does too), so the twice-a-week sheets keep their history.
--
--   recovered_at is set when a checkout drops out of Shopify's open list
--   while still young enough that Shopify would have kept it — i.e. the
--   customer went on to buy. Those are left out of the sheets.
-- =============================================================

create table if not exists public.abandoned_checkouts (
  id            bigint primary key,           -- Shopify checkout id
  created_at    timestamptz not null,
  day           date not null,                -- Cairo date of the abandon
  mobile        text,                         -- cleaned: no 0, no +20
  phone_raw     text,                         -- as the customer typed it
  name          text,
  email         text,
  total_price   numeric not null default 0,
  recovered_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists abandoned_checkouts_day_idx on public.abandoned_checkouts (day);

alter table public.abandoned_checkouts enable row level security;
-- No public read policy: phone numbers are only read server-side with the service key.
