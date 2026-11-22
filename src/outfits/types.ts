// The outfit functions' response types, re-exported so app code has one import path while each
// `handler.ts` stays the source of truth (as `src/closet/catalog.ts` does for `_shared/catalog.ts`).
export type { RatingResult } from '../../supabase/functions/rate-outfit/handler.ts';
export type { LuckyOutfit, LuckyResponse } from '../../supabase/functions/lucky-list/handler.ts';
export type { ForYouCard, ForYouResponse } from '../../supabase/functions/for-you/handler.ts';
export type { RatingReason } from '../../supabase/functions/_shared/rating.ts';
export type { WeatherSummary } from '../../supabase/functions/_shared/weather.ts';
