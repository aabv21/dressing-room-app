-- An optional price per garment, for cost per wear in the garment detail and Stats
-- (docs/database.md).

alter table public.garments
  add column price numeric(10,2),
  add column currency text,
  add constraint garments_price_check check (price >= 0),
  -- ISO 4217's shape; the app only offers real codes, so the list itself isn't enforced here.
  add constraint garments_currency_check check (currency ~ '^[A-Z]{3}$'),
  -- An amount is meaningless without its currency, and amounts in different currencies are never summed.
  add constraint garments_price_currency_check check ((price is null) = (currency is null));

comment on column public.garments.price is
  'What the user paid, in garments.currency; null when not given. Cost per wear is price / max(wear_count, 1).';
comment on column public.garments.currency is
  'The ISO 4217 code of garments.price; set exactly when price is.';

-- Same column-grant pattern as status, pinned_on and suggest: update is revoked on garments, and
-- each client-editable column is granted back.
grant update (price, currency) on public.garments to authenticated;
