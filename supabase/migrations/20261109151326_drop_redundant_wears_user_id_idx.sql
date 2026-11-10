-- `wears_user_id_idx` on `wears (user_id)` is redundant: `wears_user_id_worn_on_idx` on
-- `wears (user_id, worn_on desc)` leads with the same column, so it already serves every lookup by
-- `user_id` (RLS's `user_id = auth.uid()`, the account-deletion cascade from auth.users, the data
-- export) while the extra index only added a write on every logged and deleted wear.

drop index public.wears_user_id_idx;
