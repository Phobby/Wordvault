# Images for the store listings

What each store asks for, and what is ready. Requirements as published by the Chrome Web Store
("Supplying images") and the Firefox Extension Workshop ("Create an appealing listing").

| File | Size | Chrome Web Store | AMO | Shows | State |
| --- | --- | --- | --- | --- | --- |
| `../../src/icons/icon-128.png` | 128×128 | Store icon (required; taken from the package too) | Icon (from the package) | The extension's icon | Ready. Chrome recommends 96×96 artwork with 16 px transparent padding; this icon fills the square (low risk, see below) |
| `screenshots/1-translation.png` | 1280×800 | Screenshot (1 to 5, 1280×800 or 640×400) | Screenshot (1280×800 recommended) | The translation bubble of a double-clicked word | Ready |
| `screenshots/2-vault.png` | 1280×800 | Screenshot | Screenshot | The vault window | Ready |
| `screenshots/3-quiz.png` | 1280×800 | Screenshot | Screenshot | The quiz card on a page | Ready |
| `screenshots/4-settings.png` | 1280×800 | Screenshot | Screenshot | The settings page | Ready |
| `promo-440x280.png` | 440×280 | Small promotional tile (required) | Not used | Icon, name, "Learn words while you browse." and a translation card | Ready (legible at half size) |
| `marquee-1400x560.png` | 1400×560 | Marquee promotional tile (optional, used only if the item is featured) | Not used | Icon, name, tagline, three places it works, a translation card and a quiz card | Ready |

## Localized screenshot for the Spanish listing

`store-assets/chrome/localized-es/1-translation-es.png` (1280×800): the same page, layout and English
interface as `screenshots/1-translation.png`; only the translation is English → Spanish (MyMemory's
real answer: "serendipia", with its alternatives). Upload it under Store listing → Español → Screenshots;
the default (English) listing keeps `screenshots/1-translation.png` (English → Turkish).

Optional, not made: a fifth screenshot of an AI feature (for example the "Summarise this page" card).
It would need a real provider's answer on screen; nothing in the image may suggest that the AI
features work without the user's own provider.

## How the screenshots were made

With the built 1.0.0 extension loaded in Chromium through Playwright (Linux), on a made-up article page
served locally, with thirteen sample words in the vault; the translation is MyMemory's real answer. The
vault window cannot be opened from the toolbar in that setup, so it was captured at its own size
(380×580) and placed over the page screenshot. Remade on 2026-10-18 for 1.0.0: the earlier set showed
the vault window and the settings page before they were redesigned. Make them again whenever the
bubble, the toolbar window, the quiz card or the settings page change visibly. They show the English
interface; Turkish screenshots are optional (both stores can show the same images for every listing
language).

## How the promotional tiles were made

From an HTML page rendered by Chromium at their exact size (Noto Sans, the colours of the icon, the
icon itself). The cards in them are drawn for the tile, after the real translation bubble and quiz
card, and show real words and translations.

## Rules both stores apply

- No misleading content: the images show the extension as it is in this version.
- Chrome: full-bleed, square corners, no padding, PNG or JPEG; the promotional tile should not be
  mostly text and should work when shrunk to half its size.
- AMO: PNG or JPEG; screenshots are shown in a 1.6 : 1 frame (1280×800 fits it exactly).

## The icon

`tools/make-icons.js` draws every size from one design. If Chrome's review asks for the 96 + 16 px
layout, change the 128 px drawing there (`npm run icons`) and rebuild; `tests/store.test.js` checks
that the store icon is 128×128.
