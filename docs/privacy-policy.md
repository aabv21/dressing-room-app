# Dressing Room privacy policy

[Español](privacy-policy.es.md)

Last updated: November 21, 2026

Dressing Room is a digital closet app: you photograph your clothes, and it suggests outfits, rates
the outfits you build and keeps track of what you wear. This page explains what the app collects,
where it is kept, who processes it and how you can export or delete it. Questions go to
[hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

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
- **"Should I buy it?" photos.** A photo or screenshot of a piece you're thinking of buying is
  prepared the same way on your phone and sent to Anthropic for analysis, then compared with your
  closet. The app doesn't store the photo or the answer, and neither does the app's server;
  Anthropic handles the photo under its own retention rules (see "How long it is kept"). Only if you
  tap "Add to my closet" is it uploaded, like any garment photo.
- **"Ask your stylist" messages.** What you type or dictate in the chat, and the replies, are sent
  to Anthropic to answer them, together with a summary of your closet (each piece's category,
  colors, formality, seasons, wear count and status, and your clothing type and liked styles; no
  photos, measurements or other profile details), and, when it's useful to the answer, today's
  weather where you are (temperature, condition, season), never your city or location. The app keeps the conversation only while the
  screen is open, and neither the app nor its server stores the messages or the summary; Anthropic
  handles them under its own retention rules (see "How long it is kept").
- **Your closet.** Each garment's attributes (category, colors, pattern, material, formality,
  seasons, warmth, fit, occasions), its status (available, in the laundry, lent or donated), how
  often you wear it, whether you took it out of suggestions, and, only if you enter it, what you
  paid for it and in which currency (to show its cost per wear).
- **What you wear.** The outfits you save or log as worn, with the day, the occasion and the score.
- **Your plans and trips.** The outfit you planned for a day, up to 14 days ahead (its pieces and
  occasion); a plan is deleted automatically 30 days after its day. Also the trips you save from "Pack for a trip": the destination city, the dates, the
  occasion and the outfits and packing list shown. A trip you don't save is not stored.
- **What you don't want suggested.** The outfit combinations you marked "Not for me", so they
  aren't suggested again.
- **Your voice, only when you tap a mic.** Dictating a city, Today's occasion or a stylist message uses the
  microphone only while you hold that session (tap to start, tap again or pause to stop); the app
  never records or keeps the audio. Your phone's own speech recognizer turns it into text: on an
  iPhone that supports it, entirely on the phone; otherwise Apple's (iPhone) or the phone's speech
  service, usually Google's (Android), may receive the audio to transcribe it, under their own
  privacy terms. Only the resulting words reach the app, which uses a dictated city or occasion
  exactly like a typed city, a tapped occasion or a typed message. A stylist reply you have read
  aloud is spoken by your phone's own voices.
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

Your phone also keeps a copy of your closet, today's outfit suggestions, your saved outfits, your
planned outfits, the packing items you checked off for each trip, the combinations you marked "Not
for me", your last "For you" ideas and cached photos, so the app works offline. A photo waiting to upload is kept in the app's own
folder until it is uploaded. If you turn on the daily reminder, its time stays on your phone and
the phone itself schedules the notification (on a day you planned, it names the planned pieces):
nothing about it reaches a server or a push service.
"Listen" reads the screen's text with your phone's own text-to-speech voices.

## Who processes it

| Processor | What it receives | Why |
|---|---|---|
| Supabase | Everything listed above | Hosting: the database, sign-in, photo storage and the server functions that call the services below |
| Anthropic (Claude) | For each new garment, its prepared photo (cut out and at most 784 pixels) and the clothing type you chose. When the rating service is unavailable, the same anonymous summary that TypeSafe receives. For "For you", only generic descriptions of the suggested pieces, how many of your garments and outfits each one combines with, and the app's language (English or Spanish) to write the lines in, with nothing else about you. For "Should I buy it?", the photo you take or pick (prepared the same way) and your clothing type; neither the app nor its server stores the photo or the answer, and Anthropic handles it under its own retention rules. For "Ask your stylist", your chat messages, the language you use the app in, the closet summary described above and, when useful, today's weather where you are (temperature, condition, season); neither the app nor its server stores them, and Anthropic handles them under its own retention rules. | Recognizing each garment's attributes; a backup outfit rating; the short lines on the "For you" cards; recognizing a piece you're thinking of buying; answering your stylist chat |
| TypeSafe (Jev) | An anonymous summary only: your clothing type, body type, a height range (short, medium or tall), age group and styles; the occasion, the weather and the season; and each piece's category, colors, pattern, formality and fit. Never a photo, an exact measurement, a size, your name or your email. | Rating outfits and ranking suggestions |
| Open-Meteo | Your city's coordinates, or the city's name when there are none; for "Pack for a trip", the destination city's name and the app's language, then that place's coordinates | The day's weather; a trip's daily forecast |
| Apple | Your Sign in with Apple identity, and, when you delete your account, a request to revoke the app's access | Sign-in, and ending that link when you leave |
| Google | Your Sign in with Google identity | Sign-in |
| Brevo | Your email address and the confirmation or reset code | Sending your account's emails |

The AI services receive these requests from the app's server, never directly from your phone, and
the app's server never sends them your photos except for the garment recognition and the "Should I
buy it?" check described above.
When you tap "Search in stores" on a "For you" idea and pick a store (Falabella, Mercado Libre,
Google Shopping or Google, depending on your country), your browser opens that store's search for
generic words such as "camel blazer women"; the store's own privacy policy applies to that search.

## How long it is kept

Your data stays until you delete it or delete your account, except plans, which go 30 days after
their day. You can delete any garment (its photos
are removed too), any logged wear, saved outfit, plan or saved trip at any time, put a piece back into
suggestions from its detail screen, and restore every hidden combination from Profile. The owner keeps a nightly backup of the database
and photos on their own computer, for recovery only, and keeps the 14 most recent ones; data you
delete disappears from the backups after the next 14 nightly backups (about two weeks when they run
every night).

Each processor above applies its own retention rules to what it receives from the app.

## Your choices: export and deletion

- **Export.** Profile → Privacy → "Export my data" gives you a file with your profile, garments
  (with any prices you entered), outfits, wears, planned outfits, saved trips and the combinations you marked "Not for me", plus links to your photos that work
  for 7 days.
- **Delete your account.** Profile → Privacy → "Delete account", confirmed twice, removes your
  photos, revokes Sign in with Apple if you used it, and deletes your account and every row that
  belongs to it. The app then clears its copy of your data on that phone and signs you out.

You can also change or clear any profile field at any time in the Profile tab, and choose not to
give your city or body details at all.

## Changes and contact

If this policy changes, the new version will be posted on this page with a new date. For any
question, or to ask for your data or its deletion, write to [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).
