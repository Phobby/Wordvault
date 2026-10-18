# Store listing (English)

What goes into the listing forms of the Chrome Web Store and addons.mozilla.org (AMO). It has to stay
true to the extension and to `PRIVACY.md`; `tests/store.test.js` checks the short description.

## Name

Wordvault

## Short description

The Chrome Web Store takes it from the manifest (`src/_locales/en/messages.json`, `extDescription`,
at most 132 characters); it is repeated here so that the listing and the package say the same thing.

- **en:** Translate words on web pages and in video subtitles, save them to your vault and review them with quick quizzes.

AMO "Summary" (at most 250 characters):

```
Translate words on web pages, in YouTube captions and in text on screen, save them to your vault and review them with short quizzes. No account, no tracking; optional AI features with your own provider.
```

## Category and languages

- Chrome Web Store: **Education**.
- AMO: **Language Support** (one category is enough; a second is optional).
- Listing languages: English (default), Turkish (`../tr/listing.md`), Spanish (`../description-es.md`). The extension's interface is in English
  and Turkish.

## Long description

`../description-en.md` (Chrome Web Store and AMO).

## Images

See `../visual-assets.md`.

## Links for the listing forms

- Privacy policy: the public address of `docs/privacy.html` → `[PRIVACY_POLICY_URL]`
- Support / contact e-mail: `phoby.dev@gmail.com`
- Homepage (optional): `[HOMEPAGE_URL]`
