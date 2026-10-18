# Third-party notices

Wordvault includes the following third-party software, unmodified unless stated, and uses content
and services of the third parties named below.

## Software included in the package

| Component | Version | Licence | Where in the package | Source |
| --- | --- | --- | --- | --- |
| Tesseract.js | 7.0.0 | Apache-2.0 | `vendor/tesseract/tesseract.esm.min.js`, `vendor/tesseract/worker.min.js` (licence: `vendor/tesseract/LICENSE.md`) | https://github.com/naptha/tesseract.js/tree/v7.0.0 |
| tesseract.js-core (LSTM builds) | 7.0.0 | Apache-2.0 | `vendor/tesseract/core/` (licence: `vendor/tesseract/core/LICENSE`) | https://github.com/naptha/tesseract.js-core/tree/v7.0.0 |
| Tesseract trained data (`eng`, `tur`, 4.0.0_best_int) | `@tesseract.js-data/*` 1.0.0 | Apache-2.0 | `vendor/tesseract/lang/` | https://github.com/tesseract-ocr/tessdata_best |
| Readability | 0.6.0 (`@mozilla/readability`) | Apache-2.0 | `vendor/readability/Readability.js` (licence: `vendor/readability/LICENSE.md`); put into a tab only for "Summarise this page" | https://github.com/mozilla/readability/tree/0.6.0 |

Bundled inside the Tesseract.js files, as their own notices say (`vendor/tesseract/*.LICENSE.txt`):
regenerator-runtime (MIT, Facebook, Inc.), buffer (MIT, Feross Aboukhadijeh), ieee754
(BSD-3-Clause, Feross Aboukhadijeh), zlib.js (MIT, imaya).

In the Chrome package only, the three jsDelivr addresses Tesseract.js falls back to when no path is
given are replaced with empty strings (see `vendor/tesseract/README.md`); the Firefox package contains
the files exactly as released.

## Content

- **Wiktionary** (definitions, word types and example sentences shown for saved words): text licensed
  under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/)
  (and the GFDL). The vault links each entry to its Wiktionary page and to the licence.
- **Wikimedia Commons** (pronunciation recordings, where used): each recording is under the free
  licence given on its Commons page; the player links to that page, which names the author and licence.

## Services

Wordvault talks to these services only as described in `PRIVACY.md`: MyMemory (Translated srl), DeepL,
Wiktionary and Wikimedia Commons (Wikimedia Foundation), Google Gemini and Google Drive (Google),
the Claude API (Anthropic), NVIDIA's API catalog, OpenAI-compatible services and Ollama chosen by the
user, Cloudflare Workers and Telegram (feedback), and Buy Me a Coffee (support link).

## Trademarks

All product names, logos and brands are property of their respective owners. They are used only to
name the services Wordvault can work with. Wordvault is an independent project and is not affiliated
with, endorsed by or sponsored by any of them.
