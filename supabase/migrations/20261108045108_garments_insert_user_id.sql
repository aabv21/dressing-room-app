-- The app now sends the owner it queued a garment for (`{ id, user_id }`), so a
-- commit that runs under another account's session (a sign-out or user switch
-- while an upload is in flight) is rejected by `garments_insert_own`'s
-- `with check (user_id = (select auth.uid()))` instead of the column default
-- silently filing the garment under whoever is signed in.
--
-- Row level security still pins user_id to the caller: this grant only lets
-- the client state it.
grant insert (user_id) on public.garments to authenticated;
