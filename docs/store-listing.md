# Mağaza açıklaması

Chrome Web Store ve addons.mozilla.org için açıklama metni ve veri beyanları. Eklentinin yaptığı
değişince burası da güncellenir; `PRIVACY.md` ile çelişmemelidir.

## Kısa açıklama (en çok 132 karakter)

- **tr:** Web sayfalarında kelime çevir, kasana kaydet, kısa quizlerle tekrar et. İstersen kasanı kendi hesabınla eşitle.
- **en:** Translate words on web pages, save them to your vault, review them with quick quizzes. Sync with your own account if you like.

## Uzun açıklama

**tr**

Wordvault, gezinirken dil öğrenmek içindir.

- Bir kelimeye çift tıkla: çevirisi sayfanın üstünde açılır, telaffuzunu dinleyebilirsin.
- Ekrandan metin tara: videoyu durdur, bir alan seç; videonun ve resimlerin içindeki yazı cihazında
  okunur, kelimeye tıklayınca çevirisi açılır.
- "Kasaya ekle" ile kaydet; kelime, bağlam cümlesiyle birlikte kasanda durur.
- Wordvault ara sıra kasandaki kelimeleri dört şıklı kısa bir quizle sorar. Yanlış bildiklerin daha
  sık, iyi bildiklerin giderek daha seyrek gelir.
- Kasanı JSON olarak dışa ve içe aktarabilirsin.
- İstersen kasanı cihazların arasında eşitle: tarayıcının kendi senkronuyla, Google Drive, OneDrive ya
  da Dropbox hesabınla, ya da kendi sunucunla (WebDAV). İstersen dosyayı parolayla şifrele.

Gizlilik: Wordvault'un sunucusu yoktur. Hiçbir veri geliştiriciye gitmez; analitik ve izleme yoktur.
Çevirisini istediğin metin çeviri servisine gider. Ekran taramasında görüntü cihazında okunur, saklanmaz
ve tarayıcıdan çıkmaz. Kasan, yalnızca sen eşitlemeyi açarsan ve yalnızca
senin seçtiğin hesaba ya da sunucuya gönderilir; varsayılan "Sadece bu cihaz"tır.

**en**

Wordvault is for learning a language while you browse.

- Double-click a word: its translation opens on top of the page, and you can listen to it.
- Save it with "Add to vault"; the word stays in your vault with the sentence it came from.
- From time to time Wordvault asks you about your saved words in a short four-choice quiz. Words you
  get wrong come back more often, words you know less and less often.
- Export and import your vault as JSON.
- If you like, keep your vault in step across your devices: with your browser's own sync, with your
  Google Drive, OneDrive or Dropbox account, or with your own server (WebDAV). Optionally encrypt the
  file with a password.

Privacy: Wordvault has no server. No data goes to the developer; there are no analytics and no
tracking. Text you ask to have translated goes to the translation service. Your vault is sent only if
you turn synchronisation on, and only to the account or server you choose; the default is "Only this
device".

## Veri beyanları

**addons.mozilla.org** (`data_collection_permissions`, `manifest.firefox.json`): `websiteContent`.
Gerekçe: çevirisi istenen metin çeviri servisine, kasaya eklenen kelime Wiktionary'ye gider;
eşitleme açıldığında kasadaki kelimeler (web sayfalarından alınmış metin) kullanıcının seçtiği
hesaba ya da sunucuya gider. Başka bir veri türü tarayıcıdan çıkmaz: konum, gezinme geçmişi, kimlik
bilgisi, ödeme bilgisi toplanmaz; erişim token'ları tarayıcıda kalır.

**Chrome Web Store** ("Privacy practices"):

- Tek amaç: web sayfalarındaki kelimeleri çevirmek, kaydetmek ve tekrar ettirmek.
- Toplanan veri türü olarak yalnızca "Website content" işaretlenir (çeviri için seçilen metin ve
  kullanıcının kaydettiği kelimeler).
- Üç beyan da doğrudur ve işaretlenir: veri üçüncü taraflara satılmaz; tek amaçla ilgisiz bir amaç için
  kullanılmaz ya da aktarılmaz; kredi değerliliği ya da borç verme amacıyla kullanılmaz.
- İzin gerekçeleri: `README.md`, "İzinler" bölümü.
- Google kullanıcı verisi (Drive'ın uygulama verisi klasörü) için "Limited Use" beyanı: `PRIVACY.md`.
