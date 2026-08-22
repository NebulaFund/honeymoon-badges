# Honeymoon Badges

A view-only badge catalog for May, built as a web app that installs to the iPhone home screen.
No App Store, no Xcode, no Apple Developer account.

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

The app preps each badge as it loads: it flood-fills the white page inward from the edges,
keys it to transparent, then crops square to the medallion. White *inside* the art — the
helicopter, the snow, the diamonds — is untouched, because the fill only reaches what
connects to the border.

- Any size, any aspect ratio, medallion anywhere on the page. PNG or JPEG.
- Art that already has a transparent background passes through untouched.
- Do shrink big files before committing them. The originals here were 2816×1536 at ~1.7MB
  each; `sips -Z 1400 in.jpeg --out out.jpg` brought all five from 8.5MB down to 522KB
  with no visible loss at phone size.

Full-resolution originals are kept in `source-art/`, outside what gets served.

## Hosting it

The repo here is already committed and ready to push. `gh` is installed; the only step that
needs your credentials is the login:

```
gh auth login
```

After that, one command publishes it:

```
gh repo create honeymoon-badges --public --source=. --push \
  && gh api -X POST repos/:owner/honeymoon-badges/pages \
       -f "source[branch]=main" -f "source[path]=/"
```

GitHub Pages on a free account requires the repo to be **public** — the URL is obscure but not
secret. If you'd rather it not be, Cloudflare Pages takes a direct folder upload with no repo
at all; the trade is that adding a badge then means re-uploading rather than editing one file.

Once it's live, adding a badge is: edit `badges.json` on github.com, commit, done — the site
redeploys itself and her home screen app picks it up next time she opens it.

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
