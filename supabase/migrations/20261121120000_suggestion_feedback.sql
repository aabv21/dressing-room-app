-- Suggestion feedback and saved outfits: `public.dismissed_outfits` (combinations the user asked
-- Today not to suggest again), `garments.suggest` (a piece the user took out of suggestions),
-- `outfits.score` with `save_outfit(p_garment_ids, p_score)`, and a delete path for saved outfits
-- (docs/database.md).

-- public.dismissed_outfits ---------------------------------------------------------------------

create table public.dismissed_outfits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outfit_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_key),
  -- The app's outfit identity: the garment ids sorted and joined by commas (2–6 pieces, as rated).
  constraint dismissed_outfits_outfit_key_check check (
    outfit_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){1,5}$'
  )
);

comment on table public.dismissed_outfits is
  'Outfits the user asked not to be suggested again ("Not for me" on Today). lucky-list leaves '
  'them out of its candidates. The primary key leads with user_id, so it serves the per-user read.';

alter table public.dismissed_outfits enable row level security;

create policy "dismissed_outfits_select_own" on public.dismissed_outfits
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "dismissed_outfits_insert_own" on public.dismissed_outfits
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "dismissed_outfits_delete_own" on public.dismissed_outfits
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.dismissed_outfits from anon;

-- No update path: a dismissal is added or removed, never edited, so update is revoked outright
-- rather than left to a missing policy (which would match zero rows instead of raising).
revoke update, truncate, trigger, references on public.dismissed_outfits from authenticated;

-- public.garments: suggest ---------------------------------------------------------------------

alter table public.garments add column suggest boolean not null default true;

comment on column public.garments.suggest is
  'False when the user took the piece out of suggestions ("Not for me" on Today, or the garment '
  'detail''s switch). lucky-list and for-you build no outfit with it; it still counts as owned.';

-- Same column-grant pattern as status and pinned_on: update is revoked on garments, and each
-- client-editable column is granted back.
grant update (suggest) on public.garments to authenticated;

-- public.outfits: score, and deleting a saved outfit -----------------------------------------------

alter table public.outfits
  add column score smallint,
  add constraint outfits_score_check check (score between 0 and 100);

comment on column public.outfits.score is
  'The rating shown when the outfit was saved (0–100); null when unknown (worn outfits, or saved '
  'by an older app build).';

-- A new signature, so the one-argument function goes; older builds calling with p_garment_ids
-- alone still resolve to this one through the default.
drop function public.save_outfit(uuid[]);

create function public.save_outfit(p_garment_ids uuid[], p_score smallint default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_outfit_id uuid;
  v_owned_count integer;
begin
  if p_garment_ids is null
     or cardinality(p_garment_ids) < 2
     or cardinality(p_garment_ids) <> (select count(*) from (select distinct unnest(p_garment_ids)) d)
  then
    raise exception using errcode = '22023', message = 'save_outfit requires at least 2 distinct garment ids';
  end if;

  select count(*) into v_owned_count
  from public.garments
  where id = any(p_garment_ids);

  if v_owned_count <> cardinality(p_garment_ids) then
    raise exception using errcode = '42501', message = 'save_outfit: one or more garments are not the caller''s own';
  end if;

  insert into public.outfits (saved_at, score) values (now(), p_score) returning id into v_outfit_id;

  insert into public.outfit_items (outfit_id, garment_id)
  select v_outfit_id, g from unnest(p_garment_ids) as g;

  return v_outfit_id;
end;
$$;

comment on function public.save_outfit(uuid[], smallint) is
  'Inserts an outfit with saved_at = now(), the given score (or null) and its items, with the same '
  'validation as log_wear(). security invoker, so the outfits/outfit_items insert policies gate it.';

revoke execute on function public.save_outfit(uuid[], smallint) from public, anon;
grant execute on function public.save_outfit(uuid[], smallint) to authenticated;

-- Only a saved outfit no wear points at: deleting a worn one would cascade its wears after its
-- outfit_items were gone, so the wear-count trigger could no longer lower any count.
create policy "outfits_delete_saved_own" on public.outfits
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and saved_at is not null
    and not exists (select 1 from public.wears w where w.outfit_id = outfits.id)
  );

-- 20261108120000_outfits_wears_caches.sql revoked delete outright; the policy above now gates it.
-- outfit_items keeps delete revoked: its rows go through the FK cascade only.
grant delete on public.outfits to authenticated;

-- The Saved list: the caller's saved outfits, newest first. Partial, so worn outfits add nothing.
create index outfits_user_id_saved_at_idx on public.outfits (user_id, saved_at desc) where saved_at is not null;
