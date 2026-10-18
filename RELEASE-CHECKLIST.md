# Release checklist

The steps of a release, in order. Building: `BUILD.md`. Store texts and images: `docs/store/`.

## 1. Placeholders that must be filled in

| Placeholder | Where | What goes there |
| --- | --- | --- |
| ~~`[EFFECTIVE_DATE]`~~ | `PRIVACY.md` | Done: 18 October 2026 (`docs/privacy.html` regenerated) |
| ~~`[CONTACT_EMAIL]`~~ | `PRIVACY.md`, `docs/store/en/listing.md` | Done: phoby.dev@gmail.com |
| ~~`[PRIVACY_POLICY_URL]`~~ | store descriptions, `docs/store/en/listing.md`, the store dashboards, Google's Branding page | Done: https://phobby.github.io/wordvault-privacy/ (`docs/privacy.html` as `index.html` in the public repository Phobby/wordvault-privacy; upload it again after every `npm run privacy`) |
| `[HOMEPAGE_URL]` | `docs/store/en/listing.md` (optional) | A home page, e.g. the repository |
| `YOUR_GOOGLE_CLIENT_ID` | `src/sync/config.js` (stays a placeholder in git); the real ID goes into `oauth.local.json` | The Google OAuth client ID (`SETUP-OAUTH.md`). A local `oauth.local.json` with an ID already exists on the build machine; check it is the production client |
| `<item-id>` (Chrome Item ID) | `SETUP-OAUTH.md`, Google Cloud Console → Client → Authorized redirect URIs | `https://<item-id>.chromiumapp.org/`, known only after the first upload to the Chrome Web Store |

## 2. Before building

- [ ] The placeholders above are filled in (except the Item ID, which comes in step 4).
- [ ] `src/config.js`: `SUPPORT_URL` and `FEEDBACK_ENDPOINT` are the real addresses (not `YOUR_…`, not `http:`).
- [ ] The feedback receiver (`feedback-worker/`) is deployed and answers at `FEEDBACK_ENDPOINT`.
- [ ] The version in `package.json`, `manifest.chrome.json` and `manifest.firefox.json` is the same and
      higher than the published one (`build.js` refuses a mismatch).
- [ ] `PRIVACY.md` says "version x and later" for this version if what leaves the browser changed.
- [ ] `docs/privacy.html` is published at https://phobby.github.io/wordvault-privacy/ (same content) and opens without signing in.
- [ ] Everything is committed (the source zip is made from `HEAD`).

## 3. Build and check

- [ ] `npm test`: all pass.
- [ ] `npm run i18n:check`: 0 errors, 0 warnings.
- [ ] `npm run lint`: 0 errors (the warnings are only in `vendor/tesseract` and `vendor/readability`; they are
      explained in `docs/store/en/reviewer-notes.md`).
- [ ] `npm run package`: no warnings about placeholders or uncommitted changes.
- [ ] Load `wordvault-<version>-chrome.zip` (unzipped) in a clean Chrome profile and
      `wordvault-<version>-firefox.zip` in a clean Firefox profile (`about:debugging`), and go through the
      test steps in `docs/store/en/reviewer-notes.md`.
- [ ] The Chrome zip's `manifest.json` has no `key`; neither zip has `oauth.local.json`, tests or hidden files.

## 4. Chrome Web Store

- [ ] Developer account; contact e-mail verified.
- [ ] Upload `wordvault-<version>-chrome.zip`.
- [ ] Store listing: `docs/store/en/listing.md` (and Turkish: `docs/store/tr/listing.md`); category
      Education; images: `docs/store/visual-assets.md` (four screenshots, small promotional tile, optionally the marquee tile).
- [ ] Privacy practices: single purpose, permission reasons (`docs/store/en/permissions.md`), remote code
      "No", data types and certifications (`docs/store/en/privacy-practices.md`), privacy policy URL.
- [ ] Test instructions: `docs/store/en/reviewer-notes.md`.
- [ ] Note the **Item ID**, add `https://<item-id>.chromiumapp.org/` to the Google client's redirect URIs
      (`SETUP-OAUTH.md`, section 2), then test Google Drive sync with the store copy once it is live.
- [ ] Submit.

## 5. addons.mozilla.org

- [ ] Check that the name "Wordvault" is free on AMO.
- [ ] Upload `wordvault-<version>-firefox.zip` (listed on AMO).
- [ ] Source code: answer "yes" and upload `wordvault-<version>-source.zip` (the build changes two files;
      `BUILD.md`).
- [ ] Notes to reviewer: `docs/store/en/reviewer-notes.md`.
- [ ] Listing: summary and description from `docs/store/en/listing.md` (Turkish locale: `docs/store/tr/listing.md`);
      category Language Support; screenshots; privacy policy (paste the text or the URL); support e-mail.
- [ ] Licence: PolyForm Noncommercial 1.0.0 (`LICENSE`); in the form choose a custom licence and paste
      its URL or text.
- [ ] Submit.

## 6. Google Drive

- [ ] Google Auth Platform → Branding complete (name, logo, support e-mail, home page, privacy policy URL).
- [ ] Publishing status **In production** (while in Testing only listed test users can connect).
- [ ] Redirect URIs: the Chrome store ID's address and Firefox's `127.0.0.1/mozoauth2/…` address.

## 7. After publishing

- [ ] Install from each store into a clean profile: translate, save, quiz, scan, feedback, Google Drive sync.
- [ ] Tag the release in git (`v<version>`) and keep the four files from `web-ext-artifacts/`.
