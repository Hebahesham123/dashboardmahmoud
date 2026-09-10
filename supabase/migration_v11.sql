-- =============================================================
-- Migration v11 — NS Home cashback coupons (Odoo ns_loyalty_cashback)
--   One row per coupon issued against a branch invoice, pulled from
--   /api/analytics/cashback-report by /api/sync-cashback.
--
--   Cashback is EARNED at a branch (5% of the invoice) and REDEEMED
--   later — mostly on the website, where the code turns up in the
--   Shopify order's discount_codes. `code` is the join key between the
--   two sides, so keep it indexed.
-- =============================================================

create table if not exists public.cashback_coupons (
  id              bigint primary key,          -- ns.cashback.report id (= loyalty.card id)
  issued_at       timestamptz,                 -- order confirmation datetime
  issued_day      date not null,               -- issued_at, date part — the grouping key
  branch          text,                        -- issuing branch (raw Odoo name)
  code            text not null,               -- coupon code, e.g. 0448-3aae-4127
  customer_id     bigint,
  customer_name   text,
  phone           text,
  salesperson     text,
  discount_amount numeric not null default 0,  -- cashback earned (5% of the invoice)
  invoice_id      bigint,
  invoice_number  text,
  invoice_amount  numeric not null default 0,  -- the invoice that earned it
  used            boolean not null default false,
  currency        text,
  updated_at      timestamptz not null default now()
);

create index if not exists cashback_coupons_day_idx    on public.cashback_coupons (issued_day);
create index if not exists cashback_coupons_branch_idx on public.cashback_coupons (branch);
create index if not exists cashback_coupons_used_idx   on public.cashback_coupons (used);
-- Codes are unique per coupon; this is how a Shopify redemption is matched back
-- to the branch that issued the cashback.
create unique index if not exists cashback_coupons_code_idx on public.cashback_coupons (code);

alter table public.cashback_coupons enable row level security;

drop policy if exists "cashback_coupons public read" on public.cashback_coupons;
create policy "cashback_coupons public read"
  on public.cashback_coupons for select
  using (true);

grant select on public.cashback_coupons to anon, authenticated;

-- Per-day, per-branch issuance totals — what the Summary page reads.
create or replace view public.cashback_by_branch_day as
select
  issued_day                            as day,
  branch,
  count(*)                              as coupons,
  coalesce(sum(discount_amount), 0)     as cashback,
  coalesce(sum(invoice_amount), 0)      as invoiced,
  count(*) filter (where used)          as used_coupons,
  coalesce(sum(discount_amount) filter (where used), 0) as used_cashback
from public.cashback_coupons
group by issued_day, branch;

grant select on public.cashback_by_branch_day to anon, authenticated;
