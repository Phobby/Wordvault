# Test talimatları (inceleyiciler için)

Chrome Web Store'un "Test instructions" alanına yapıştırılacak metin. Hesap ya da parola gerekmez.

```
No account or login is needed. All core features work right after installation.

1. TRANSLATE: Open any English article (for example https://en.wikipedia.org/wiki/Language). Double-click a word. A bubble with the translation opens next to it. The first time, pick the language to translate into.

2. SAVE: In the bubble press "Add to vault". Click the Wordvault toolbar button: the word is in the list. Click it to see its dictionary entry.

3. QUIZ: Save at least 4 words with different meanings. Open the extension's settings (toolbar popup → "Settings", or the extension's "Options"). Under "Flashcard", open "Why is there no quiz?" and press "Test now": a four-choice question appears.

4. YOUTUBE CAPTIONS: Open a YouTube video that has captions, turn captions on, pause, and hold the pointer over a word in the caption. The translation bubble opens.

5. SCAN TEXT ON SCREEN: On any page press Alt+Shift+S (macOS: Command+Shift+E), or right-click → "Scan text on screen". Drag a rectangle over some text (also inside an image or a paused video). After a few seconds the recognised words can be clicked for a translation. Recognition runs locally (bundled WebAssembly); nothing is uploaded.

6. FEEDBACK: Settings → "Contact and feedback". Write at least 10 characters and press "Show the data to be sent". The exact JSON is shown. Nothing is sent unless "Send" is pressed; the browser then asks for permission for wordvault-feedback.phoby.workers.dev only.

7. SYNCHRONISATION (optional, off by default): Settings → "Synchronisation and backup". "Browser sync" needs no setup. Cloud providers open the provider's own sign-in window; the extension only gets access to its own app folder.

Permissions are explained one by one in the "Privacy practices" tab. Optional host permissions are requested only for one specific origin at the moment the user connects a sync target or sends feedback.
```
