# Store preparation

The texts and images for submitting Wordvault to the Chrome Web Store and addons.mozilla.org (AMO).
How to build the packages: `BUILD.md`. The steps of a release, in order: `RELEASE-CHECKLIST.md`.

| File | What is in it | Language |
| --- | --- | --- |
| `en/listing.md` | Name, short description, AMO summary, category, long description, listing links | English |
| `tr/listing.md` | The same for the Turkish listing | Turkish |
| `en/permissions.md` | The reason to paste into the dashboard for every permission | English |
| `tr/permissions.md` | The same reasons in Turkish, for reading (the dashboard is filled in English) | Turkish |
| `en/privacy-practices.md` | Single purpose, remote code declaration, data use declaration, AMO data collection | English |
| `en/reviewer-notes.md` | Chrome's test instructions and AMO's notes to reviewer (source code, third-party libraries, linter warnings) | English |
| `visual-assets.md` | Every image the stores ask for, its size and state | English |
| `screenshots/` | 1280×800 screenshots | |
| `promo-440x280.png`, `marquee-1400x560.png` | Chrome's small (required) and marquee (optional) promotional tiles | |

Privacy policy: `PRIVACY.md` (English) and `docs/privacy.html`, generated from it with `npm run privacy`
(`tests/privacy-page.test.js` fails while the page is out of date).

The extension's name, short description and shortcut descriptions shown by the browsers come from
`src/_locales`; `tests/store.test.js` checks that both listings quote the manifest's short description,
that every permission of both manifests has a reason in `en/permissions.md`, and that the remote code
declaration is there.

When a feature, a permission or what leaves the browser changes, these files change with it, together
with `PRIVACY.md`: the listing, the permission reasons, the data declaration and the reviewer notes
have to say the same thing as the code.
