-- =============================================================
-- Migration v15 — count returns instead of hiding them
--   Until now a refund simply flipped the sign of the line it reversed, so
--   a returned towel quietly cancelled a sold one and the return itself was
--   invisible: you could see net units but never how much came back.
--
--   Sales and returns are now stored side by side. qty/value are sales only;
--   returned_qty/returned_value hold the credit notes as positive numbers.
--   Net is qty - returned_qty, which is what the old column used to mean.
-- =============================================================

alter table public.product_sales
  add column if not exists returned_qty   numeric not null default 0,
  add column if not exists returned_value numeric not null default 0;

-- Rows written before this are net figures with returns already folded in.
-- Re-run scripts/backfill-products.ts to restate them.
