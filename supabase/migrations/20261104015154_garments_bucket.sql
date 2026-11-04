-- The `garments` storage bucket: private, 2 MiB limit, three image MIME types,
-- with per-user folder isolation (<user_id>/<anything>) enforced by RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'garments',
  'garments',
  false,
  2097152,
  array['image/webp', 'image/png', 'image/jpeg']
);

create policy "garments_select_own" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "garments_insert_own" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "garments_update_own" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "garments_delete_own" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'garments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
