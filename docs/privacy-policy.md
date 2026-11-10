# Dressing Room privacy policy

[Español](privacy-policy.es.md)

Last updated: November 9, 2026

Dressing Room is a digital closet app: you photograph your clothes, and it suggests outfits, rates
the outfits you build and keeps track of what you wear. This page explains what the app collects,
where it is kept, who processes it and how you can export or delete it. Questions go to
`<owner email>`.

## What the app collects

- **Your account.** Your email address and a password, which Supabase Auth stores only as a hash.
  If you sign in with Apple or Google instead, the app receives the identity token that service
  issues for you (with your email address, or Apple's private relay address if you chose to hide
  it). For Sign in with Apple, the server also keeps a refresh token, used only to revoke the app's
  access when you delete your account.
- **Your profile.** The clothing you wear (feminine, masculine or a bit of everything), and,
  only if you give them: your body type, height, chest, waist and hip measurements, clothing and
  shoe sizes, age group, the styles and occasions you like, your city and your language. Your
  weight is never asked for.
- **Your city.** You can type it, or let the app read your location once to find it. The app asks
  for location access only while you use it, and keeps the city's name and its coordinates rounded
  to two decimals (about 1 km), never your exact position. Your phone's own system turns the
  location into a city name.
- **Photos of your clothes.** Before a photo leaves your phone, the app removes its background on
  the device (when the phone supports it) and shrinks it to at most 784 pixels, plus a 256-pixel
  thumbnail. Only those two versions are uploaded. The app never saves to or reads from your photo
  library beyond the photos you pick.
- **Your closet.** Each garment's attributes (category, colors, pattern, material, formality,
  seasons, warmth, fit, occasions), its status (available, in the laundry, lent or donated) and how
  often you wear it.
- **What you wear.** The outfits you save or log as worn, with the day, the occasion and the score.
- **Usage counts.** How many AI requests of each kind you made each day, to enforce the daily
  limits, and the results of recent AI requests, so repeating one costs nothing.

The app has no ads, no analytics and no tracking, and your data is never sold.

## Where it is kept

Everything above is stored in one [Supabase](https://supabase.com) project: the database, the
sign-in service and a private storage area for the photos. Supabase also sends your sign-up
confirmation and password-reset codes to your email address, through the email service set up for
the project. Each row and each photo belongs to your account, and the database's security rules
let only your signed-in account read or change it. The app talks to Supabase over encrypted
connections and holds no other key.

Your phone also keeps a copy of your closet, today's outfit suggestions, your last "For you" ideas
and cached photos, so the app works offline. A photo waiting to upload is kept in the app's own
folder until it is uploaded.

## Who processes it

| Processor | What it receives | Why |
|---|---|---|
| Supabase | Everything listed above | Hosting: the database, sign-in, photo storage and the server functions that call the services below |
| Anthropic (Claude) | For each new garment, its prepared photo (cut out and at most 784 pixels) and the clothing type you chose. When the rating service is unavailable, the same anonymous summary that TypeSafe receives. For "For you", only generic descriptions of the suggested pieces, how many of your garments and outfits each one combines with, and the app's language (English or Spanish) to write the lines in, with nothing else about you. | Recognizing each garment's attributes; a backup outfit rating; the short lines on the "For you" cards |
| TypeSafe (Jev) | An anonymous summary only: your clothing type, body type, a height range (short, medium or tall), age group and styles; the occasion, the weather and the season; and each piece's category, colors, pattern, formality and fit. Never a photo, an exact measurement, a size, your name or your email. | Rating outfits and ranking suggestions |
| Open-Meteo | Your city's coordinates, or the city's name when there are none | The day's weather |
| Apple | Your Sign in with Apple identity, and, when you delete your account, a request to revoke the app's access | Sign-in, and ending that link when you leave |
| Google | Your Sign in with Google identity | Sign-in |
| Amazon SES | Your email address and the confirmation or reset code | Sending your account's emails |

The AI services receive these requests from the app's server, never directly from your phone, and
the app's server never sends them your photos except for the garment recognition described above.
When you tap "Search in stores" on a "For you" idea, your browser opens a Google search for generic
words such as "camel blazer women"; Google's own privacy policy applies to that search.

## How long it is kept

Your data stays until you delete it or delete your account. You can delete any garment (its photos
are removed too) or any logged wear at any time. The owner keeps a nightly backup of the database
and photos on their own computer, for recovery only, and keeps the 14 most recent ones; data you
delete disappears from the backups after the next 14 nightly backups (about two weeks when they run
every night).

Each processor above applies its own retention rules to what it receives from the app.

## Your choices: export and deletion

- **Export.** Profile → Privacy → "Export my data" gives you a file with your profile, garments,
  outfits and wears, plus links to your photos that work for 7 days.
- **Delete your account.** Profile → Privacy → "Delete account", confirmed twice, removes your
  photos, revokes Sign in with Apple if you used it, and deletes your account and every row that
  belongs to it. The app then clears its copy of your data on that phone and signs you out.

You can also change or clear any profile field at any time in the Profile tab, and choose not to
give your city or body details at all.

## Changes and contact

If this policy changes, the new version will be posted on this page with a new date. For any
question, or to ask for your data or its deletion, write to `<owner email>`.
