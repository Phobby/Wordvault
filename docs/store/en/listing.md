# Store listing (English)

What goes into the listing forms of the Chrome Web Store and addons.mozilla.org (AMO). It has to stay
true to the extension and to `PRIVACY.md`; `tests/store.test.js` checks the short description.

## Name

Wordvault

## Short description

The Chrome Web Store takes it from the manifest (`src/_locales/en/messages.json`, `extDescription`,
at most 132 characters); it is repeated here so that the listing and the package say the same thing.

- **en:** Translate words on web pages and in video subtitles, save them to your vault and review them with quick quizzes.

AMO "Summary" (at most 250 characters):

```
Translate words on web pages, in YouTube captions and in text on screen, save them to your vault and review them with short quizzes. No account, no tracking; optional AI features with your own provider.
```

## Category and languages

- Chrome Web Store: **Education**.
- AMO: **Language Support** (one category is enough; a second is optional).
- Listing languages: English, Turkish (`../tr/listing.md`). The extension's interface is in English
  and Turkish.

## Long description

Plain text for Chrome (it shows line breaks, no Markdown). AMO accepts the same text; its limited
Markdown is not needed.

```
Wordvault is for learning a language while you browse.

TRANSLATE
• Double-click a word on any page: its translation opens next to it, and you can listen to how it is pronounced.
• Select a sentence or a paragraph and translate it from the right-click menu, the small button next to the selection or a keyboard shortcut.
• On YouTube, point at a word in the captions: the translation opens without leaving the video.
• Scan text on screen: pause a video or open an image, drag over an area, and the text in it is read on your device (English and Turkish text). Click a word to translate it.
• Translations come from MyMemory out of the box; you can use DeepL with your own API key instead.

KEEP AND REVIEW
• "Add to vault" saves a word with the sentence it came from, plus dictionary definitions and examples from Wiktionary.
• From time to time Wordvault asks you about your saved words in a short four-choice quiz, on the page, in the popup or in a small window. Words you get wrong come back sooner; words you know come back less and less often.
• Export and import your vault as a JSON file.
• If you like, keep your vault in step across your devices: with your browser's own sync, your own Google Drive, or your own WebDAV server. The file can be encrypted with a password.

OPTIONAL AI FEATURES (off by default)
Connect an AI provider of your own (Google Gemini, Claude, NVIDIA, an OpenAI-compatible service or Ollama on your computer) to get:
• "Explain with AI" for a word, a sentence or a passage, and "Ask about the image" for an area of the screen.
• "Summarise this page" and "Translate this page with AI". The card shows how much text would be sent before you agree, and a translated page can always be put back.
• "Create a test with AI": a printable practice test (fill in the blank, true/false) made from words in your vault.
Your API key stays in your browser and goes only to the provider you chose. Requests are made only when you ask, and the first one asks for your consent.

PRIVACY
• No account, no analytics, no tracking, no ads.
• Wordvault has no server for your vault: your words and the pages you visit do not reach the developer.
• Only the text you ask to have translated goes to the translation service.
• Screen scanning reads the picture inside your browser; the picture is not stored and does not leave your device unless you use "Ask about the image" with your own AI provider.
• Your vault leaves the browser only if you turn on synchronisation, and only to the place you choose.
• The feedback form sends something only when you press "Send", after showing exactly what will be sent.

Wordvault is free. If it helps you, there is a "Support the project" link in the settings.
```

## Images

See `../visual-assets.md`.

## Links for the listing forms

- Privacy policy: the public address of `docs/privacy.html` → `[PRIVACY_POLICY_URL]`
- Support / contact e-mail: `[CONTACT_EMAIL]`
- Homepage (optional): `[HOMEPAGE_URL]`
