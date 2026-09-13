-- =============================================================
-- Migration v12 — cashback redeemed IN THE SHOPS
--   A branch redemption shows up in the Odoo analytics invoices feed as a
--   negative line named like "0.05 LE per point on specific products".
--   That line carries the real redemption date, branch and amount, and the
--   invoice it sits on gives the basket it paid for — none of which the
--   cashback-report `used` flag can tell us (and that flag is unreliable:
--   coupons observed redeemed still read used = false).
--
--   Online redemptions are NOT stored here. Those come from the Shopify
--   order's discount_codes, and storing them twice would double-count.
-- =============================================================

create table if not exists public.cashback_redemptions (
  invoice_number text        primary key,   -- the redeeming branch invoice
  day            date        not null,      -- when it was redeemed
  branch         text,                      -- where it was redeemed
  customer_id    bigint,
  customer_name  text,
  cashback_used  numeric not null default 0, -- the discount line, positive
  invoice_gross  numeric not null default 0, -- the basket, before that discount
  coupon_code    text,                       -- matched voucher, when resolvable
  updated_at     timestamptz not null default now()
);

create index if not exists cashback_redemptions_day_idx    on public.cashback_redemptions (day);
create index if not exists cashback_redemptions_branch_idx on public.cashback_redemptions (branch);
create index if not exists cashback_redemptions_code_idx   on public.cashback_redemptions (coupon_code);

alter table public.cashback_redemptions enable row level security;

drop policy if exists "cashback_redemptions public read" on public.cashback_redemptions;
create policy "cashback_redemptions public read"
  on public.cashback_redemptions for select
  using (true);

grant select on public.cashback_redemptions to anon, authenticated;
