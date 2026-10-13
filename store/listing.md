# Mağaza açıklaması

Chrome Web Store ve addons.mozilla.org için açıklama metinleri. Eklentinin yaptığı değişince burası da
güncellenir; `PRIVACY.md` ve `store/privacy-practices.md` ile çelişmemelidir.

## Ad

Wordvault

## Kısa açıklama (en çok 132 karakter)

Manifestteki açıklamanın aynısıdır (`_locales/*/messages.json`: `extDescription`); mağaza onu oradan alır.

- **en:** Translate words on web pages and in video subtitles, save them to your vault and review them with quick quizzes.
- **tr:** Web sayfalarındaki ve video altyazılarındaki kelimeleri çevir, kasana kaydet ve kısa quizlerle tekrar et.

## Kategori ve dil

- Kategori: **Education** (Chrome: "Education"; AMO: "Language Support" + "Search Tools" yerine "Other").
- Diller: English, Türkçe.

## Uzun açıklama

**en**

```
Wordvault is for learning a language while you browse.

• Double-click a word on any page: its translation opens on top of the page, and you can listen to how it is pronounced.
• Select a sentence or a paragraph and translate it: from the right-click menu ("Translate with Wordvault"), the small button next to the selection, or a keyboard shortcut.
• On YouTube, point at a word in the captions: the translation opens without leaving the video.
• Scan text on screen: pause a video or open an image, select an area, and the text inside it is read on your device. Click a word to translate it.
• Save words with "Add to vault". Each word stays in your vault with the sentence it came from.
• From time to time Wordvault asks you about your saved words in a short four-choice quiz. Words you get wrong come back more often; words you know come back less and less often.
• Optional, off by default: connect an AI provider of your own (Gemini, Claude, an OpenAI-compatible service or local Ollama) and get "Explain with AI" for a word or a selected passage. Your key stays in your browser.
• Translations come from MyMemory out of the box; if you prefer, use DeepL with your own API key.
• Export and import your vault as a JSON file.
• If you like, keep your vault in step across your devices: with your browser's own sync, with your own Google Drive, OneDrive or Dropbox account, or with your own server (WebDAV). You can encrypt the file with a password.

PRIVACY
• No account, no analytics, no tracking, no ads.
• There is no server for your vault: nothing about your words or the pages you visit goes to the developer.
• The text you ask to have translated goes to the translation service, and nothing else of the page does.
• Screen scanning reads the picture inside your browser. The picture is not stored and never leaves your device.
• Your vault is sent only if you turn synchronisation on, and only to the account or server you choose. The default is "Only this device".
• The feedback form sends something only when you press "Send", after showing you exactly what will be sent.

Wordvault is free. If it helps you, there is a "Support the project" link in the settings.
```

**tr**

```
Wordvault, gezinirken dil öğrenmek içindir.

• Herhangi bir sayfada bir kelimeye çift tıkla: çevirisi sayfanın üstünde açılır, telaffuzunu dinleyebilirsin.
• Bir cümle ya da paragraf seç ve çevir: sağ tık menüsünden ("Wordvault ile çevir"), seçimin yanındaki küçük düğmeden ya da klavye kısayoluyla.
• YouTube'da altyazıdaki bir kelimenin üzerine gel: çeviri videodan çıkmadan açılır.
• Ekrandan metin tara: videoyu durdur ya da bir resim aç, bir alan seç; içindeki yazı cihazında okunur. Çevirmek için kelimeye tıkla.
• "Kasaya ekle" ile kaydet. Her kelime, alındığı cümleyle birlikte kasanda durur.
• Wordvault ara sıra kasandaki kelimeleri dört şıklı kısa bir quizle sorar. Yanlış bildiklerin daha sık, iyi bildiklerin giderek daha seyrek gelir.
• İsteğe bağlı, varsayılan olarak kapalı: kendi yapay zekâ sağlayıcını (Gemini, Claude, OpenAI uyumlu bir servis ya da yerel Ollama) bağla; kelime ya da seçtiğin metin için "Yapay zekâ ile açıkla" gelsin. Anahtarın tarayıcında kalır.
• Çeviriler varsayılan olarak MyMemory'den gelir; istersen kendi API anahtarınla DeepL kullanabilirsin.
• Kasanı JSON dosyası olarak dışa ve içe aktarabilirsin.
• İstersen kasanı cihazların arasında eşitle: tarayıcının kendi senkronuyla, kendi Google Drive, OneDrive ya da Dropbox hesabınla, ya da kendi sunucunla (WebDAV). Dosyayı parolayla şifreleyebilirsin.

GİZLİLİK
• Hesap yok, analitik yok, izleme yok, reklam yok.
• Kasan için bir sunucu yoktur: kelimelerin ve gezdiğin sayfalarla ilgili hiçbir şey geliştiriciye gitmez.
• Çevirisini istediğin metin çeviri servisine gider; sayfanın başka hiçbir şeyi gitmez.
• Ekran taraması görüntüyü tarayıcının içinde okur. Görüntü saklanmaz ve cihazından çıkmaz.
• Kasan yalnızca sen eşitlemeyi açarsan ve yalnızca senin seçtiğin hesaba ya da sunucuya gönderilir. Varsayılan "Sadece bu cihaz"tır.
• Geri bildirim formu yalnızca sen "Gönder"e bastığında, gidecek veriyi tam olarak gösterdikten sonra bir şey gönderir.

Wordvault ücretsizdir. İşine yarıyorsa ayarlarda bir "Projeyi destekle" bağlantısı var.
```

## Görseller

| Dosya | Boyut | Ne gösteriyor |
| --- | --- | --- |
| `screenshots/1-translation.png` | 1280×800 | Çift tıklanan kelimenin çeviri baloncuğu |
| `screenshots/2-vault.png` | 1280×800 | Kasa penceresi |
| `screenshots/3-quiz.png` | 1280×800 | Sayfadaki quiz kartı |
| `screenshots/4-settings.png` | 1280×800 | Ayarlar sayfası |
| `promo-440x280.png` | 440×280 | Küçük tanıtım görseli (taslak) |
| `../src/icons/icon-128.png` | 128×128 | Mağaza ikonu |

Ekran görüntüleri yüklü eklentiyle, sahte bir makale sayfasında, Playwright ile alınmıştır; kasa
penceresi tarayıcının araç çubuğu penceresinde açılamadığı için kendi boyutunda çekilip sayfa görüntüsünün
üzerine yerleştirilmiştir.
