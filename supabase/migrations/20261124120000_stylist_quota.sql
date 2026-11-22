-- The 'stylist' quota kind for the `stylist` function ("Ask your stylist", docs/ai.md#ask-your-stylist).
-- Nothing below uses the new value, so it commits with the rest (see 20261108120000).
alter type public.quota_kind add value 'stylist';
