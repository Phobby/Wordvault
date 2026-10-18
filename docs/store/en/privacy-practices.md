# Chrome Web Store: the "Privacy practices" tab

The texts to paste into the dashboard and the boxes to tick. They have to agree with `PRIVACY.md`,
`docs/privacy.html` and `permissions.md` (`tests/store.test.js` checks the remote code declaration).

## Single purpose

> Wordvault helps the user learn vocabulary in a foreign language while browsing: it translates a word the user picks on a web page, in video captions or in text scanned from the screen, saves it to a personal word list ("vault") and reviews saved words with short quizzes.

Every feature serves this purpose: synchronisation carries the vault, the optional AI features
explain, summarise or translate what the user is reading or make practice tests from the vault, and
the feedback form and support link are about the extension itself.

## Permission justifications

`permissions.md`, one field per permission.

## Remote code

Tick **"No, I am not using remote code"**.

> All JavaScript and WebAssembly the extension runs is in the package. Nothing is loaded from the network and executed: no remote scripts, no eval of fetched text, no remotely hosted modules. The text recognition engine (Tesseract.js 7.0.0, its WebAssembly core and the English and Turkish language data) is bundled unmodified under vendor/tesseract, except that three unused jsDelivr fallback addresses are blanked in the Chrome package; Mozilla's Readability 0.6.0 is bundled unmodified under vendor/readability. The extension's content security policy is script-src 'self' 'wasm-unsafe-eval'; 'wasm-unsafe-eval' only permits compiling the bundled WebAssembly module. Network requests fetch data only (translations, dictionary entries, audio recordings, the user's own synchronised vault file, and the replies of the AI provider the user connected, which are shown as text).

## Data usage

The data types to tick:

| Type | Tick | Why |
| --- | --- | --- |
| Personally identifiable information | **Yes** | Only the e-mail address the user **may** type into the feedback form. |
| Health information | No | |
| Financial and payment information | No | The support link opens another site; the extension sees no payment details. |
| Authentication information | No | The cloud account's access tokens stay in the browser and never reach the developer. AI and DeepL API keys go only to the provider they belong to. |
| Personal communications | **Yes** | Only the message the user writes into the feedback form and sends. |
| Location | No | No IP address is collected; the hosting provider sees it, the receiver does not store it. |
| Web history | No | |
| User activity | No | No clicks, scrolling or keystrokes are recorded; there are no analytics. |
| Website content | **Yes** | See below. |

What "Website content" covers, all of it only on the user's request:

- the text the user asks to have translated (a double-clicked word, or a sentence or paragraph
  translated from the context menu, the "Translate" button or the shortcut) goes to the selected
  translation service (MyMemory, or DeepL with the user's own key), nowhere else;
- with an AI provider the user connected themselves (off by default, every request started by hand):
  - "Explain with AI": the word, its sentence and the page title, or the selected text; in a screen
    scan, the text read from the scanned area (never the screenshot);
  - "Ask about the image": after a separate consent for images and pressing "Ask", the picture of
    the area the user selected, their question and the page title;
  - "Summarise this page": after the card has shown how much text it is and the user pressed
    "Summarise", the page's main text and title (form fields, hidden parts and what the user typed
    are left out; at most 120,000 characters);
  - "Translate this page with AI": after the same kind of confirmation, the page's visible text and
    title (the same parts left out; at most 100,000 characters);
  - "Create a test with AI": up to 20 words from the vault with the user's saved translations, the
    language and the level (no sentences, notes or page addresses);
- the words the user saved go to the account or server the user chose, if they turn on
  synchronisation.

> ASSUMPTION: the feedback message is counted as "Personal communications" and the optional e-mail
> address as "Personally identifiable information". Both apply only when the user sends the form;
> ticking them is the safer side.

The three certifications are true and are ticked:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

The public address of `docs/privacy.html` (`[PRIVACY_POLICY_URL]`; see `RELEASE-CHECKLIST.md`).

## Google user data (Drive)

Synchronisation uses only Google Drive's hidden, app-specific folder (`drive.appdata`). The "Limited
Use" statement is in `PRIVACY.md` and `docs/privacy.html`.

## addons.mozilla.org

The `data_collection_permissions` declaration in `manifest.firefox.json` is shown on the listing by
itself:

| Category | Kind | Why |
| --- | --- | --- |
| `websiteContent` | required | The text the user asks to have translated goes to the translation service; with an AI provider the user connected, the texts and images listed above go to that provider. |
| `personalCommunications` | optional | The feedback message, asked for only when the user sends feedback. |
| `technicalAndInteraction` | optional | Only if the user leaves "Include technical information" ticked in the feedback form: browser and version, operating system name, extension version, interface language, which features are on (yes/no) and the kind of sync; with "Include recent error records" (off by default) also the local error log. Shown before sending. |
| `personallyIdentifyingInfo` | optional | The e-mail address the user may type into the feedback form. |

`authenticationInfo` is not declared: the Google Drive tokens go only to Google and the API keys
only to the provider they belong to; nothing reaches the developer.

Source code: see `reviewer-notes.md` and `BUILD.md`.
