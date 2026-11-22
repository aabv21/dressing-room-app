-- The 'buy_check' quota kind for the `buy-check` function ("Should I buy it?", docs/ai.md#should-i-buy-it).
-- Nothing below uses the new value, so it commits with the rest (see 20261108120000).
alter type public.quota_kind add value 'buy_check';
