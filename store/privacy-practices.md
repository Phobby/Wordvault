# Chrome Web Store: "Privacy practices" sekmesi

Panele yapıştırılacak metinler ve işaretlenecek kutular. `PRIVACY.md` ve `docs/privacy.html` ile
tutarlı olmalıdır.

## Tek amaç (Single purpose)

> Wordvault helps the user learn vocabulary in a foreign language while browsing: it translates a word the user picks on a web page, in video captions or in text scanned from the screen, saves it to a personal word list ("vault") and reviews saved words with short quizzes.

Bütün özellikler bu amaca hizmet eder: eşitleme kasayı taşır, geri bildirim formu ve destek bağlantısı
eklentinin kendisiyle ilgilidir.

## İzin gerekçeleri

`store/permissions.md`.

## Uzak kod (Remote code)

**"No, I am not using remote code"** işaretlenir.

> All JavaScript and WebAssembly the extension runs is in the package. Nothing is loaded from the network and executed: no remote scripts, no eval of fetched text, no remotely hosted modules. The text recognition engine (Tesseract.js 7.0.0, its WebAssembly core and the English and Turkish language data) is bundled unmodified under vendor/tesseract. The extension's content security policy is script-src 'self' 'wasm-unsafe-eval'; 'wasm-unsafe-eval' only permits compiling the bundled WebAssembly module. Network requests fetch data only (translations, dictionary entries, audio recordings, the user's own synchronised vault file).

## Veri kullanımı (Data usage)

İşaretlenecek veri türleri:

| Tür | İşaret | Neden |
| --- | --- | --- |
| Personally identifiable information | **Evet** | Yalnızca geri bildirim formunda, kullanıcı **isterse** yazdığı e-posta adresi. |
| Health information | Hayır | |
| Financial and payment information | Hayır | Destek bağlantısı başka bir siteyi açar; eklenti ödeme bilgisi görmez. |
| Authentication information | Hayır | Bulut hesabının erişim token'ları yalnızca tarayıcıda durur, geliştiriciye gitmez. |
| Personal communications | **Evet** | Yalnızca kullanıcının geri bildirim formuna yazıp gönderdiği mesaj. |
| Location | Hayır | IP adresi toplanmaz; altyapı sağlayıcısı görür, alıcı kaydetmez. |
| Web history | Hayır | |
| User activity | Hayır | Tıklama, kaydırma, tuş kaydı tutulmaz; analitik yok. |
| Website content | **Evet** | Kullanıcının çevirisini istediği metin (çift tıkladığı kelime ya da seçip sağ tık menüsü, "Çevir" düğmesi veya kısayolla çevirdiği cümle/paragraf) yalnızca seçili çeviri servisine gider, başka hiçbir yere gitmez; kullanıcı kendi yapay zekâ sağlayıcısını bağlayıp "Yapay zekâ ile açıkla"ya basarsa kelime, cümlesi ve sayfa başlığı (ya da seçtiği metin; ekran taramasında "Açıkla"ya basarsa taranan alandan okunan metin ya da seçtiği kısmı, ekran görüntüsü asla gönderilmez; "Görsel hakkında sor"u başlatıp "Sor"a basarsa ve görseller için ayrıca onay verirse ekranda seçtiği alanın görüntüsü, sorusu ve sayfa başlığı), "Sayfayı özetle"yi isteyip kartta onaylarsa sayfanın ana metni ve başlığı (form alanları, gizli bölümler ve kullanıcının yazdıkları hariç; en çok 120.000 karakter), "Sayfayı yapay zekâ ile çevir"i (deneysel) isteyip kartta onaylarsa sayfanın görünür metni ve başlığı (aynı alanlar hariç; en çok 100.000 karakter) yalnızca o sağlayıcıya gider (varsayılan kapalı, her istek elle ve onaydan sonra); kaydettiği kelimeler, eşitleme açılırsa, kullanıcının seçtiği hesaba gider. |

> ASSUMPTION: Geri bildirim metni "Personal communications", isteğe bağlı e-posta "Personally
> identifiable information" sayıldı. İkisi de yalnızca kullanıcı formu gönderirse geçerlidir; temkinli
> davranıp işaretlemek, işaretlememekten güvenlidir.

Üç beyan da doğrudur ve işaretlenir:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Gizlilik politikası adresi

`docs/privacy.html` dosyasının yayınlandığı adres (bkz. `store/README.md`, "Açık kalanlar").

## Google kullanıcı verisi (Drive)

Eşitleme Google Drive'ın yalnızca uygulamaya özel gizli klasörünü kullanır (`drive.appdata`). "Limited
Use" beyanı `PRIVACY.md` ve `docs/privacy.html` içindedir.

## addons.mozilla.org

`manifest.firefox.json` içindeki `data_collection_permissions` beyanı mağaza sayfasında kendiliğinden
gösterilir: zorunlu `websiteContent`; isteğe bağlı `personalCommunications`, `technicalAndInteraction`,
`personallyIdentifyingInfo` (yalnızca geri bildirim). Kaynak kodu gönderimi gerekmez: paket derlenmemiş
kaynaktan oluşur, tek küçültülmüş kod değiştirilmemiş Tesseract dosyalarıdır (sürümler ve SHA-256:
`src/vendor/tesseract/README.md`).
