// Re-exports the shared garment catalog so app code has one import path, while the single
// source of truth stays import-free (Deno- and Node-safe) for the extraction function — see
// `supabase/functions/_shared/catalog.ts`'s module doc.
export * from '../../supabase/functions/_shared/catalog.ts';
