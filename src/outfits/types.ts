// Re-exports the outfit functions' response types so app code has one import path, while the
// functions' `handler.ts` files (Deno- and Node-safe) stay the single source of truth — same
// pattern as `src/closet/catalog.ts`'s re-export of `supabase/functions/_shared/catalog.ts`.
export type { RatingResult } from '../../supabase/functions/rate-outfit/handler.ts';
export type { LuckyOutfit, LuckyResponse } from '../../supabase/functions/lucky-list/handler.ts';
export type { RatingReason } from '../../supabase/functions/_shared/rating.ts';
export type { WeatherSummary } from '../../supabase/functions/_shared/weather.ts';
