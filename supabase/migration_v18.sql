-- =============================================================
-- Migration v18 — monthly sales targets per channel
--   One row per Summary column (a branch label such as "Maadi", or
--   "Website" for online). The Summary page edits these through
--   /api/targets. A channel with no row uses the default target
--   (500,000 a branch, 1,000,000 online).
-- =============================================================

create table if not exists public.sales_targets (
  channel     text primary key,              -- Summary column label
  target      numeric not null check (target >= 0),
  updated_at  timestamptz not null default now()
);

alter table public.sales_targets enable row level security;
-- No public policies: read and written server-side with the service key.
