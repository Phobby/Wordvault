# Store preparation

Ready texts and images for submitting to the Chrome Web Store (and addons.mozilla.org).

| File | What is in it |
| --- | --- |
| `listing.md` | Name, short description (≤ 132 characters), long description (en, tr), category, list of images |
| `permissions.md` | The reason to paste into the dashboard for every permission |
| `privacy-practices.md` | Single purpose, remote code declaration, data use declaration, AMO declaration |
| `test-instructions.md` | Test steps for reviewers |
| `screenshots/` | 1280×800 screenshots |
| `promo-440x280.png` | Small promotional image (draft) |

Privacy policy: `PRIVACY.md` (tr) and `docs/privacy.html` (en + tr, web version).

The texts in this folder are store-facing content in the languages the stores show, not developer
documentation; they are kept as they are. The extension's name, short description and shortcut
descriptions shown by the browsers come from `src/_locales` (see "Interface language" in the README).

## Packaging

```sh
npm run package
```

Builds the `dist/` folders as a release build (`node build.js --release`) and writes two zips under
`web-ext-artifacts/` (not committed): `wordvault-<version>-chrome.zip` and
`wordvault-<version>-firefox.zip`. `manifest.json` is at the root of each zip.

## Checklist before submitting

- [ ] `src/config.js`: `SUPPORT_URL` and `FEEDBACK_ENDPOINT` are real addresses (not placeholders, not `localhost`).
- [ ] `npm test`, `npm run i18n:check` and `npm run lint` are clean (lint: 0 errors; the warnings come from the unchanged Tesseract files).
- [ ] The version in `manifest.*.json` and `package.json` is the same and higher than the previous one.
- [ ] `npm run package`, load the zip in a clean browser profile and go through the steps in `test-instructions.md`.
- [ ] The privacy policy's address is public and opens.
- [ ] In the dashboard: descriptions, images, single purpose, permission reasons, data declaration, test instructions.

## Still open (for the developer to do)

- **The privacy policy's address.** `docs/privacy.html` is ready for GitHub Pages, but the repository is
  private; with a free GitHub account Pages works only for public repositories. Options: make the
  repository public, open a separate public repository holding only this file, or publish the file
  elsewhere.
- **The developer contact e-mail.** A Chrome Web Store account asks for a contact address and shows it on
  the store page. The privacy policy refers to that address for deletion requests too. There is no
  e-mail address in the repository.
- **The `key` field in Chrome.** The manifest's `key` fixes the ID in developer mode. It may stay in the
  package uploaded to the store (the store uses its own key and ignores this field, or asks you to remove
  it); if the ID the store gives is different, the redirect address in the Google OAuth client has to be
  updated accordingly (`SETUP-OAUTH.md`).
- **Google Drive.** While Google Drive's OAuth consent screen is in "testing" mode, only the added test
  users can connect; it has to be published ("In production") before the release (`SETUP-OAUTH.md`).
- **The promotional image** is a draft.
