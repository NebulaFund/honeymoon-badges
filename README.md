# Honeymoon Badges

A view-only badge catalog for May, built as a web app that installs to the iPhone home screen.
No App Store, no Xcode, no Apple Developer account.

**Live:** https://nebulafund.github.io/honeymoon-badges/

## What she can do

- **Browse the case.** Earned badges first, locked slots after.
- **Filter by tier.** Tap one of the four counters under the title (bronze, silver, gold,
  platinum) to see only that tier. Tap it again, or "Show all", to go back.
- **See a badge up close.** Tap any badge to open it full screen, then swipe left and right to
  move through the others. Swiping follows whatever the case is showing, so inside a tier
  filter it stays within that tier. A locked slot opens on its own.

## Adding or unlocking a badge

Everything lives in `badges.json`. One entry per badge:

```json
{
  "id": "hooker-valley-trek",
  "name": "Hooker Valley Trek",
  "tier": "platinum",            // bronze | silver | gold | platinum
  "earned": true,                // false = shows as an empty locked socket
  "earnedDate": "2026-08-14",    // optional; the detail view hides the row without it
  "image": "assets/badges/hooker-valley-trek.jpg",
  "description": "Shown on the detail screen once she's earned it.",
  "hint": "Shown instead, while it's still locked."
}
```

To unlock one: flip `earned` to `true`. To lock one back: flip it to `false`.

Keep `tier` matched to the rim metal in the artwork — bronze rim → `"bronze"`, gold → `"gold"`,
silver → `"silver"`, silver-with-diamonds → `"platinum"`. The tier drives the glow around the
badge, the coloured ribbon on the detail screen, and the four counters in the header.

Earned badges sort to the front, newest `earnedDate` first; badges with no date hold their
order from this file. Locked ones fall to the back in tier order.

## Badge artwork

**Drop the generated images in as-is.** No cropping, no background removal, no resizing.

The app preps each badge as it loads, in two steps:

1. **Remove the page.** Flood-filled inward from the edges, so white *inside* the art — the
   helicopter, the snow, the diamonds — survives. The page colour is measured from the border
   rather than assumed to be white, because some of the art sits on a light grey that drifts
   across the image.
2. **Crop to the rim.** The medallion is a true circle, so the app finds it and crops to it
   exactly. It locates the rim by detail rather than by colour: the badge is full of edges
   while the page and any drop shadow are smooth ramps, so the outermost edge pixel along each
   angle is the rim. A circle is fitted through those points and everything outside is dropped.

That second step is what removes a drop shadow. Colour alone cannot: a contact shadow reaches
the same darkness as the badge's own outline, and a silver rim is brighter than the grey page
it sits on.

- Any size, any aspect ratio, medallion anywhere on the page. PNG or JPEG.
- Art that already has a transparent background passes through untouched.
- Do shrink big files before committing them. The originals here were 2816×1536 at ~1.7MB
  each; `sips -Z 1400 in.jpeg --out out.jpg` brought all five from 8.5MB down to 522KB
  with no visible loss at phone size.

Full-resolution originals are kept in `source-art/`, outside what gets served.

## Hosting it

Already live on GitHub Pages, served from `main` at the repo root.

**To add or change a badge:** edit `badges.json` on github.com, commit, and Pages rebuilds
within a minute. Her home screen app picks it up the next time she opens it — no reinstall.
New artwork goes in `assets/badges/` the same way (Add file → Upload files).

If you ever want the badge list to live somewhere separate from the app, set `REMOTE_URL` at
the top of `app.js` to a hosted `badges.json`. The app checks it on every open and falls back
to its cached copy offline.

## Installing on her iPhone

1. Open the URL in **Safari** — it must be Safari; Chrome on iOS can't install to the home screen.
2. Share button → **Add to Home Screen**.
3. Real icon, fullscreen, no browser chrome, works offline.

## Local preview

```
python3 -m http.server 4321
```
