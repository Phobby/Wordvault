# Building Wordvault

How the store packages are made from the source, and how to check that a package matches it. This file
is also in the source zip given to addons.mozilla.org's reviewers.

## Requirements

- Node.js 22.2 or later (tested with 22.22.1). No npm packages are installed: there are no
  dependencies, no bundler, no transpiler and no minifier.
- For `npm run package` only: `zip` and `git` (macOS, Linux).
- Any operating system Node runs on can run `node build.js` itself.

## What the build does

`node build.js --release` (`build.js`) produces `dist/firefox/` and `dist/chrome/`:

1. Checks the two manifests (same version as `package.json`, every file they name exists, the shared
   keys are the same in both) and the interface translations (`tools/i18n/check.js`).
2. Copies `src/` as it is (hidden files left out) and writes `manifest.<target>.json` next to it as
   `manifest.json`.
3. Release only: in `shared/i18n.js`, `const DEV = true;` becomes `const DEV = false;` (missing interface
   strings are not reported on the console).
4. If `oauth.local.json` exists: the Google Drive client ID in it replaces the placeholder in the built
   `sync/config.js` (`SETUP-OAUTH.md`). The ID is public; there is no client secret.
5. Chrome only: the three jsDelivr fallback addresses in the Tesseract.js files are blanked to `""`
   (`TESSERACT_CDN` in `build.js`; why: `src/vendor/tesseract/README.md`). The Firefox copy keeps the
   official files byte for byte.

Nothing else changes: every other file in a package is the file in `src/`.

## Making the store packages

```sh
npm test                 # unit tests
npm run i18n:check       # interface translations
npm run lint             # web-ext lint of dist/firefox (0 errors; warnings only in vendor files)
npm run package          # release build + zips
```

`npm run package` (`tools/package.js`) writes to `web-ext-artifacts/`:

| File | For |
| --- | --- |
| `wordvault-<version>-chrome.zip` | Chrome Web Store. `dist/chrome` without the manifest's `key` field (the store assigns its own ID); built from `dist/chrome-store/` |
| `wordvault-<version>-firefox.zip` | addons.mozilla.org. `dist/firefox` as it is |
| `wordvault-<version>-source.zip` | AMO's "source code" upload: the committed files (`git archive HEAD`) without the store images and the `SPEC*.md` notes, plus `oauth.local.json` |
| `wordvault-<version>-SHA256SUMS.txt` | The SHA-256 of every file in the two packages |

`manifest.json` is at the root of each zip. The source zip holds only what is committed: commit first
(the script warns about uncommitted changes).

## Checking that a package matches the source

From the source zip, in an empty folder:

```sh
unzip wordvault-<version>-source.zip -d wordvault-src
cd wordvault-src
node build.js --release firefox
cd dist/firefox && find . -type f | LC_ALL=C sort | xargs sha256sum
```

The output is the `# wordvault-<version>-firefox.zip` section of `wordvault-<version>-SHA256SUMS.txt`,
line for line. For Chrome, build `chrome` instead and leave out `manifest.json`, which in the store
package has no `key` field.

## Third-party code

Vendored, unmodified, with versions, sources and checksums: `src/vendor/tesseract/README.md`,
`src/vendor/readability/README.md`; licences and notices: `src/THIRD-PARTY-NOTICES.md` (also in the
packages).
