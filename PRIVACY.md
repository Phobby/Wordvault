# Wordvault Privacy Policy

**Effective date:** 18 October 2026 · **Applies to:** Wordvault browser extension, version 1.0.0 and later
**Contact:** phoby.dev@gmail.com

Wordvault is a browser extension for learning vocabulary while you browse. It has **no server of its
own** for your vocabulary or settings: the developer does not collect, see or store your words, the
pages you visit or your settings. There is no analytics, no tracking, no advertising and no usage
measurement.

The **only** case in which data reaches the developer is when you fill in the "Contact and feedback"
form in the settings, look at exactly what will be sent and press **Send** (see "Feedback" below).

This policy lists every case in which data leaves your browser: what, when, why and where to.

## 1. What stays in your browser

The following is stored only in the browser you use (`storage.local`), and is removed by the browser
when you uninstall the extension:

- **Your vault:** saved words and phrases, their translations and language pairs, the sentence a word
  was found in, the address and title of the page it was saved from, dictionary data, your notes and
  your review progress (including which words are learned), and the days you did a quiz (your streak).
- **Settings:** target and interface language, quiz and voice settings, per-site source languages, the
  translation service and AI provider you chose, and your site lists.
- **Credentials you enter:** API keys (DeepL, AI providers), sign-in tokens of a sync account, the
  address, user name and password of your own sync server, and — only if you ask for it to be
  remembered — the key derived from your sync encryption password.
- **Past practice tests** ("Create a test with AI"): the last 10.
- **Caches:** translations you looked up (kept for 7 days without use), AI answers (in memory only,
  until the browser closes; can be switched off). The text of a page you summarise is held in memory only while the summary card is open.
- **A local error log:** the last 20 errors of the extension itself (message, which part, time). It
  holds no page address or content and goes nowhere unless you add it to feedback.
- **A feedback draft:** what you typed in the form but did not send (removed when sent).

## 2. What leaves your browser, and when

Nothing below happens by itself: each item is started by something you do. All requests use HTTPS
(except to a server on your own computer, `localhost`), and go straight from your browser to the
service named; there is no Wordvault server in between.

### 2.1 Translation (when you ask for a translation)

When you double-click a word, select text and use "Translate with Wordvault" (right-click menu,
the "Translate" button next to a selection, or the keyboard shortcut), hover a word in the
captions of a video on YouTube or in a Video.js player (such as Brightcove's), or click a word read by a screen scan: **only that word or selected text** and the language
pair go to the translation service you chose. Not the rest of the page, not its address, not your
identity.

- **MyMemory** (default; `api.mymemory.translated.net`, by Translated srl). Its terms say that it
  collects the text segments submitted to it and stores them long-term, and uses them to create
  statistics and improve its services. Do not translate text you would not share with it.
- **DeepL** (only if you choose it and enter your own API key; `api-free.deepl.com` or
  `api.deepl.com`). Your key is sent to DeepL in the request header and nowhere else.

The language of the text is detected inside your browser. A translation is saved only if you add it
to your vault.

### 2.2 Dictionary data and pronunciation

- When you **add a word to your vault**, the word is looked up on **Wiktionary** (`en.wiktionary.org`)
  for its word types, definitions and example sentences. Wiktionary content is licensed under
  CC BY-SA 4.0; Wordvault links to the source.
- **Pronunciation** normally uses the voices of your own device; nothing is sent. Exceptions, each
  only when you press a pronunciation button:
  - In Firefox-based browsers on macOS, and anywhere if you switch on **"Use a human recording where
    there is one"**: the word is looked up on Wiktionary and its recording is downloaded from
    **Wikimedia Commons** (`upload.wikimedia.org`).
  - If you switch on **"Allow online voices"** (off by default): the browser's online voices (for
    example Chrome's Google voices, Edge's natural voices) are used, which send the word to that
    browser vendor's speech service.

### 2.3 AI features (off by default; only with an AI provider you connect yourself)

If you connect your own AI provider in the settings — Google Gemini
(`generativelanguage.googleapis.com`), the Claude API (`api.anthropic.com`), NVIDIA
(`integrate.api.nvidia.com`), an OpenAI-compatible service at an address you enter, or Ollama on your
own computer — the following is sent **only to that provider**, **only when you press the button**:

| Feature | What is sent |
| --- | --- |
| "Explain with AI" | The word, the sentence it is in, and the page's title; or the text you selected and the page's title. For a screen scan: the text read from the area (or the part you selected), never the screenshot. |
| "Ask about the image" | The area of the screen you selected (as an image, at most 1536 px on its longest side), your question and the page's title, after a preview and after you press "Ask". Asked for separately from text. A one-time 64×64 plain red test image is sent to check whether the model reads images. |
| "Summarise this page" | The main text of the page and its title (menus, adverts and side content are left out), in one request or, for a long page, in several, after the card has shown you how much text it is, in how many parts and to which provider (at most 120,000 characters; you are told if the page is longer), and you press "Summarise". |
| "Translate this page with AI" | The visible text of the page and its title, in several requests, after the card has shown you how much text it is (at most 100,000 characters) and you press "Translate". Text that appears later is sent only if you ask. |
| "Create a test with AI" | Up to 20 words from your vault, your saved translations of them, the language and the level. Not the sentences, notes or page addresses of those words, and nothing else of your vault. |

**Never sent to an AI provider:** the page's address, password fields, form fields, hidden parts of
the page, text in boxes you type in, and your vault (except the words a test is made of). On sites
that look like banking, e-mail or health sites the AI features are off; you manage the lists.

Before the first request to a provider, a notice tells you what will be sent and asks for your
consent; it is asked again for another provider, and separately for images and for tests. Your API
key is stored in this browser and is sent only to that provider, in the request header. What the
provider does with what it receives is governed by its own terms (for example, Google says that
content sent to Gemini's free tier may be used to improve its products).

Without a provider, "Copy the prompt and open" copies a ready prompt to your clipboard and opens the
chat site you chose in a new tab; the extension sends nothing — you paste it yourself.

### 2.4 Screen text scanning (when you start it)

A screenshot of the current tab is taken and the area you choose is read **inside your browser**
(Tesseract.js, packaged with the extension; nothing is downloaded). The screenshot and the text read
from it do not leave your device and are not stored. Only what you then choose to translate or
explain goes out, as described above. The extension can only capture the tab you are in, at the
moment you start a scan (`activeTab`).

### 2.5 Synchronisation (off by default; only if you turn it on)

"This device only" is the default. If you choose a way to sync and confirm it, the following goes to
**the place you chose**:

| Way | Where the data goes |
| --- | --- |
| Browser sync | Your browser's own sync storage (Chrome sync / Firefox Sync), with your browser account |
| Google Drive | Your own Google Drive, in the app's hidden data folder (`drive.appdata` scope only) |
| Your own server | The WebDAV or HTTP address you entered |

**What is synced:** your words, translations, language pairs, a short context sentence (at most 160
characters), review progress, the days you did a quiz, removal records of deleted words, your
settings, and your last 10 practice tests (not with browser sync). **API keys** are included **only if
you turn on encryption**, inside the encrypted file.
**Never synced:** page addresses and titles, sign-in tokens, server passwords, your consents to
sending text to an AI provider (asked on each device), caches.

**Encryption (optional):** the file is encrypted before it leaves your browser with a key derived from
your password (PBKDF2 + AES-256-GCM). The password is not stored anywhere. If you lose it, the remote
copy cannot be recovered; your local vault is not affected.

### 2.6 Backup file (when you export it)

"Export" saves a JSON file to your computer with your vault, streak, settings and past tests. API keys
are included only if you tick "Include API keys" for that export; such a file is as secret as the keys.

### 2.7 Feedback (only if you send it)

The "Contact and feedback" form sends nothing until you press **Send**. "Show the data to be sent"
shows you everything that will go; what is sent is exactly what you saw.

**Sent:** the kind of message and the feature it is about; your text; your e-mail address only if you
enter one (otherwise the message is anonymous); **if "Include technical information" is ticked:** browser
name and version, operating system name, extension version, interface language, which features are on
(yes/no only) and the kind of sync (off / browser / cloud / own server — not which service or account);
**if "Include recent error records" is ticked** (off by default): the local error log described above.
**Never sent:** page addresses or content, the words in your vault, API keys, sign-in tokens, any user
or installation ID (the extension creates none).

**Where it goes:** over HTTPS to the developer's feedback receiver
(`wordvault-feedback.phoby.workers.dev`, a small program on Cloudflare Workers), which checks the
message and forwards it to the developer's Telegram chat through a bot.
**What is kept:** the receiver stores and logs nothing, except one number per day (how many messages
were forwarded, as an abuse limit), deleted after two days. Your IP address is seen by Cloudflare, as
with any request; the receiver uses it only for a per-minute rate limit and does not store it.
Firefox-based browsers add an `Origin` header with the extension's per-installation internal address;
the browser does this, and the receiver does not read, store or forward it. The
forwarded message stays in the developer's Telegram chat until the developer deletes it; Telegram's
privacy policy applies to it there.

In Firefox, these data types are declared as optional (`personalCommunications`,
`technicalAndInteraction`, `personallyIdentifyingInfo`); Firefox asks for them the first time you send.

### 2.8 Other

- **Support link:** "Support the project" is a plain link to a Buy Me a Coffee page; nothing is sent to
  that service unless you click it, and nothing is loaded from it.
- **System notifications** (only if you allow them): a quiz reminder; it contains no words or personal
  data.

## 3. How data is used

Data is used **only to provide the feature you asked for**. It is not sold, not transferred to anyone
except as described above, not used for advertising, profiling or creditworthiness, and not read by
humans — except the feedback you choose to send to the developer.

**Limited Use.** The use of information received from Google APIs will adhere to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies),
including the Limited Use requirements, and to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. Data from your Google Drive is used only to synchronise your
vault.

## 4. Your choices: access, export, deletion

- **See and export:** your vault is shown in the extension; "Export" saves all of it as a file.
- **Delete:** delete words in the vault; clear the translation cache in the settings; delete past tests;
  remove the extension to delete everything it stored in your browser.
- **Sync:** "Disconnect" stops it; "also delete the file in the cloud" removes the remote copy. In Google
  Drive you can also remove it under Settings → Manage apps → Wordvault.
- **Feedback you sent:** to have a message deleted, write to phoby.dev@gmail.com with enough to identify it
  (approximate date and time, and the e-mail address if you gave one). It is deleted from the Telegram
  chat; there is no other copy.
- **AI consent:** "Withdraw consent" in the AI settings.

## 5. Security

Credentials stay in your browser and are sent only to the service they belong to. All network
requests use HTTPS (except to a server on your own computer). The extension's pages contain no
remote code, and nothing from a web page or an AI answer is ever inserted into a page as HTML.

## 6. Children

Wordvault does not collect personal data from anyone by itself. The feedback form is not directed at
children, and its e-mail field is optional.

## 7. Changes

This policy is versioned with the extension. If what leaves your browser changes, this page and the
release notes will say so before the change takes effect.

## 8. Contact

phoby.dev@gmail.com
