# How Dressing Room works

This page follows a garment from the camera to a rated outfit, then covers the other request
paths, the data model, failures, security, scaling and costs, the reasons behind each design
choice, and how to regenerate the diagrams.

![System context: the Expo app talks only to the Supabase project through its API gateway; the Edge Functions reach Postgres and Storage with the user's token or the service role and call Anthropic, TypeSafe, Open-Meteo and Apple, and a garment insert starts the extraction function](diagrams/system-context.svg)

System context: [interactive page](diagrams/system-context.html) · [source](diagrams/system-context.json)

The diagram tool [archify](https://github.com/tt-a1i/archify) generates the four diagrams on this
page from their JSON sources, and [Regenerating the diagrams](#regenerating-the-diagrams) below
shows how. Each interactive page adds search, focus and both color themes; open it in a browser.

## What the system does and where it runs

Dressing Room is a digital closet with an AI outfit rater. You photograph your clothes once; the
app then suggests an outfit each day, rates an outfit you build piece by piece, tracks what you
wear and suggests what's missing. It speaks English and Spanish.

It runs in three places:

- **The phone.** An Expo SDK 58 app (React Native 0.88, strict TypeScript, Expo Router) for iOS
  and Android. Background removal, resizing and the upload queue run here, and so do Stats and
  Diary, which are computed from the garments and wears already on the device.
- **One Supabase project.** Auth, Postgres 17 with row-level security on every table, a private
  Storage bucket, and seven Edge Functions. Every request from the app goes through the project's
  API gateway with the user's session token; the app holds no other credential.
- **Three AI and data services,** called only from the Edge Functions: Anthropic (Claude Haiku
  5.5), TypeSafe (its Jev judgment model) and Open-Meteo (weather and geocoding). Apple and Google
  only take part in sign-in, and Apple once more when an account is deleted.

Locally, the same Supabase stack runs in Docker (`pnpm db:start`), and every Claude, Jev,
Open-Meteo and Apple call goes to a mock on the host (`integration/mockAnthropic.ts`,
`integration/mockServices.ts`), so nothing local reaches a real API.

## What each component does

| Component | Runs | What it does |
|---|---|---|
| Expo app | Phone | Five tabs (Today, Closet, Build, For you, Profile) plus the camera, review, garment detail, rating and city screens. Keeps the closet, today's lucky list, the last For you ideas and the last fetched wear history in a key-value store for offline reading. |
| Upload queue | Phone | `src/closet/upload/`: a SQLite queue that takes each photo through prepare, upload and commit, saving the stage reached before the next starts. Two items at a time, backoff from 5 s doubling to 10 min, 8 attempts. |
| `garment-cutout` | Phone | A local native module: iOS 17+ Vision foreground masks and Android ML Kit subject segmentation remove the photo's background. Without it, the original photo is kept. |
| Auth | Supabase | Email and password (8 characters or more), Sign in with Apple and Sign in with Google through native ID tokens, and a 6-digit password-reset code by email. |
| Postgres 17 | Supabase | Profiles, garments, outfits, wears, the daily quota counters, the AI result caches and the Apple refresh tokens. RLS on every table. Garment writes are narrowed by column grants; the app creates outfits and wears through the `log_wear` and `save_outfit` RPCs, and RLS limits any direct insert, or a wear's delete, to the caller's own rows. |
| Storage | Supabase | The private `garments` bucket: `{user id}/{garment id}/full.webp` and `thumb.webp`, 2 MiB at most per object, with folder policies that match RLS. |
| `extract-attributes` | Edge Function | Called by the garment insert trigger through `pg_net`, with a shared secret header. Sends the photo to Claude and writes back enum-only attributes and the fields Claude doubted. |
| `rate-outfit` | Edge Function | Rates a built outfit with Jev, falls back to Claude, and searches a swap for a weak outfit. |
| `lucky-list` | Edge Function | Generates up to 200 candidate outfits from the closet, ranks the top 30 with Jev, and returns them with the day's weather. |
| `for-you` | Edge Function | Ranks about 40 wardrobe staples by how many new outfits each opens, weighted by a Jev fit, and returns 3–5 with a Claude line and a store-search query. |
| `apple-token` | Edge Function | Exchanges a Sign in with Apple authorization code for the refresh token deletion needs, and stores it only when the token's Apple user is the caller. |
| `delete-account` | Edge Function | Removes the caller's photos, revokes the Apple token and deletes the auth user, whose rows cascade. Safe to retry. |
| `export-data` | Edge Function | Returns the caller's profile, garments, outfits, wears and 7-day signed photo URLs as one JSON document. |
| Backup job | Owner's Mac | `pnpm backup` under launchd at 03:30: a database dump, every photo and a sha256 manifest, keeping the newest 14. |

Every user-called function runs with `verify_jwt = true`, so the gateway checks the session token
before the function runs; `extract-attributes` is the one exception, and it checks its own
secret instead. Each function folder has a runtime-neutral `handler.ts`, which the Jest
`functions` project tests under Node, and a small Deno `index.ts`. The prompts, schemas,
questions and weights are in [`ai.md`](ai.md), and the tables, policies and grants in
[`database.md`](database.md).

## How a garment gets into the closet

![Upload pipeline: a photo goes from the camera or gallery into the upload queue, which uploads both WebP files and inserts the garment row; the insert trigger calls extract-attributes, which reads the photo, asks Claude and writes the attributes back while the garment is still pending, and the app polls until the review queue can ask about the doubts](diagrams/upload-pipeline.svg)

Upload pipeline: [interactive page](diagrams/upload-pipeline.html) · [source](diagrams/upload-pipeline.json)

1. **Capture.** The burst camera takes one garment per shot; the gallery takes up to 30 photos at
   once. Each photo is copied into the app's own folder and gets a queue row with a garment id the
   phone generates.
2. **Prepare.** `garment-cutout` removes the background where it can. `preparePhoto` decodes the
   result once, capped at 784 px on the longest side, saves it as WebP at quality 0.8, and builds a
   256 px thumbnail at quality 0.7 from that image.
3. **Upload.** Both files go to `garments/{user id}/{garment id}/` as upserts, so a retried upload
   overwrites instead of duplicating. Uploads get 60 s; other requests 12 s.
4. **Commit.** The queue inserts the garment row with only its id and owner
   (`on conflict do nothing`, so a retry inserts nothing new), and deletes its local copy. A step
   that runs under another account's session refuses to run and waits for its owner.
5. **Extraction.** The insert trigger reads the function URL and secret from the Vault and queues a
   `pg_net` request, sent after the insert commits. `extract-attributes` counts the garment
   against the 100-a-day quota, downloads `full.webp` and asks Claude for its category, colors,
   pattern, material, formality, seasons, warmth, fit and occasions. The parser keeps only catalog
   values and marks anything dropped or low-confidence as doubtful. The write-back applies only
   while the garment is still `pending` and not yet reviewed.
6. **Review.** While a garment is pending, the closet refreshes every 5 s. The review queue then
   asks only the doubted fields, as quick choices. Any failure (over quota, a refusal, a timeout,
   or a row still pending after 10 minutes) sends the garment to review with empty fields, so the
   user fills it in by hand.

## How an outfit gets rated

![Rating sequence: the rating screen calls rate-outfit with the garment ids; the function reads the garments and profile with the user's token, gets the weather, checks the cache and the quota, asks Jev, falls back to Claude, searches a swap for a weak outfit, caches the result and answers](diagrams/rating-sequence.svg)

Rating sequence: [interactive page](diagrams/rating-sequence.html) · [source](diagrams/rating-sequence.json)

Build or Today pushes the rating screen with the outfit's garment ids (the function takes 2–6) and an
optional occasion:

1. **Request.** The app posts the ids, the occasion and its local date with the user's token, and
   gives function calls 45 s. A malformed body is a 400, a garment that isn't the caller's a 404,
   and a garment without a category, or an outfit without (a top and a bottom, or a one-piece) and
   shoes, a 422.
2. **Read with the user's token.** The garments and the profile are read through PostgREST with the
   caller's JWT, so RLS applies to the function too.
3. **Weather.** With the profile's coordinates, or a geocoded city name, the forecast for the hour
   comes from `weather_cache` or Open-Meteo (5 s each). With no city, the weather is unknown and
   rates as neutral.
4. **Cache and quota.** The cache key hashes each garment's rating-relevant columns, the profile's
   `updated_at`, the occasion, the season and the weather band. A hit answers at once and calls no
   model. A miss counts against 50 ratings a day; over it, the answer is 429.
5. **Jev.** One TypeSafe request holds eight Score questions, two hard-failure Nouls and the
   weakest-piece Choice, about a state of buckets and enum values only (10 s timeout). Code turns
   the answers into a 0–100 score with fixed weights; a hard failure caps it at 40.
6. **Claude fallback.** Only when Jev fails, Claude rates the same state against the same levels.
   That score is marked "estimated". If both fail, the answer is 503.
7. **Swap.** Below 70, with a weakest slot named, up to 8 other available garments of that slot
   that pass the outfit rules are rated with Jev, 5 at a time, and none starts after 15 s. The best
   is offered only when it beats the score by 5 points or more.
8. **Answer.** The result is cached (a degraded one, such as a Claude estimate, for an hour only),
   and the app shows the score, its label, Jev's confidence, template reasons and the swap.

## The other request paths

**Feeling lucky (Today).** Today calls `lucky-list` with the date and the day's optional occasion,
on focus and after a closet change (debounced). A closet without a top and bottom or one-piece,
and shoes, gets `too_small` with the missing slots and no model call. Otherwise a cache keyed by
the date, occasion, place, profile and a closet fingerprint answers, or, within 10 misses a day,
the function draws up to 200 candidate outfits that pass the season, formality and weather rules,
avoiding pieces worn in the last 7 days. It keeps the 30 best by a freshness pre-score, spread over
the closet, and ranks them with Jev (5 at once, none after 15 s, no Claude fallback). The app keeps
the last good list per occasion for the day, so Today stays readable offline. "I'll wear it" calls
the `log_wear` RPC with a wear id generated once per tap, so a retry never logs twice.

**For you.** The tab calls `for-you` with the app's language on focus, one request at a time. Fewer
than 3 wardrobe garments gets `too_small`. Otherwise a cache keyed by the wardrobe, the profile, the
season and the language answers for up to 7 days; a miss counts against 1 a day. The function
counts, for each staple the user doesn't own, the complete outfits it would make with the wardrobe
(up to 5,000), asks Jev for the top 10 how well each suits the user's body and style, and keeps
3–5 (at most 2 per slot). One Claude request writes a line for each idea, with no user data in it;
a missing line falls back to a template. Over the quota, the function serves the last entry it has
rather than a 429.

**Data export.** Profile → "Export my data" calls `export-data`, which reads the caller's rows
with the caller's token, signs each photo URL for 7 days with the service role, and returns one
JSON document that the app hands to the share sheet.

**Account deletion.** Profile → "Delete account" asks twice, writes a device marker, pauses the
upload queue and calls `delete-account`. The function confirms the caller with Auth, lists and
removes every object under the caller's folder, revokes the Apple token if there is one, deletes
the auth user (every table cascades) and sweeps the folder once more. The app reports the account
deleted only on that answer, or when Auth says the same token's user is gone; then it clears the
queue, signs out on the device, and removes every per-user key, the data exports and the image
caches. Any other failure keeps the marker and the paused queue, and the next launch, foreground or
reconnect only asks Auth whether the account still exists.

## What gets stored where

![Data model: auth.users owns every row through on-delete-cascade user_id keys; outfit_items and wears cascade from their outfit and garment; profiles, garments, outfits, outfit_items, wears and the photos are client tables under RLS, and the quota counters, result caches, Apple tokens and weather cache are service-role only](diagrams/data-model.svg)

Data model: [interactive page](diagrams/data-model.html) · [source](diagrams/data-model.json)

| Store | What it holds | How long |
|---|---|---|
| `public.profiles` | One row per user: clothing type, body type, height, optional chest, waist, hips and sizes, age group, styles, occasions, city and its coordinates, language | Until the account is deleted |
| `public.garments` | One row per garment: enum attributes, doubted fields, extraction status, status (available, laundry, lent, donated), photo version, wear count, last worn, a "Wear it" pin | Until the user deletes it or the account |
| `public.outfits`, `outfit_items`, `public.wears` | Saved and worn outfits, their pieces, and each wear's day, occasion and score | Until deleted (a wear from the diary) or the account |
| `garments` bucket | `full.webp` (784 px) and `thumb.webp` (256 px) per garment | Until the garment or the account is deleted |
| `public.usage_counters` | Per user, UTC day and kind: extraction, rating, lucky, for_you | Until the account is deleted |
| `public.rating_cache`, `lucky_cache`, `for_you_cache` | AI results by cache key; a degraded entry is served for an hour, a For you entry for 7 days | A daily `pg_cron` job deletes degraded entries after 2 hours, rating and lucky entries after 30 days and For you entries after 8 days, except each user's newest For you entry; the account's deletion removes the rest |
| `public.weather_cache` | Forecast summaries by place and hour, with no user id | 2 days (the same daily job; [`database.md`](database.md) has the details) |
| `public.apple_tokens` | The Sign in with Apple refresh token, for revocation | Until the account is deleted |
| Phone | The session, the upload queue and its photo copies, offline copies of the closet, lucky list, For you ideas and wear history, cached images | Copies go after upload; the rest until sign-out or deletion clears it |
| `~/dressing-room-backups/` | Nightly dumps and photos on the owner's Mac | The newest 14 complete backups |

## What happens when something fails

| Failure | Behavior | Recovery |
|---|---|---|
| The phone is offline or the app is killed mid-upload | The queue keeps each item's stage in SQLite, and the next launch, foreground or reconnect resumes it. Upserts and the client-generated id make a repeated stage harmless. | Automatic; after 8 attempts the item shows as failed, with retry and discard. |
| The insert's webhook never arrives, or the function answers 500 | The garment stays `pending`; 10 minutes after `created_at` the app sends it to review. | The user fills in the fields. |
| Claude refuses, times out (30 s) or answers outside the schema | `extract-attributes` marks the garment `failed` with empty attributes; nothing is retried. | The user fills in the fields. |
| The extraction quota is used up | `over_quota`, with no Claude call. | Manual entry; the quota resets at the next UTC day. |
| Jev fails, times out (10 s) or answers something that doesn't parse | `rate-outfit` falls back to Claude ("estimated", no swap); `lucky-list` keeps the pre-score order for unrated outfits; `for-you` ranks that idea at the fit floor of 0.3. Each such result is cached for an hour only. | Automatic; the next call after the hour recomputes. |
| Both Jev and Claude fail a rating | 503 `rating_unavailable`, nothing cached. | The user taps again. |
| Open-Meteo fails or the city can't be geocoded | The weather is unknown: weather fit is neutral and the unsafe-for-weather check is ignored. A failed forecast for known coordinates marks the lucky list degraded. | Automatic. |
| A daily quota is used up | Rating and lucky answer 429, and the app says so; For you serves its last entry first. | The next UTC day. |
| The network fails on Today or For you | The app shows the last good answer with an offline note. | The next focus or reconnect refetches. |
| "I'll wear it" without a connection (Today or the rating) | The wear goes to an on-device queue, the outfit shows Logged ✓ with "Logged — it syncs when you're back online.", and Stats and Diary count it. The queue is sent on the next launch, foreground or reconnect; the client wear id makes a resend harmless. A wear the server refuses (a garment deleted meanwhile) is dropped. | Automatic. Every other write (saving an outfit, garment edits and status changes, Donate, the "Wear it" pin, a Diary delete of a sent wear) needs the connection and shows its error instead: the owner's 2026-11-11 decision, so no edit can conflict with a later one. |
| The network fails on Stats or Diary | Both show the stored wear history with an "Offline — your history as of …" note; Diary's Delete is disabled meanwhile. A Diary month older than the stored range shows the load error. | The next focus refetches. |
| A deletion answer is lost | The marker stays, uploads stay paused, and the app says the deletion couldn't be confirmed. | The next check asks Auth: gone means the local cleanup; still there after 10 minutes lifts the marker. |
| A backup step fails | The run exits 1 and leaves its `.partial` folder; no complete backup is rotated away. | Fix the cause; the next run starts clean. |

## Security and privacy

- **No keys in the app.** The bundle holds only public values (the Supabase URL and anon key, the
  Google OAuth client ids), never a secret. Model keys and the service-role key live only in the
  Edge Functions' secrets and in owner scripts.
- **Isolation.** Every client table has RLS policies on the caller's own rows
  (`(select auth.uid())`), and Storage's folder policies do the same for photos. Column grants stop
  the client from writing `extraction_status`, `wear_count` or `user_id`. The app creates outfits
  and wears only through `log_wear` and `save_outfit`; a client can still insert into `outfits`,
  `outfit_items` and `wears`, or delete a wear, directly, but RLS limits that to its own rows, so
  the worst it can do is leave its own data inconsistent, never touch another user's
  ([`database.md`](database.md) has the details). The server-only tables have no policies and no
  client grants. pgTAP and integration tests try user A against user B's rows and objects.
- **Functions act as the caller.** The user-called functions read the caller's rows with the
  caller's token, so RLS applies to them too. The service role is used for the quota, the caches,
  the Apple tokens, the caller's own photo folder and, in `delete-account`, the auth user; the
  `extract-attributes` webhook, which has no user token, uses it for the one garment it was sent.
- **What reaches the models.** Claude sees a garment photo (cut out where possible, 784 px) and the
  clothing type for extraction, and the same bucketed state as Jev for a fallback rating. Jev sees
  only buckets and enum values: clothing type, body type, a height bucket, age group, styles,
  occasion, a weather band, season and each piece's attributes. Exact measurements, sizes, names and
  photos never reach Jev, and the rating functions never read chest, waist, hips or sizes.
- **Untrusted model output.** Every model answer goes through structured outputs and a parser that
  keeps only catalog values; reasons and swap wording come from templates, and For you's free-text
  lines are length-checked and shown as plain text. [`red-team.md`](red-team.md) maps each attack to
  its defense and test.
- **Spend limits.** Per-user daily quotas (100 extractions, 50 ratings, 10 lucky lists, 1 For you)
  count before any paid call, and caches answer repeats for free.
- **Logs.** Functions log an outcome word per call (and the garment id for extraction), never a
  photo, the profile, a prompt or a model answer.
- **Personal data.** Weight is never collected. The city is typed, or read once from the phone's
  location (when-in-use permission) and kept as a city name with coordinates rounded to two
  decimals. The [privacy policy](privacy-policy.md)
  ([español](privacy-policy.es.md)) lists every processor.
- **Backups** hold password hashes and live refresh tokens, so they stay on the owner's Mac, at
  `0600`/`0700`, never in the repository or GitHub.

## Scaling and costs

The app is sized for the owner's family, about 4 users, on Supabase's free tier. These are the
limits it would meet first:

- **Supabase free tier.** At the time of writing it allows 500 MB of database, 1 GB of storage and
  5 GB of egress, and the family needs about 100 MB of photos. Thumbnails download once into expo-image's
  disk cache. Free projects pause after a week without use. The upgrade is Supabase Pro.
- **Cache tables.** A daily `pg_cron` job prunes them (`prune_expired_caches()`), so they stay at
  about a month of rows. Its deletes scan each table, which is fine at a few thousand rows; an index
  on `created_at` would be the upgrade if they ever grow far larger.
- **TypeSafe rate limits.** A lucky-list miss makes up to 30 Jev requests, a swap search up to 8 and
  a For you miss up to 10, each at most 5 at once. A 429 from Jev looks like a failure, and each
  path degrades as the table above says.
- **The upload queue** runs two items at a time on the phone; the server work per garment is one
  function call and one Claude request.

Costs, from [`ai.md`](ai.md)'s "Quota and cost":

| Item | Cost |
|---|---|
| Extraction | about $0.0003 per garment (Claude Haiku 5.5), so about $0.18 for a 600-garment first load |
| A Jev rating | about $0.00004–0.00007 per request |
| Jev, typical use | about $0.65 a month for 4 users |
| Jev, worst case at the quotas | about $6 a month for 4 users |
| For you | about $0.0005 per cache miss, at most about $0.06 a month for 4 users |
| Open-Meteo | free, no key |
| Supabase | free tier |

Typical use fits a $1-a-month target. The quotas bound the spend but don't enforce that
target, so the owner session sets spend caps or alerts with Anthropic and TypeSafe.

## Design decisions and their trade-offs

- **Expo and React Native, over native SwiftUI and Jetpack Compose.** One TypeScript codebase for
  iOS and Android, with one small native module where it matters (background removal). The closet
  grid's scroll performance is the go/no-go check ([`performance-gate.md`](performance-gate.md)).
- **Supabase, over a custom backend.** Auth, Postgres with RLS, Storage and functions in one free
  project, all reproducible from migrations and testable locally in Docker.
- **Two kinds of AI, with code in charge.** Claude labels photos, where a vision model is needed;
  Jev answers narrow typed questions about outfits, which code combines with fixed weights into a
  score. Reasons and swap wording are templates, so the app never shows a model's prose except For
  you's short lines.
- **Buckets, not measurements, in every prompt.** Height becomes short, medium or tall, and the
  rest of the state is enums, so the models can't leak or be steered by personal detail.
- **On-device background removal and resizing, over server processing.** The photo leaves the phone
  already cut out and small, which saves upload time, storage and model tokens, and there's no
  image-processing server to run.
- **A server-triggered extraction, over the app calling Claude.** The insert trigger starts it, so
  extraction finishes even when the app closes right after the upload.
- **Stats and Diary on the device.** They're arithmetic over rows the app already has, so they cost
  no AI call and work offline.
- **Quotas and caches before any paid call.** Each function checks its cache, then the per-user
  quota, before it calls a model; a degraded result is cached for only an hour.
- **Templates and fallbacks everywhere a model can fail.** Extraction falls back to manual review,
  the rating to Claude, the lucky list to the pre-score, and For you's lines to templates.
- **A nightly backup on the owner's Mac, over a cloud copy.** The free tier has no downloadable
  backups, and the data is family data, so it stays local, encrypted at rest when FileVault is on.

## Regenerating the diagrams

Each diagram's source is a JSON file in `docs/diagrams/`. archify renders the `*.html` page from it,
and the `*.svg` image is that page's own export. Edit only the JSON, then regenerate the other two.

The diagram tool is [archify](https://github.com/tt-a1i/archify), a Node.js command-line tool that
needs no install. Keep it outside this repo, so `pnpm lint` doesn't scan its files, and set
`ARCHIFY` to its `bin/archify.mjs`. These sources were last validated, delivered and exported with
archify's 2.17 skill package (`2.17.0-dev.1`).

| Diagram | Type |
|---|---|
| `system-context.json` | `architecture` |
| `upload-pipeline.json` | `dataflow` |
| `rating-sequence.json` | `sequence` |
| `data-model.json` | `architecture` |

Run the commands from the repo root, because each source's `meta.output` path is relative to it.
For the system context:

1. `node "$ARCHIFY" validate architecture docs/diagrams/system-context.json --quality showcase --json`,
   after every edit, until it reports all 9 artifact checks passing with 0 composition errors and
   0 warnings.
2. `node "$ARCHIFY" deliver architecture docs/diagrams/system-context.json docs/diagrams/system-context.html --quality showcase --json`
   writes the page.
3. Open the page in a browser, choose **Export**, then **SVG**, and save the download over
   `docs/diagrams/system-context.svg`, which `README.md` and this page embed.
4. `node "$ARCHIFY" visual-check <copy>.html --json` checks a copy of the page in a real browser at
   four desktop sizes. It writes PNG screenshots next to the page, so run it on a copy outside the
   repo.

For the other three, run the same steps with each one's type and file names.
