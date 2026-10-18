# addons.mozilla.org: the submission, field by field

Developer Hub → **Submit a New Add-on**. Everything below is entered in English (the default locale);
the Turkish listing is added afterwards (Edit Product Page → switch the locale to Türkçe).

## 1. Distribution

**On this site** (listed on addons.mozilla.org).

## 2. Upload

`web-ext-artifacts/wordvault-1.0.0-firefox.zip`. The validator reports 0 errors and 5 warnings, all
in unmodified vendored files (three `Function` uses in Tesseract.js, two `innerHTML` assignments in
Readability); they are explained in the notes to reviewer.

Compatible applications: **Firefox** (the manifest asks for Firefox 142 or later). Firefox for
Android: leave unticked; it has not been tested there.

## 3. Source code

"Do you need to submit source code?" → **Yes**, upload `web-ext-artifacts/wordvault-1.0.0-source.zip`.
Our own code is not minified, but the build writes the Google client ID into `sync/config.js` and sets
one flag in `shared/i18n.js`; with the source zip and `BUILD.md` a reviewer gets the same package byte
for byte.

## 4. Describe the add-on

| Field | What to enter |
| --- | --- |
| Name | `Wordvault` (from the manifest). If AMO says the name is in use (an unrelated, inactive add-on is called "WordVault"), use `Wordvault: Learn Words While You Browse` |
| Add-on URL | `wordvault` is taken; suggested: `wordvault-learn-words` |
| Summary (at most 250 characters) | The AMO summary in `listing.md` |
| Description | The text in `../description-en.md`, "Detailed description" |
| This add-on is experimental | Leave unticked |
| Requires payment | **Unticked** (the AI providers are the user's own choice; nothing is paid to Wordvault) |
| Categories | **Language Support** (second, optional: Other) |
| Support e-mail | `phoby.dev@gmail.com` |
| Support website | `https://github.com/Phobby/Wordvault/issues` |
| License | **Other** / custom: name `PolyForm Noncommercial License 1.0.0`, text: the contents of `LICENSE` |
| Privacy policy | Tick "This add-on has a privacy policy" and paste the text of `PRIVACY.md` (it is also published at https://phobby.github.io/wordvault-privacy/) |
| Notes to reviewer | The "addons.mozilla.org: notes to reviewer" block in `reviewer-notes.md` |

## 5. After submitting

- Images: Edit Product Page → Images: icon (from the package) and the four screenshots in
  `../screenshots/`. AMO shows them in a 1.6 : 1 frame (1280×800 fits).
- Turkish: Edit Product Page, locale **Türkçe**: name `Wordvault`, the AMO "Özet" from
  `../tr/listing.md`, the description from `../description-tr.md`.
- Homepage (optional): `https://github.com/Phobby/Wordvault`.
- Google Drive: the Firefox redirect address `http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e`
  is already registered with the Google client; it depends only on the add-on ID `wordvault@phobby`.
