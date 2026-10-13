# İzin gerekçeleri

Chrome Web Store'un "Privacy practices" sekmesi her izin için ayrı bir gerekçe ister. Aşağıdaki
İngilizce metinler oraya yapıştırılmak içindir. Kaynak: `manifest.chrome.json`, `manifest.firefox.json`
ve `README.md`'nin "İzinler" bölümü. Manifestteki her izin burada olmalıdır (`tests/store.test.js`
bunu denetler).

## `storage`

> Stores the user's settings and their vault (the words they saved, with translations and review progress) locally in the browser with chrome.storage.local. Nothing stored this way is sent to the developer.

## `unlimitedStorage`

> The vault grows with every saved word and is never trimmed automatically. This permission keeps it from hitting the 10 MB limit of chrome.storage.local, so that saved words are not lost.

## `alarms`

> Schedules the periodic vocabulary quiz and, if the user turned synchronisation on, the periodic sync. An alarm wakes the service worker when it is time; there is no other way to run something later in Manifest V3.

## `identity`

> Used only for chrome.identity.launchWebAuthFlow, to open the sign-in window of the cloud storage provider the user chose for synchronising their vault (Google Drive, OneDrive or Dropbox). The extension does not request the browser account's e-mail address (no identity.email permission) and does not sign the user in to anything on its own.

## `activeTab`

> "Scan text on screen": when the user presses the keyboard shortcut or picks the menu item, the extension takes one picture of the current tab (chrome.tabs.captureVisibleTab) so that the area the user selects can be read with on-device text recognition. activeTab limits this to the tab the user invoked the extension on, at that moment. The picture is processed locally, is not stored and is never transmitted.

## `contextMenus`

> Adds the "Scan text on screen" item to the page's context menu and to the toolbar button's menu, as a second way to start a scan besides the keyboard shortcut.

## `offscreen`

> On-device text recognition (Tesseract compiled to WebAssembly, bundled with the extension) needs a Web Worker and a canvas, which a Manifest V3 service worker cannot create. An offscreen document runs the recognition. It is created when a scan starts and closed after a minute of inactivity. Reason: WORKERS.

## `scripting`

> Chrome does not inject content scripts into tabs that were already open when the extension was installed or updated. If the user starts a screen scan in such a tab, the extension's own bundled content scripts are injected into that tab with chrome.scripting.executeScript. It is used only together with activeTab, in the tab the user invoked the scan on, and only with files from the package (no remote code, no code strings).

## `notifications` (optional)

> Optional and not granted at installation. Requested only if the user presses "Allow" in the settings. Used as a last resort to tell the user that a quiz is waiting when it cannot be shown any other way. The notification contains no words from the vault.

## Host permission: `https://api.mymemory.translated.net/*`

> The default translation service. When the user asks for a translation, the selected text and the language pair are sent there from the service worker. Nothing else of the page is sent.

## Host permission: `https://en.wiktionary.org/*`

> When the user adds a word to the vault, its word type, definitions and example sentences are fetched from Wiktionary. In Firefox-based browsers on macOS it is also asked for a pronunciation recording.

## Host permission: `https://upload.wikimedia.org/*`

> Downloads the pronunciation recording (an audio file on Wikimedia Commons) for a word when the user presses the pronunciation button, in the browsers where recordings are used.

## Optional host permissions: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`

> Optional and not granted at installation. The pattern is broad because the address is not known in advance, but the extension always requests one specific origin at the moment it is needed, with the browser's own prompt: (1) the API hosts of the cloud provider the user connects for synchronisation (for example www.googleapis.com), (2) the address of the user's own WebDAV/HTTP server, which only the user knows (localhost for a server on their own computer), (3) the host of the feedback receiver (wordvault-feedback.phoby.workers.dev) the first time the user sends feedback, and (4) DeepL's API host (api-free.deepl.com or api.deepl.com) if the user chooses DeepL as the translation service and tests their own API key. No origin is requested without a user action.

## Content scripts: `<all_urls>`

> Translation on double-click has to work on whatever page the user is reading, so the content script is present on all pages. It reads nothing from the page until the user double-clicks a word (or starts a screen scan); then only the selected text is used. A second script, limited to youtube.com and youtube-nocookie.com, finds the word under the pointer in the video captions.

## Content Security Policy: `'wasm-unsafe-eval'`

> Allows extension pages to compile WebAssembly. The text recognition engine (Tesseract core) is a WebAssembly module that is bundled in the package. No code is loaded from the network.

## Yalnızca Firefox: `data_collection_permissions`

- Zorunlu: `websiteContent` (çevirisi istenen metin çeviri servisine, kasaya eklenen kelime Wiktionary'ye;
  eşitleme açılırsa kasadaki kelimeler kullanıcının seçtiği yere).
- İsteğe bağlı, yalnızca geri bildirim gönderilirken: `personalCommunications` (yazılan metin),
  `technicalAndInteraction` (teknik bilgi ya da hata kayıtları eklendiyse), `personallyIdentifyingInfo`
  (e-posta yazıldıysa).
