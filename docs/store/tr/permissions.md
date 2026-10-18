# Permission justifications (Turkish)

The Turkish version of `../en/permissions.md`, for reading. The Chrome Web Store dashboard is filled
in **in English** (`../en/permissions.md`); keep the two in step.

## `storage`

> Ayarları ve kasayı (kaydedilen kelimeler, çevirileri, tekrar ilerlemesi) tarayıcıda yerel olarak
> `chrome.storage.local` ile saklar. Bu yolla saklanan hiçbir şey geliştiriciye gönderilmez.

## `unlimitedStorage`

> Kasa her kaydedilen kelimeyle büyür ve kendiliğinden kısaltılmaz. Bu izin, kasanın
> `chrome.storage.local`'ın 10 MB sınırına takılıp kelimelerin kaybolmasını önler.

## `alarms`

> Düzenli kelime quizini ve kullanıcı açtıysa düzenli eşitlemeyi zamanlar. Zamanı gelince arka plan
> betiğini uyandırır; Manifest V3'te bir işi sonraya bırakmanın başka yolu yoktur.

## `identity`

> Yalnızca `chrome.identity.launchWebAuthFlow` için: kullanıcı kasasını Google Drive ile eşitlemeyi
> seçtiğinde Google'ın oturum açma penceresini açar. Tarayıcı hesabının e-posta adresi istenmez
> (`identity.email` yok), eklenti kendiliğinden hiçbir yere oturum açmaz.

## `activeTab`

> "Ekrandan metin tara": kullanıcı kısayola bastığında ya da menüden seçtiğinde etkin sekmenin tek bir
> görüntüsü alınır (`tabs.captureVisibleTab`), seçilen alan cihazda metin tanımayla okunur. Görüntü
> yerelde işlenir, saklanmaz. "Görsel hakkında sor" (isteğe bağlı yapay zekâ özelliği, varsayılan
> kapalı) aynı şekilde başlar; seçilen alan yalnızca önizlemeden, görseller için ayrı onaydan ve
> kullanıcının "Sor"a basmasından sonra, kullanıcının bağladığı sağlayıcıya gider. Aynı kullanıcı
> eylemi (sağ tık menüsü, araç çubuğu penceresi, kısayol) "Wordvault ile çevir", "Sayfayı özetle" ve
> "Sayfayı yapay zekâ ile çevir"in o sekmeye ulaşmasını sağlar.

## `contextMenus`

> İki öğe ekler: seçili metnin sağ tık menüsünde "Wordvault ile çevir" (ayarlardan kapatılabilir) ve
> sayfanın ve araç çubuğu düğmesinin menüsünde "Ekrandan metin tara". Bir yapay zekâ sağlayıcısı
> bağlıyken sayfanın menüsüne "Sayfayı özetle" ve "Sayfayı yapay zekâ ile çevir" de gelir.

## `offscreen` (yalnızca Chrome)

> Cihazda metin tanıma (pakete gömülü, WebAssembly'ye derlenmiş Tesseract) bir Web Worker ve canvas
> ister; Manifest V3 service worker'ı bunları oluşturamaz. Tanıma görünmez bir offscreen belgede
> çalışır; tarama başlayınca açılır, bir dakika boşta kalınca kapanır. Gerekçe: WORKERS.

## `scripting`

> Chrome, eklenti kurulmadan ya da güncellenmeden önce açık olan sekmelere içerik betiği eklemez.
> Kullanıcı böyle bir sekmede tarama başlatırsa ya da seçili metni çevirmek isterse, eklentinin kendi
> paketteki betikleri o sekmeye `scripting.executeScript` ile eklenir. Yalnızca `activeTab` ile, yalnızca
> kullanıcının eklentiyi çağırdığı sekmede ve yalnızca paketteki dosyalarla (uzak kod yok, kod metni
> yok).
>
> "Sayfayı özetle" (yalnızca kullanıcı kendi sağlayıcısını bağladıysa): sayfanın ana metnini okuyan ve
> özet kartını gösteren dosyalar (değiştirilmemiş Mozilla Readability ve eklentinin iki küçük betiği)
> her sayfada bulunmaz; kullanıcı özet istediği anda o sekmeye eklenir. Firefox'ta da bu izin bu
> yüzden var. "Sayfayı yapay zekâ ile çevir" aynı şekilde çalışır.

## `notifications` (isteğe bağlı)

> Kurulumda verilmez; kullanıcı ayarlarda "İzin ver"e basarsa istenir. Quiz başka hiçbir yolla
> gösterilemiyorsa son çare olarak bekleyen bir quiz olduğunu söyler ve akşam hatırlatıcısı için
> kullanılır. Bildirimde kasadaki kelimeler yer almaz.

## Sunucu izni: `https://api.mymemory.translated.net/*`

> Varsayılan çeviri servisi. Kullanıcı çeviri istediğinde seçili metin ve dil çifti oraya gönderilir;
> sayfanın başka hiçbir şeyi gönderilmez.

## Sunucu izni: `https://en.wiktionary.org/*`

> Kelime kasaya eklenince türü, tanımları ve örnek cümleleri Wiktionary'den alınır. İnsan sesiyle
> kayıt kullanıldığında (macOS'ta Firefox tabanlı tarayıcılar ya da kullanıcı açtıysa) kelimenin
> kaydı da Wiktionary'ye sorulur.

## Sunucu izni: `https://upload.wikimedia.org/*`

> Kullanıcı telaffuz düğmesine bastığında, kaydın kullanıldığı tarayıcılarda kelimenin ses kaydını
> (Wikimedia Commons'taki dosya) indirir.

## İsteğe bağlı sunucu izinleri: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`

> Kurulumda verilmez. Adres önceden bilinemediği için desen geniştir; ama eklenti her seferinde
> gerektiği anda tek bir adresi, tarayıcının kendi sorusuyla ister: (1) eşitleme için bağlanan Google
> Drive'ın API adresleri, (2) yalnızca kullanıcının bildiği kendi WebDAV/HTTP sunucusunun adresi,
> (3) ilk geri bildirim gönderiminde geri bildirim alıcısının adresi
> (wordvault-feedback.phoby.workers.dev), (4) DeepL seçilip anahtar sınanınca DeepL'in API adresi,
> (5) bir yapay zekâ sağlayıcısı bağlanınca yalnızca o sağlayıcının adresi. Kullanıcı eylemi olmadan
> hiçbir adres istenmez.

## İçerik betikleri: `<all_urls>`

> Çift tıklamayla çeviri, kullanıcının okuduğu her sayfada çalışmalıdır; bu yüzden içerik betiği her
> sayfada bulunur. Kullanıcı bir kelimeye çift tıklayana (ya da tarama başlatana) kadar sayfadan hiçbir
> şey okumaz; sonra yalnızca seçili metin kullanılır. youtube.com ve youtube-nocookie.com ile sınırlı
> ikinci bir betik, video altyazısında işaretçinin altındaki kelimeyi bulur.

## İçerik güvenlik politikası: `'wasm-unsafe-eval'`

> Eklenti sayfalarının WebAssembly derlemesine izin verir. Metin tanıma motoru (Tesseract çekirdeği)
> pakete gömülü bir WebAssembly modülüdür. Ağdan kod yüklenmez.

## Yalnızca Firefox: `data_collection_permissions`

Gerekçeli tablo: `../en/privacy-practices.md`.
