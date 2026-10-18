# Notes for reviewers

Two texts: the Chrome Web Store's "Test instructions" field, and the "Notes to Reviewer" field of
addons.mozilla.org (AMO). Both stores are reviewed in English. Permission reasons: `permissions.md`;
data declarations: `privacy-practices.md`.

## Chrome Web Store: test instructions

```
No account or login is needed. All core features work right after installation.

1. TRANSLATE: Open any English article (for example https://en.wikipedia.org/wiki/Language). Double-click a word. A bubble with the translation opens next to it. The first time, pick the language to translate into.

2. SAVE: In the bubble press "Add to vault". Click the Wordvault toolbar button: the word is in the list. Click it to see its dictionary entry.

3. QUIZ: Save at least 4 words with different meanings. Open the extension's settings (toolbar popup → "Settings", or the extension's "Options"). On the "Quiz" tab, open "Why is there no quiz?" and press "Test now": a four-choice question appears.

4. YOUTUBE CAPTIONS: Open a YouTube video that has captions, turn captions on, pause, and hold the pointer over a word in the caption. The translation bubble opens.

5. SCAN TEXT ON SCREEN: On any page press Alt+Shift+S (macOS: Command+Shift+E), or right-click → "Scan text on screen". Drag a rectangle over some text (also inside an image or a paused video). After a few seconds the recognised words can be clicked for a translation. Recognition runs locally (bundled WebAssembly); nothing is uploaded.

6. FEEDBACK: Settings → "Contact and feedback". Write at least 10 characters and press "Show the data to be sent". The exact JSON is shown. Nothing is sent unless "Send" is pressed; the browser then asks for permission for wordvault-feedback.phoby.workers.dev only.

7. SYNCHRONISATION (optional, off by default): Settings → "Synchronisation and backup". "Browser sync" needs no setup. Google Drive opens Google's own sign-in window; the extension only gets access to its own hidden app folder.

8. AI FEATURES (optional, off by default): they need an AI provider of the user's own (an API key for Google Gemini, Claude, NVIDIA or an OpenAI-compatible service, or Ollama running locally). Until one is connected, "Summarise this page" and "Translate this page with AI" do not appear in the menus. With a provider connected: right-click on an article → "Summarise this page"; a card shows how much text would be sent and to which provider, and nothing is sent until "Summarise" is pressed.

Permissions are explained one by one in the "Privacy practices" tab. Optional host permissions are requested only for one specific origin at the moment the user connects a sync target or an AI provider, tests a DeepL key, or sends feedback.
```

## addons.mozilla.org: notes to reviewer

```
No account is needed; the test steps are the same as for Chrome (see below).

SOURCE CODE
The package is not minified, transpiled or bundled: build.js copies src/ as it is and writes the Firefox manifest next to it. The source zip (wordvault-<version>-source.zip) contains BUILD.md with the exact steps (Node.js 22, no npm dependencies, "node build.js --release firefox"). The two changes the build makes: shared/i18n.js gets DEV = false, and sync/config.js gets the Google OAuth client ID from oauth.local.json (included in the source zip; the ID is public, there is no client secret).

THIRD-PARTY LIBRARIES (all unmodified, official releases)
- Tesseract.js 7.0.0: vendor/tesseract/tesseract.esm.min.js and vendor/tesseract/worker.min.js
  https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz (files under dist/)
- tesseract.js-core 7.0.0: vendor/tesseract/core/tesseract-core-{lstm,simd-lstm,relaxedsimd-lstm}.wasm.js
  https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz
- Language data: vendor/tesseract/lang/{eng,tur}.traineddata.gz from @tesseract.js-data/eng 1.0.0 and @tesseract.js-data/tur 1.0.0 (4.0.0_best_int/)
- Readability 0.6.0: vendor/readability/Readability.js
  https://registry.npmjs.org/@mozilla/readability/-/readability-0.6.0.tgz
SHA-256 checksums of every vendored file: vendor/tesseract/README.md and vendor/readability/README.md.

LINTER WARNINGS
The three DANGEROUS_EVAL warnings are in the unmodified Tesseract.js files: webpack's globalThis fallback, new Function("return this")(), and regenerator-runtime's fallback, Function("r", "regeneratorRuntime = r"), both reached only where globalThis is missing, which never happens in Firefox 142+. The extension's own code has no eval, new Function or remote code. Readability uses innerHTML on its own detached copy of the page (it is injected only when the user asks for a summary of that tab).

DATA COLLECTION
data_collection_permissions: websiteContent is required (the text the user asks to have translated goes to the translation service). The optional categories are used only by the feedback form, which shows the exact data before sending.

TEST STEPS
1. Double-click a word on an English article: a translation bubble opens. "Add to vault" saves it.
2. Toolbar button: the vault. Settings → "Quiz" tab → "Why is there no quiz?" → "Test now" (needs 4 saved words).
3. YouTube with captions: hold the pointer over a caption word.
4. Alt+Shift+S (macOS: Command+Shift+E) or right-click → "Scan text on screen": drag over text; recognition is local.
5. Settings → "Contact and feedback" → "Show the data to be sent": nothing is sent before "Send".
AI features are off by default and need the user's own provider (an API key, or Ollama on the same computer).
```
