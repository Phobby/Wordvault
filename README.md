# Wordvault

Firefox ve Chrome için dil öğrenme eklentisi. Web sayfalarında bilmediğin kelimeyi çevir, kasana
kaydet, sonra kısa quizlerle tekrar et. Her şey tarayıcında çalışır; Wordvault'un bir sunucusu yoktur.

> Geliştirme aşamalı ilerliyor. Şu an hazır olanlar: çift tıklama ile çeviri penceresi (kaynak ve hedef
> dil seçimi, telaffuz, "Kasaya ekle"), araç çubuğundaki kasa (liste, arama, detay, dışa/içe aktarma)
> ve hedef dil ile çift tıklama ayarlarını içeren ayarlar sayfası.
> Sırada: sağ tık menüsü, çeviri penceresinde kelime türü etiketi, önbellek ve 7 günlük temizlik,
> altyazılar ve ayarlar sayfasının kalanı (çeviri sağlayıcısı ve API anahtarı).
>
> Cihazlar arası senkronizasyon (`SPEC-SYNC.md`, `SPEC-SYNC-UI.md`) hazır: veri modeli, birleştirme,
> silme kayıtları, eşitleme motoru, ayarlar sayfasındaki "Senkronizasyon ve yedekleme" bölümü,
> tarayıcı senkronu (`storage.sync`), Google Drive, OneDrive, Dropbox, kendi sunucu modu (WebDAV,
> basit HTTP uç noktası) ve isteğe bağlı uçtan uca şifreleme. Varsayılan "Sadece bu cihaz"tır:
> kullanıcı bir yol seçip onaylamadıkça hiçbir yere veri gönderilmez. Bulut sağlayıcıları için bir kez
> geliştirici kurulumu gerekir (`SETUP-OAUTH.md`); o yapılana kadar kartları "Yapılandırma eksik" der.
> Gizlilik: `PRIVACY.md`.
>
> Flash card sistemi (`SPEC-QUIZ.md`, `SPEC-QUIZ-POPUP.md`) aşamalı ekleniyor; şu an hazır olanlar:
> zamanlayıcı, "Neden quiz çıkmıyor?" tanı paneli, "Şimdi test et", öğrenme algoritması, soru seçimi,
> şık üretimi, quiz arayüzü (süre ölçümü, "Bilmiyorum", "Sonra sor", zaman aşımı, seri mod, "Bugün
> sorma"), quiz'in eklenti açılır penceresinde, ayrı pencerede ya da sayfa içi kartta gösterilmesi ve
> Flash card ayarları (aç/kapat, sıklık, soru sayısı, görünüm, en az kelime, cevap süresi, vadesi
> gelmemişleri sorma). Günlük soru sınırı, sessiz saatler, kelime durumlarının kasada gösterimi ve
> "Şimdi çalış" modu sonraki aşamalarda.

## Derleme

Bağımlılık yok, bundler yok. Node.js 22.2 veya üstü yeterli.

```sh
node build.js            # dist/firefox ve dist/chrome klasörlerini üretir
node build.js --watch    # src/ değiştikçe yeniden üretir
node build.js firefox    # tek hedef
```

Testler de bağımlılıksızdır (Node'un yerleşik `node:test` modülü):

```sh
npm test                 # tests/ altındaki bütün testler
```

`build.js` yalnızca `src/` klasörünü kopyalar ve tarayıcıya özel manifesti (`manifest.firefox.json`
ya da `manifest.chrome.json`) `manifest.json` adıyla yanına yazar. Kopyalamadan önce manifestlerde
adı geçen dosyaların var olduğunu, sürüm numarasının `package.json` ile aynı olduğunu ve iki
manifestin izinlerinin birbirini tuttuğunu denetler.

## Tarayıcıya yükleme

**Firefox** (142 ve üstü): `about:debugging#/runtime/this-firefox` → *Geçici eklenti yükle…* →
`dist/firefox/manifest.json`. Kod değişince aynı sayfadaki *Yeniden yükle* düğmesine bas.

**Chrome** (116 ve üstü): `chrome://extensions` → *Geliştirici modu*nu aç → *Paketlenmemiş öğe yükle* →
`dist/chrome` klasörü. Kod değişince eklenti kartındaki yenile simgesine bas.

Eklenti yeniden yüklendikten sonra açık sekmeleri de yenile; eski sekmelerdeki içerik betiği
eklentiyle bağlantısını kaybeder.

## Proje yapısı

```
SPEC.md, SPEC-SYNC.md,  İstenen davranışın tanımı (eklenti, senkronizasyon ve arayüzü, flash card,
SPEC-SYNC-UI.md,        quiz'in zamanlayıcısı ve görünümü)
SPEC-QUIZ.md,
SPEC-QUIZ-POPUP.md,
SPEC-CAPTIONS.md        Video altyazılarında kelimenin üzerine gelince çeviri
SPEC-OCR.md             Ekrandan metin tarama (OCR) ve üzerine gelince çeviri
SPEC-SUPPORT.md         Destek bağlantısı, iletişim/geri bildirim ve mağaza hazırlığı
feedback-worker/        Geri bildirim alıcısı (Cloudflare Worker → Telegram/Discord), kendi README'siyle
manifest.firefox.json   Firefox manifesti (background.scripts, gecko ayarları)
manifest.chrome.json    Chrome manifesti (background.service_worker)
build.js                dist/ klasörlerini üretir
tools/make-icons.js     src/icons altındaki PNG'leri üretir (yalnızca tasarım değişince)
tools/self-hosted-server.js  "Kendi sunucum" için tek dosyalık örnek sunucu (bkz. docs/self-hosted.md)
docs/self-hosted.md     Kendi sunucu modu: WebDAV, HTTP uç noktasının protokolü, örnek sunucu
store/                  Mağaza hazırlığı: açıklamalar, izin gerekçeleri, veri beyanı, test talimatı, görseller
docs/privacy.html       Gizlilik politikasının web sürümü (en + tr), GitHub Pages için
SETUP-OAUTH.md          Bulut sağlayıcıları için bir kez yapılan geliştirici kurulumu
PRIVACY.md              Gizlilik politikası: tarayıcıdan ne, ne zaman, nereye çıkar
tests/                  node:test testleri (tarayıcı API'leri bellek içi bir taklitle sağlanır)
src/
  config.js             Yayıncıya ait adresler: SUPPORT_URL (destek sayfası)
  support/              "Projeyi destekle" kartı, düğmesi ve küçük bağlantısı (support.js, support.css)
  welcome/              İlk kurulumda bir kez açılan karşılama sayfası
  background/           Arka plan betiği: mesaj yönlendirme, tüm ağ istekleri
  shared/               Hem sayfaya eklenen betiklerin hem eklenti sayfalarının kullandığı arayüz
                        parçaları (klasik betik, ortak WV ad alanı)
    dom.js              Öğe üretici, mesajlaşma, Shadow DOM yüzeyi, arka planla açık bağlantı
    styles.js           Renkler, düğmeler ve çeviri penceresinin CSS'i
    language-list.js    Dil adları ve aranabilir dil listesi
    speech.js           Telaffuz: tarayıcı sesi (speechSynthesis) ya da ses kaydı (Web Audio)
    stopwatch.js        Cevap süresi: yalnızca sayfa kullanıcının önündeyken işleyen kronometre
    quiz-card.js        Quiz arayüzü: tek bileşen; sayfa içi kart, açılır pencere ve ayrı pencere
                        aynı kodu kullanır
  content/              Web sayfalarına eklenen betikler
    selection.js        Seçim, bağlam cümlesi ve dil yardımcıları
    quiz.js             Quiz'i sayfada gösterir; "şu an uygun mu" kontrolleri (ayarlar sayfası da yükler)
    triggers.js         Pencereyi açan tetikleyiciler (çift tıklama)
  ui/popup/popup.js     Çeviri penceresi (baloncuk): seçilen metin için de, bir kelime kaynağının
                        bulduğu kelime için de (openForHit) aynı pencere
  core/hover/           "İmlecin altındaki kelime" hattı; özellikten bağımsız (yalnızca YouTube'da yüklenir)
    word-source.js      WordSource sözleşmesi: ekrandaki bir noktadan kelimeyi (metin, satır, dikdörtgen)
                        veren ve metnin gittiğini bildiren kaynak
    words.js            Kelime sınırları (Intl.Segmenter), ses betimlemeleri, parçalı satırlar
    text-point.js       DOM'daki metinde noktadan kelimeye: caretPositionFromPoint + Range
    highlight.js        Kelimeyi CSS Custom Highlight API ile vurgular (sayfaya öğe eklemez)
    tracker.js          Üzerine gelme ne zaman sayılır (150 ms bekleme)
    hover.js            Kaynağı imlece ve çeviri penceresine bağlar
  features/captions/    Altyazı özelliği: yalnızca sitenin bağdaştırıcısını seçer
    selectors.js        Sitelerin oynatıcılarında kullanılan bütün seçiciler (tek yer)
    adapters/youtube.js YouTube altyazıları, bir kelime kaynağı olarak
  features/screen-ocr/  Ekrandan metin tarama
    background.js       Başlatma yolları (kısayol, sağ tık menüsü, araç çubuğu menüsü, kasa düğmesi);
                        Chrome'da betiği olmayan sekmeye içerik betiklerini ekler
    scan.js             Ekran görüntüsünü alır ve okutur (Chrome: offscreen belge, Firefox: arka plan sayfası)
    offscreen.html/.js  Chrome'un offscreen belgesi: görüntüyü okur, yalnızca kelimeleri geri verir
    pipeline.js         Kırp, büyüt, ön işle, oku, ele, sayfaya yerleştir; 60 sn boşta kalınca motoru kapatır
    preprocess.js       Ön işleme profilleri (düz, ters, yerel ters, altyazı), büyütme, siyah kare algılama
    filters.js          Yanlış kutuları eleme (güven, simge, boyut, biçim, çok kısa kelime), okumaları birleştirme
    geometry.js         Sayfanın CSS pikseli <-> ekran görüntüsünün pikseli; kelime/satır/blok gruplama
    languages.js        Dil kodu eşleme (BCP-47 <-> Tesseract), "otomatik"in anlamı
    engines/            Motor arayüzü (index.js) ve Tesseract.js motoru; üründe deneme motoru yoktur
    content/            Sayfadaki kısım (yalnızca üst çerçeve): area.js (alanın kuralları),
                        selector.js (alan seçimi), layer.js (metin katmanı), screen-ocr.js (akış, kelime kaynağı)
  vendor/tesseract/     Tesseract.js 7.0.0, çekirdeği ve İngilizce/Türkçe dil verisi; değiştirilmemiş
                        resmi dosyalar, sürümleri ve SHA-256 toplamları README.md içinde
  popup/                Araç çubuğu simgesinin açtığı kasa: liste, arama, detay, dışa aktarma
  options/              Ayarlar sayfası: hedef dil, çift tıklama, Flash card ayarları ve tanı paneli,
                        yedekleme (dışa/içe aktarma) ve senkronizasyon (options/sync.js)
  lib/                  Arka plan ve eklenti sayfalarının paylaştığı ES modülleri
    translator.js       Hedef/kaynak dil kararı ve sağlayıcı çağrısı
    text-damage.js      Yolda harf kaybetmiş metni tanır ("e?itle")
    settings.js         Ayarlar ve site bazlı kaynak dil
    vault.js            Kasa deposu
    dictionary.js       Wiktionary: kelime türü, tanım, örnek cümle
    pronunciation.js    Wikimedia Commons'taki telaffuz kayıtlarını bulur ve indirir
    backup.js           JSON dışa/içe aktarma
  providers/            Çeviri sağlayıcıları (ortak arayüz: providers/index.js)
  quiz/                 Flash card
    scheduler.js        Zamanlayıcı (chrome.alarms), quiz'in gösterilmesi, cevabın kaydı, tanı bilgisi
    display.js          Gösterme yolları (açılır pencere, ayrı pencere, sayfa içi kart, bildirim) ve
                        birinden diğerine düşme
    session.js          Ekrandaki quiz: art arda sorular, sayaçlar, özet
    quiz.html, page.js  Açılır pencerede ve ayrı pencerede quiz'i gösteren sayfa
    learning.js         Öğrenme algoritması: cevabın kalitesi, sonraki tekrar, zorluk, durum (TUNING)
    selection.js        Sıradaki kelimenin seçimi (SELECTION)
    question.js         Soru ve şık üretimi
  sync/                 Senkronizasyon
    engine.js           Eşitleme motoru: oku, birleştir, yaz, yerele uygula; kilit, yeniden deneme, alarmlar
    codec.js            Belgenin saklanan biçimi (gzip'lenmiş JSON)
    state.js            Senkron ayarı ve durumu (yalnızca storage.local)
    config.js           Geliştirici yapılandırması: OAuth client ID'leri (yer tutucu), dosya adı
    oauth.js            Oturum açma: launchWebAuthFlow ile PKCE ve örtük akış; client secret yok
    crypto.js           İsteğe bağlı şifreleme: PBKDF2 + AES-256-GCM, anahtarın saklanması
    bytes.js            Base64 yardımcıları
    request.js          Sağlayıcılara istek: ağ hataları ve durum kodlarının anlamı
    providers/          Sağlayıcılar (ortak arayüz: providers/index.js)
      browser.js        Tarayıcı senkronu (chrome.storage.sync, parçalı)
      gdrive.js         Google Drive (appDataFolder, yalnızca drive.appdata izni)
      onedrive.js       OneDrive (Microsoft Graph, approot, Files.ReadWrite.AppFolder)
      dropbox.js        Dropbox (App folder, files.content.read/write)
      webdav.js         Kendi sunucu: WebDAV (PROPFIND, GET, PUT + If-Match)
      http.js           Kendi sunucu: basit HTTP uç noktası (GET/PUT /vault)
      server.js         Kullanıcının girdiği adresin denetimi (yalnızca https; localhost hariç)
    model.js            Eşitlenen belgenin biçimi; kasa kaydı <-> eşitleme kaydı dönüşümü
    merge.js            İki belgeyi birleştirme, silme kayıtlarının temizliği
    local.js            Bu cihazın kasasını belge olarak okuma ve belgeyi kasaya uygulama
  _locales/             Arayüz metinleri (en, tr)
  icons/
```

Sayfaya eklenen bütün arayüz kapalı bir Shadow DOM içinde yaşar: sayfanın CSS'i eklentiye, eklentinin
CSS'i sayfaya ulaşamaz. Sayfanın kendi içeriği değiştirilmez.

### Video altyazıları (YouTube)

YouTube'da altyazıdaki bir kelimenin üzerinde imleci yaklaşık 150 ms tutunca çeviri penceresi açılır;
video oynarken de durmuşken de. Kelime, imlecin konumundan bulunur (`caretPositionFromPoint`, olmazsa
harflerin ölçülmesi) ve sınırları `Intl.Segmenter` ile belirlenir; altyazının DOM'una dokunulmaz,
vurgu CSS Custom Highlight API ile yapılır. Kaynak dil **altyazı satırının tamamından** yerelde
algılanır (sayfanın dili altyazının dili değildir). "Kasaya ekle" kelimeyi altyazı satırıyla birlikte
saklar. Altyazı yeniden çizilse ya da kaybolsa da açık pencere yerinde kalır ve altyazının hiçbir
satırını örtmez. `♪` ve `[Music]` gibi ses betimlemeleri kelime sayılmaz.

Yapı iki katmanlıdır: `core/hover/` ve `ui/popup/` altyazıyı bilmez, yalnızca `WordSource`
sözleşmesini (bkz. `core/hover/word-source.js`) bilir; `features/captions/` bu sözleşmeyi YouTube'un
DOM'u için uygular. İleride başka bir kaynak (ör. resimden tanınan metin) aynı hattı kendi
`wordAt` uygulamasıyla kullanabilir.

Seçiciler `features/captions/selectors.js` içindedir ve 12 Ekim 2026'da gerçek gömülü oynatıcıda
doğrulanmıştır. Testler: `tests/hover-words.test.js` (kelime sınırları, noktadan kelime, bekleme
kuralı, sözleşme) ve YouTube'un altyazı DOM'unu taklit eden çevrimdışı sayfa
`tests/fixtures/youtube-captions.html`.

Henüz yok (SPEC-CAPTIONS.md'nin sonraki aşamaları): otomatik duraklatma, tetikleme modları, akan
otomatik altyazılarda kararlı vuruş, "Satırı çevir", ayarlar ve tanı paneli, kısayollar, satır geçmişi,
YouTube dışındaki siteler.

### Ekrandan metin tarama (OCR)

Ekranda görünen yazıyı, videoların ve resimlerin **piksellerindeki** yazı dahil, cihazda okur
(Tesseract.js). Videoyu durdur, taramayı başlat, bir alan sürükle (ya da `Enter` ile tüm ekranı tara),
okunan kelimeye tıkla: mevcut çeviri penceresi açılır, "Kasaya ekle" kelimeyi okunan satırla birlikte
saklar.

**Başlatma:** kısayol (iki tarayıcıda da aynı: macOS'te **Cmd+Shift+E**, Windows/Linux/ChromeOS'ta
**Alt+Shift+S**), sayfada sağ tık → **Ekrandan metin tara**, araç çubuğu simgesine sağ tık → aynı
madde, ya da kasa penceresindeki tarama düğmesi. Kısayol Chrome'da `chrome://extensions/shortcuts`,
Firefox/Zen'de `about:addons` → dişli → **Manage Extension Shortcuts** ile değiştirilir; ayarlar
sayfası geçerli kısayolu ve bu adresi gösterir; kısayol atanmamışsa ya da Mac'te Option tuşu
içeriyorsa uyarır. Chrome önerilen kısayolu yalnızca **ilk kurulumda** atar: eklenti zaten kuruluysa
yeni varsayılan kendiliğinden gelmez, o sayfadan elle atanır.

Mac'te Option kullanılmaz: Option+harf macOS'te özel karakter yazar (Option+S → ß) ve tarayıcı
kısayolu olarak güvenilir değildir. Cmd+Shift+E seçildi çünkü macOS'in (Cmd+Shift+3/4/5 ekran
görüntüsü), Chrome'un ve Firefox'un Mac'teki kendi kısayollarıyla çakışmıyor (Cmd+Shift+S Firefox'ta
ekran görüntüsü aracıdır). Windows/Linux'ta Ctrl+Shift+E Firefox'ta ağ izleyicisini açtığı için orada
Alt+Shift+S kaldı; Alt bu sistemlerde özel karakter üretmez.

**Alan seçimi:** sayfa kararır, imleç artı olur; sürükleyerek bir alan seçilir, alan kenar ve
köşelerinden ayarlanır, içinden tutulup taşınır. **Tara** ya da `Enter` alanı tarar; alan yokken
`Enter` ya da çift tıklama görünen ekranın tamamını tarar; `Esc` iptal eder.

**Ekran görüntüsü:** seçim arayüzü kaldırılıp tarayıcı sayfayı onsuz çizdikten sonra (iki kare)
`tabs.captureVisibleTab` ile alınır (`activeTab`: yalnızca kullanıcı başlattığında, yalnızca o sekme).
Görüntü eklentinin kendi bağlamında işlenir: Chrome'da service worker Worker başlatamadığı için bir
**offscreen belgede**, Firefox'ta **arka plan sayfasında**. Sayfaya yalnızca kelimeler ve kutuları
döner. Görüntü hiçbir yere yazılmaz, ağa gönderilmez; iş bitince belleği bırakılır, motor 60 sn boşta
kalınca kapatılır.

**Koordinat eşleme** `devicePixelRatio`'ya güvenmez: oran, dönen görüntünün gerçek boyutundan ölçülür
(`geometry.js`), yatay ve dikey ayrı. Ekran yoğunluğu, tarayıcı yakınlaştırması ve çimdik yakınlaştırma
aynı hesapla doğru çıkar.

**Ön işleme** (`preprocess.js`): alan, metin okunacak boyuta gelsin diye 1-3 kat büyütülür (yoğun
ekranda daha az, büyük alanda daha az), griye çevrilir, kontrastı açılır. Sonra aynı görüntü birkaç
kez okunur: olduğu gibi (açık zeminde koyu yazı), koyu bölgeleri varsa yerel olarak ters çevrilmiş
(koyu şeritte açık yazı), tamamı koyuysa ters çevrilmiş, ve **altyazı profiliyle** (yalnızca beyaza
yakın, renksiz pikseller: hareketli görüntü üstündeki dış çizgili beyaz yazı). İki okuma aynı yerde
satır bulduysa, motorun daha emin olduğu satır gösterilir (`filters.js`, `mergeReadings`).

**Yanlış kutuları eleme** (`filters.js`): güven eşiğinin altındakiler (varsayılan 60, ayarlanabilir),
harf ya da rakam içermeyenler (üç nokta, ok, madde imi), 6 CSS pikselinden alçak kutular, kelime
biçiminde olmayan kutular (harf sayısına göre fazla geniş ya da dikey çubuk), tek başına duran tek
harfler ve satırında yalnız kalan, yüksek güvenle okunmamış iki harfliler atılır.

**Metin katmanı:** kelimeler görüntünün üstünde görünmez ama seçilebilir metin olarak durur; imleç
üzerine gelince vurgulanır, tıklanınca çeviri penceresi açılır. Tarama sonucu `WordSource` sözleşmesini
(`core/hover/word-source.js`) uygular: pencere, kasa ve bağlam altyazıdaki yolun aynısını kullanır.
Ayarlardaki **OCR kutularını göster** her kelimenin çevresine çerçeve çizer (hata ayıklama).

**Diller:** paketle İngilizce ve Türkçe verisi gelir. "Otomatik" ikisiyle birlikte okur; ayarlardan tek
dil seçilebilir. Başka dillerin verisini indirme henüz yok.

**Hatalar sayfada söylenir:** taranamayan sayfa, art arda çok tarama, siyah gelen görüntü ("Bu içerik
ekran görüntüsüne izin vermiyor olabilir": korumalı video), metin bulunamadı, motor hatası. Eklentinin
hiç çalışamadığı sayfalarda (`chrome://`, mağazalar) araç çubuğu simgesinde kısa süre "!" görünür.

**Chrome'da açık sekmeler:** Chrome, eklenti kurulduğunda ya da yeniden yüklendiğinde zaten açık olan
sekmelere içerik betiği eklemez (Firefox ekler). Tarama böyle bir sekmede başlatılırsa betikler o an
`chrome.scripting` ile eklenir.

Ölçülen (yüklü eklenti, başsız tarayıcı, test sayfası `tests/fixtures/ocr-page.html`): Chromium 1x ve
2x, Firefox 1x ve 2x; paragraf (İngilizce + Türkçe), koyu şeritteki satır, karedeki tabela ve dış
çizgili altyazı okunuyor; çubuklar, üç nokta, ikon, küçük resim ve siyah alan kutu olmuyor. Gerçek
YouTube oynatıcısında duraklatılmış karede altyazının 11 kelimesinden 10'u okundu (iki tarayıcıda da);
görüntünün kendisinden kare başına bir iki sahte kısa kelime çıkabiliyor. Süre: alan taraması 1,5-4,5 sn
(Chrome'da ilk tarama offscreen belge ve WebAssembly derlemesi yüzünden yavaş), tüm ekran 3-7 sn.

Henüz yok (SPEC-OCR.md): üzerine gelince kendiliğinden açılan pencere (şimdilik tıklama), kelime
düzeltme, "Satırı/Bloğu çevir", sürükleyerek ifade seçimi, videoyu otomatik duraklatma, başka dillerin
verisini indirme ve silme, tanı paneli, PaddleOCR denemesi ve kıyaslama aracı.

### Destek bağlantısı ve karşılama sayfası

Destek sayfasının adresi tek bir sabittir: `src/config.js` içindeki `SUPPORT_URL`. Başka bir servise
geçmek o satırı değiştirmektir. Sabit boşken ya da yer tutucuyken (`…/YOUR_PAGE`), `https` olmayan bir
adres yazıldığında da, destek arayüzünün **hiçbiri** gösterilmez.

Adres varken üç yerde görünür: ayarlar sayfasının en üstünde "Projeyi destekle" kartı, kasa
penceresinin altında küçük bir "Destekle" bağlantısı ve karşılama sayfasında aynı kart. Düğme sade bir
bağlantıdır (`target="_blank" rel="noopener noreferrer"`); destek servisinden betik, widget, resim ya da
yazı tipi yüklenmez, düğmenin rengi ve fincan simgesi pakettedir. Açılır pencere ya da hatırlatma
yoktur. Karşılama sayfasındaki kart "Bir daha gösterme" ile kalıcı olarak kapanır (`supportDismissed`,
yalnızca bu tarayıcıda); ayarlardaki kart yerinde kalır.

Karşılama sayfası (`welcome/welcome.html`) eklenti ilk kurulduğunda bir kez açılır (`welcomeShown`
bayrağı; geçici yüklemelerde her seferinde açılmasın diye). Sekme açmak izin gerektirmez.

### İletişim ve geri bildirim

Ayarlar sayfasının ikinci sekmesi (`options/options.html#feedback`). Bir form: tür (Hata / Öneri /
Diğer), ilgili özellik, 10-1500 karakterlik metin, isteğe bağlı e-posta, "Teknik bilgileri ekle"
(varsayılan açık) ve "Son hata kayıtlarını ekle" (varsayılan kapalı). E-posta programı açılmaz
(`mailto` yok).

**Kullanıcı görmeden hiçbir şey gitmez.** Formdaki tek düğme "Gönderilecek veriyi göster"dir; açılan
ekranda gidecek JSON'un tamamı ve gideceği alan adı durur, "Gönder" yalnızca oradadır. Gönderilen
gövde, önizlemede gösterilen nesnenin kendisidir; arka plan betiği göndermeden önce biçimini bir kez
daha denetler (`features/feedback/payload.js`: `checkPayload`) ve listede olmayan tek bir alan bile
varsa göndermez.

Alıcının adresi `src/config.js` içindeki `FEEDBACK_ENDPOINT` sabitidir. Alıcı `feedback-worker/`
klasöründeki Cloudflare Worker'dır; kurulumu, hız sınırı ve spam durumunda yapılacaklar
`feedback-worker/README.md` içindedir. Sabit boşken ya da yer tutucuyken form doldurulup önizlenebilir ama gönderilemez; ekran
bunu söyler. Yalnızca `https` kabul edilir (yerelde deneme için `http://localhost` / `127.0.0.1` de).

Gönderim arka plan betiğinden `fetch` ile yapılır: çerez ve yönlendiren adres gönderilmez, 12 sn zaman
aşımı, ağ hatasında ya da alıcının 5xx yanıtında **bir kez** yeniden deneme. Alıcı reddederse (4xx)
yeniden denenmez ve nedeni gösterilir. Başarılı bir gönderimden sonra 60 sn boyunca yenisi
gönderilemez (düğme geri sayar; arka plan betiği de reddeder). Form her değişiklikte `storage.local`
içine taslak olarak yazılır (`feedbackDraft`); gönderim başarısız olursa ya da sekme kapanırsa yazılan
kaybolmaz, başarılı olunca silinir.

**Teknik bilgi yalnızca şunlardır** (`features/feedback/tech-info.js`): tarayıcı adı ve sürümü (ve
üzerine kurulduğu motor), işletim sisteminin adı, eklenti sürümü, arayüz dili, hangi özelliklerin açık
olduğu (yalnızca `true`/`false`) ve senkronizasyonun türü (`off`/`browser`/`cloud`/`server`; hangi
servis ya da hesap olduğu değil). Tarayıcı, Firefox tabanlılarda `runtime.getBrowserInfo` ile (Zen,
LibreWolf gibi türevler kendi adını verir), Chromium tabanlılarda `navigator.userAgentData` markaları,
`navigator.brave` ve kullanıcı aracısı ile (Edge, Brave, Opera, Vivaldi) ayırt edilir. Sayfa adresi,
sayfa içeriği, kasadaki kelimeler, bağlam cümleleri, API anahtarları, OAuth belirteçleri toplanmaz;
kurulum kimliği ya da başka bir kalıcı tanımlayıcı üretilmez.

**Yerel hata günlüğü** (`features/feedback/error-log.js`): eklentinin arka plan betiğinde ve ayarlar
sayfasında yakalanmayan hatalar ile arka plan betiğinin beklenmeyen (kodsuz) hataları, son 20 kayıtlık
dairesel bir tamponda `storage.local` içinde tutulur (`errorLog`). Kayıt: hata mesajı, eklentinin
hangi bölümü, zaman ve yığının eklenti dosyalarını gösteren ilk dört satırı. Web sayfalarının hataları
dinlenmez. Her türlü adres yazılmadan önce çıkarılır (eklenti dosyalarının adresi paket içindeki yola
indirilir; Firefox'ta kuruluma özgü olan kimlik kısmı da böylece gider), uzun tırnak içi metinler
kısaltılır. Günlük yalnızca kullanıcı kutuyu işaretlerse gövdeye girer ve formdaki "Kayıtları sil" ile
silinebilir. Gövde 8 KB'ı aşacaksa en eski kayıtlar çıkarılır.

### Çeviri sağlayıcısı (MyMemory, DeepL)

Ayarlardaki "Çeviri sağlayıcısı" bölümünden seçilir (`options/provider.js`). Varsayılan **MyMemory**'dir:
anahtar istemez. **DeepL** kullanıcının kendi API anahtarıyla çalışır.

| Ne | Hangi servis |
| --- | --- |
| Sayfada çift tıklanan kelime / seçim | Seçili sağlayıcı |
| YouTube altyazısında üzerine gelinen kelime | Seçili sağlayıcı |
| Ekran taramasında tıklanan kelime | Seçili sağlayıcı |
| Kelime türü, tanımlar, örnek cümleler | Wiktionary (sağlayıcıdan bağımsız) |
| Telaffuz kaydı (Firefox/macOS) | Wiktionary / Wikimedia Commons (sağlayıcıdan bağımsız) |
| Dil algılama | Tarayıcının yerel algılayıcısı; yetmezse seçili sağlayıcının algılaması |
| Quiz'in şıkları | Kasadaki kayıtlı çeviriler (istek yapılmaz) |

Üç çeviri yolu da aynı `wv:translate` isteğinden ve `lib/translator.js`'ten geçer; sağlayıcı ayarı tek yerdir.

**DeepL** (`providers/deepl.js`; adresler ve başlık 2026-10-13'te DeepL'in belgelerinden doğrulandı):

- Anahtar `:fx` ile bitiyorsa `https://api-free.deepl.com`, bitmiyorsa `https://api.deepl.com` kullanılır.
- Anahtar yalnızca `Authorization: DeepL-Auth-Key <anahtar>` başlığında gider; adrese ya da gövdeye yazılmaz.
- Çeviri: `POST /v2/translate`. "Anahtarı test et": `GET /v2/usage` (hiçbir şey çevirmez; dönemin
  kullanılan/toplam karakterini gösterir).
- Dil kodları DeepL'inkilere çevrilir: hedefte `en` → `EN-US`, `pt` → `PT-PT`, `pt-BR` → `PT-BR`,
  `zh-CN` → `ZH-HANS`, `zh-TW` → `ZH-HANT`, `no` → `NB`; kaynakta bölge atılır (`EN`, `PT`, `ZH`).
- Hata kodları: 403 → anahtar kabul edilmedi, 456 → kota doldu, 429/529 → çok fazla istek.
- ASSUMPTION: dil listesi DeepL'in yıllardır sunduğu 35 dildir. Belgelerinde artık çok daha fazlası
  listeleniyor; anahtarsız denenemedikleri için eklenmediler.

**Anahtar** ayarlarla birlikte yalnızca `chrome.storage.local` içinde durur (`settings.providerConfig.deepl.apiKey`).
Yedeğe / JSON dışa aktarmaya, senkronizasyona, geri bildirime ve hata günlüğüne girmez
(`tests/providers.test.js` bunu denetler; hata günlüğü ayrıca anahtara benzeyen her metni siler).
DeepL'in adresi için izin kurulumda istenmez: "Anahtarı test et"e basıldığında, yalnızca o anahtarın
kullanıldığı adres için istenir.

**Sessizce servis değiştirilmez.** DeepL seçiliyken bir hata olursa (anahtar yok ya da geçersiz, kota
dolu, ağ hatası, DeepL'in desteklemediği hedef dil) baloncuk hatayı DeepL'in adıyla söyler ve
"MyMemory ile devam et" düğmesini sunar. Düğme yalnızca o çeviriyi MyMemory ile yapar; ayar değişmez.
Her sonucun altında hangi servisle çevrildiği yazar. Hedef dil DeepL'de yoksa ayarlar sayfası da uyarır.

**Çeviri önbelleği** (`lib/translation-cache.js`): başarılı çeviriler 7 gün, en fazla 300 kayıt olarak
`storage.local` içinde tutulur; aynı metin yeniden sorulmaz (kotayı da harcamaz). Anahtar sağlayıcıyı,
dil çiftini ve metni içerir; iki servisin yanıtları karışmaz. Yedeğe ve senkronizasyona girmez.

### Hedef ve kaynak dil

Hedef dil tek bir yerde durur: `chrome.storage.local` içindeki `settings.targetLang`. Çeviri penceresi,
ayarlar sayfası ve eklentinin geri kalanı bu değeri `lib/translator.js` üzerinden okur ve yazar; başka
kopyası yoktur. Kullanıcı bir dil seçene kadar tarayıcının arayüz dili kullanılır ve çeviri penceresi
bunu onaylamasını ya da değiştirmesini ister.

Kaynak dil varsayılan olarak algılanır. Kullanıcı pencereden bir dil seçerse algılama hiç çalışmaz;
"Bu sitede hep bu dili kullan" işaretlenirse seçim o site için saklanır (`siteSourceLangs`).

### Kasa

Kaydedilen her kelime `chrome.storage.local` içinde kendi anahtarıyla durur: `vault:<kaynak>|<hedef>|<kelime>`
(bkz. `lib/vault.js`). Kayıtta çeviri, diğer karşılıklar, kelimenin geçtiği cümle, sayfanın adresi ve
başlığı bulunur. Çeviri servisi yanıt vermese bile kelime çevirisiz kaydedilebilir. Kasadaki kayıtlar
yalnızca kullanıcı çıkarınca silinir.

Kelime kaydedilince arka plan betiği Wiktionary'den kelime türlerini, tanımları ve örnek cümleleri
alıp kayda ekler (`lib/dictionary.js`); o an alınamazsa kelime kasada açıldığında yeniden dener.
Wiktionary'nin tanım servisi yalnızca İngilizce Wiktionary'de bulunduğu için tanımlar İngilizcedir.

Dışa aktarma kasayı tek bir JSON dosyası olarak indirir. İçe aktarma ayarlar sayfasından yapılır
(araç çubuğu penceresi dosya seçici açılınca kapandığı için oradaki düğme bu sayfayı açar) ve var olan
kelimelerin üzerine yazmaz.

Kasayı arka plan betiğinin konsolundan görmek için:

```js
chrome.storage.local.get(null).then((all) => console.table(Object.entries(all).filter(([k]) => k.startsWith('vault:')).map(([, v]) => v)))
```

### Flash card (quiz)

Arka plan betiği her an durdurulabildiği için zamanlayıcının hiçbir şeyi bellekte durmaz:

- Sıradaki quiz'in zamanı `chrome.storage.local` içinde `quizState.sonrakiQuizZamani` olarak saklanır;
  yanında o planın hangi sıklıkla yapıldığı durur (`planInterval`). Karar veren bu kayıttır, alarm
  yalnızca uyandırır: planlanan zamandan önce çalan bir alarm quiz göstermez, doğru alarmı kurar.
- Uyandırma `chrome.alarms` ile yapılır. Arka plan betiği her başladığında (kurulum, tarayıcı açılışı,
  herhangi bir uyanış) alarmın plana uyup uymadığına bakar ve gerekirse yeniden kurar. Zamanı geçmiş
  bir quiz bir sonraki uygun anda, bir kez gösterilir.
- Alarm tekrarlıdır (`periodInMinutes` = sıklık). Her quizden sonra bir sonraki plana göre yeniden
  kurulur; tekrar yalnızca güvenlik ağıdır: arka plan betiği bir alarmı işlerken durdurulursa
  zamanlayıcı susmaz, bir sıklık sonra kaldığı yerden devam eder.
- Ayar değişince zamanlayıcı hemen yeniden kurulur: sıklık değiştiyse yeni sıklık o andan itibaren
  sayılır, quiz kapatıldıysa plan da alarm da silinir.
- Zamanı gelince önce öndeki tarayıcı penceresine ve aktif sekmesine bakılır. Tarayıcı önde değilse,
  sekme ses çalıyorsa ya da sayfa "şu an uygun değil" derse (video oynuyor, tam ekran, yazı yazılıyor,
  çeviri penceresi açık) quiz hiçbir yolla gösterilmez; atlanmaz, 3 dakika sonra (sıklık daha kısaysa
  o kadar sonra) yeniden denenir.
- Quiz'i ekrana getiren tek yol `quiz/scheduler.js` içindeki `showQuiz()` fonksiyonudur. Zamanlayıcı da
  **Şimdi test et** de onu çağırır; test yalnızca zamanlayıcıyı ve koşulları (anahtar, kelime sayısı,
  vade, "Bugün sorma", sayfanın durumu) atlar ve zamanlayıcının planına ve kayıtlarına dokunmaz.
- Aynı anda tek quiz olur: ekranda bir quiz varken zamanı gelen quiz bekler.

#### Quiz nasıl gösterilir

`quiz/display.js` dört yolu sırayla dener; biri çalışmazsa sıradakine düşer ve neden çalışmadığı
kaydedilir:

| | Yol | Nasıl | Ne zaman çalışmaz |
| --- | --- | --- | --- |
| A | Eklenti açılır penceresi | `action.openPopup()`; araç çubuğu düğmesi o açılış için `quiz/quiz.html` sayfasını gösterir, sonra yeniden kasaya döner | Tarayıcı kendiliğinden açmaya izin vermiyorsa (149'dan eski Firefox kullanıcı hareketi ister), tarayıcı penceresi önde değilse |
| B | Ayrı pencere | `windows.create({ type: 'popup' })`, 360×480, kullanıcının bulunduğu tarayıcı penceresinin sağ üstünde | Tarayıcı pencere açamıyorsa |
| C | Sayfa içi kart | Aktif sekmeye mesaj; kart sayfanın sağ üstünde, kapalı bir Shadow DOM içinde | Sayfada eklenti betiği çalışmıyorsa (tarayıcı sayfaları, yeni sekme, eklenti mağazası, Chrome'da eklentiden önce açılmış sekmeler) |
| D | Sistem bildirimi | `notifications.create()`; bildirime tıklanınca quiz ayrı pencerede açılır | Bildirim izni verilmemişse (isteğe bağlı izin) |

**Quiz nasıl görünsün** ayarı (`quizDisplay`): Otomatik (A, B, C, D sırası), Eklenti açılır penceresi,
Ayrı pencere, Sayfa içi kart. Seçilen yol başa alınır, diğerleri otomatik sırayla arkasından gelir;
bildirim her zaman son çaredir.

Bir açılır pencerenin ya da pencerenin gerçekten açıldığı, sayfasının arka plandan sorusunu istemesiyle
anlaşılır (`wv:quiz:claim`). 2,5 saniye içinde istemezse o yol "açılmadı" sayılır ve sıradaki denenir;
geç kalan sayfaya quiz verilmez.

Tarayıcılarda denenip görülenler (Chromium 141, Firefox 157, Zen 1.23; macOS):

- `action.openPopup()` zamanlayıcıdan, kullanıcı hareketi olmadan çalışıyor (Chrome 127+, Firefox 149+).
  Açılır pencere klavye odağını alır ve kullanıcı başka bir yere tıkladığında kapanır.
- `windows.create` içinde `focused: false` işe yaramıyor: Firefox bu değeri yok sayıyor (pencere odağı
  yine alıyor), Chrome macOS'te pencereyi tarayıcı penceresinin *arkasında* açıyor, yani görünmüyor.
  Bu yüzden quiz penceresi odaklı açılır. Chrome ekranın dışına taşan konumu reddediyor; o durumda
  pencere konumsuz açılır.
- Sayfa içi kart odağı almaz; bunu isteyen "Sayfa içi kart"ı seçer.
- Kapanan bir açılır pencere ya da pencere Chrome'da son mesajını gönderemiyor. Bu yüzden quiz'i
  gösteren her yer arka plan betiğine açık bir bağlantı tutar (`WV.stayConnected`); bağlantı koparsa
  (odak kaybı, pencerenin ya da sekmenin kapanması) açık kalan soru "kapatıldı" sayılır.

#### Seri mod ve "Bugün sorma"

**Quiz geldiğinde soru sayısı** (`quizQuestionsPerQuiz`: 1, 3, 5, 10; varsayılan 1) birden büyükse
cevaptan sonra aynı yerde sıradaki soru gelir ve sonda kısa bir özet gösterilir ("3/5 doğru"). Bir
quiz aynı kelimeyi iki kez sormaz; sorulacak başka kelime kalmazsa erken biter. "Sonra sor" yalnızca
o soruyu geçer; zaman aşımı ve kapatma quiz'in tamamını bitirir (özet gösterilmez).

Quiz'de her zaman **Kapat** ve **Bugün sorma** düğmeleri vardır. "Bugün sorma" ekrandaki quiz'i kapatır
ve yerel saatle gece yarısına kadar yenisini göstermez (`quizState.mutedUntil`); tanı panelindeki
**Bugün yine sor** düğmesi ya da quiz'i kapatıp açmak bunu geri alır. "Şimdi test et" bundan etkilenmez.

Ekrandaki quiz `chrome.storage.local` içinde `quizSession` olarak durur (sorulan kelimeler, doğru
sayısı, hangi yolla gösterildiği); arka plan betiği iki soru arasında durdurulsa da quiz sürer.

Ayarlar sayfasındaki **Flash card** bölümü:

| Ayar | Anahtar | Varsayılan |
| --- | --- | --- |
| Flash card sor (ana anahtar) | `quizEnabled` | açık |
| Soru sıklığı: 5, 10, 15, 20, 30 dakika, 1, 2, 4 saat ya da özel süre (1–1440 dakika) | `quizIntervalMinutes` | 20 dakika |
| Quiz geldiğinde soru sayısı: 1, 3, 5, 10 | `quizQuestionsPerQuiz` | 1 |
| Quiz nasıl görünsün: Otomatik, Eklenti açılır penceresi, Ayrı pencere, Sayfa içi kart | `quizDisplay` | Otomatik |
| Son çare: sistem bildirimi (izin ver / geri al / dene) | tarayıcının `notifications` izni | izin yok |
| Vadesi gelmemiş kelimeleri de sor | `quizAllowNotDue` | açık |
| Başlamak için gereken kelime | `quizMinCards` | 10 |
| Cevap süresi (5–300 saniye) | `quizTimeoutSeconds` | 30 saniye |

Eklenti geliştirme için yüklendiğinde (`about:debugging` ya da "Load unpacked") sıklık listesinde
**Dakikada bir (deneme için)** seçeneği de çıkar; zamanlayıcıyı beklemeden izlemek içindir.

**Neden quiz çıkmıyor?** paneli gerçek zamanlayıcının durumunu gösterir ("Şimdi test et" buraya iz
bırakmaz): quiz açık mı, kasada kaç kelime var, kaçı sorulabilir, kaçının vadesi gelmiş, sıklık,
gösterme yollarının sırası, sıradaki quiz'in zamanı, alarmın kurulu olup olmadığı, son quiz'in ne zaman
ve hangi yolla gösterildiği (ondan önce denenip olmayan yollar nedenleriyle birlikte), son atlanan quiz
ve nedeni (`quizState.lastShown`, `lastSkip`), son sorunun nasıl bittiği. "Şimdi test et"in altındaki
satır, testin hangi yolla gösterildiğini yazar.

Quiz için kasada en az 10 kelime (ayarlanır) ve hedef dilde en az 4 farklı anlam gerekir.

#### Zamanlayıcıyı denemek

1. Kasada en az 10 kelime olsun. Ayarlar → **Flash card** → **Soru sıklığı** → **Dakikada bir (deneme
   için)**. Panelde "Sıradaki quiz" bir dakika sonrasını, "Zamanlayıcı (alarm)" aynı saati göstermeli.
2. Tarayıcı önde olsun, bir şeye dokunmadan bekle. Bir dakika sonra quiz kendiliğinden çıkar
   (Otomatik ayarda araç çubuğundaki eklenti düğmesinin altında); cevapla. Bir dakika sonra başka bir
   kelimeyle yeniden çıkar. Üç kez üst üste izle: her seferinde farklı bir kelime sorulmalı.
3. Arka plan betiğinin konsolunda (Chrome: `chrome://extensions` → Wordvault → **Service worker**;
   Firefox: `about:debugging` → Bu Firefox → Wordvault → **İncele**) zamanlayıcının durumu:

```js
chrome.storage.local.get('quizState').then(({ quizState: s }) => console.log({ sıradaki: new Date(s.sonrakiQuizZamani).toLocaleTimeString(), sonGösterilen: s.lastShown && new Date(s.lastShown.at).toLocaleTimeString(), yol: s.lastShown?.method, olmayanYollar: s.lastShown?.tried, sonAtlanan: s.lastSkip, sonSorulanlar: s.recent.map((id) => id.split('|')[2]) }))
chrome.alarms.getAll().then((alarms) => console.table(alarms.map((a) => ({ ad: a.name, zaman: new Date(a.scheduledTime).toLocaleTimeString(), tekrarDakika: a.periodInMinutes }))))
```

   `sonSorulanlar` her quizden sonra bir kelime uzar ve aynı kelime art arda görünmez; alarmın zamanı
   her quizden sonra bir dakika ileri gider.

#### Quiz arayüzü

Quiz tek bir bileşendir (`shared/quiz-card.js`): sayfa içi kart onu kapalı bir Shadow DOM içine,
açılır pencere ve ayrı pencere `quiz/quiz.html` sayfasına çizer. Bir soru şu beş yoldan biriyle biter;
arka plan betiğine tek bir sonuç gider (`wv:quiz:answer`) ve cevabı sırada ne olduğunu söyler
(sıradaki soru, özet ya da hiçbiri):

| Sonuç | Ne zaman | Kelimeye etkisi |
| --- | --- | --- |
| `answer` | Bir şık seçildi | Doğru ya da yanlış olarak, süresiyle birlikte işlenir |
| `unknown` | "Bilmiyorum" | Yanlış sayılır; doğru cevap gösterilir |
| `later` | "Sonra sor" | Sayılmaz; kelime 10 dakika sonra yeniden sorulur |
| `timeout` | Süresinde cevaplanmadı (varsayılan 30 sn, `quizTimeoutSeconds`) | Sayılmaz ("atlandı"); aynı |
| `closed` | "Kapat", "Bugün sorma" ya da quiz'i gösteren yerin kapanması | Sayılmaz; aynı |

Cevaptan sonra sonuç 2 saniye (yanlışta ve "Bilmiyorum"da doğru şık işaretli olarak 3,5 saniye) ekranda
kalır, sonra kart kendiliğinden kapanır.

**Cevap süresi** şıklar ekrana çizildiği andan tıklamaya kadar ölçülür ve yalnızca sayfa kullanıcının
önündeyken işler: sekme gizliyken ya da pencere odakta değilken geçen süre sayılmaz
(`shared/stopwatch.js`; `visibilitychange`, `blur`, `focus`). Zaman aşımı ise gerçek zamanla işler:
bakılmayan kart arka plandaki sekmede beklemez, süresi dolunca kapanır. Kalan süre kartın alt
kenarındaki çubukta görünür.

Ayarlar sayfasındaki tanı panelinde **Son soru** satırı en son sorunun nasıl bittiğini gösterir.

#### Öğrenme algoritması

`quiz/learning.js` saf fonksiyonlardan oluşur (depoya ve saate dokunmaz) ve davranışı belirleyen bütün
sayılar dosyanın başındaki `TUNING` nesnesindedir. Temeli SM-2'dir; farkı, cevabın kalitesini
kullanıcıya sormak yerine doğruluk ve hızdan çıkarmasıdır:

| Kalite | Cevap | Sonuç |
| --- | --- | --- |
| 0 | "Bilmiyorum" | Öğrenmeye geri döner, 10 dakika sonra yeniden sorulur |
| 1 | Yanlış | Aynı |
| 2 | Doğru ama beklenenin 3 katından yavaş (tereddüt ya da tahmin) | Aynı; doğru sayılır ama aralık sıfırlanır |
| 3 | Doğru, yavaş (1,6 katından uzun) | Sonraki aralığın 0,6 katı |
| 4 | Doğru | Sonraki aralık |
| 5 | Doğru, hızlı (0,6 katından kısa) | Sonraki aralığın 1,4 katı |

- **Aralıklar:** ilk doğru cevaplarda 10 dakika → 1 gün → 3 gün → 7 gün; sonrasında önceki aralık ×
  kolaylık katsayısı (2,5 ile başlar, 1,3–3 arasında kalır; SM-2'deki gibi her cevapla değişir).
- **Beklenen süre** kullanıcının kendi temposudur: son 25 doğru cevabın ortancası (5 cevap birikene kadar
  4 saniye). Şıklar uzunsa okuma payı eklenir. Tempo cihazda kalır (`quizState.speed`), eşitlenmez.
- **"Sonra sor"**, zaman aşımı ve kartın kapatılması kelimeye bir şey yazmaz; kelime 10 dakika sonra
  yeniden gelir.
- **Zorluk** (0–1): hata oranı, kaybedilen kolaylık ve yavaşlıktan hesaplanır.
- **Durum:** `yeni` (hiç cevaplanmadı), `öğreniliyor`, `öğrenildi` (aralık 7 güne ulaştı), `zor` (en az 4
  cevaptan sonra zorluk hâlâ ≥ 0,6 ise ya da kelime 3 kez yanlış cevaplandıysa).

Kelimenin geçmişi bir özet olarak kelimeyle birlikte durur (kasa kaydının `quiz` alanı); cevapların
dökümü tutulmaz, yani kayıt kullandıkça büyümez:

`a` cevap sayısı, `k` doğru sayısı, `s` art arda doğru, `e` kolaylık katsayısı, `i` şimdiki aralık
(dakika), `l` yanlış sayısı, `m` ortalama cevap süresi (ms), `d` zorluk, `x` en son cevaplandığı an
(ertelenen ya da cevapsız kalan soru sayılmaz). Sonraki tekrar zamanı kaydın `dueAt`, kademesi `box`
alanındadır.

#### Soru seçimi ve şıklar

- Hiç sorulmamış kelimeler hemen sorulabilir. Zamanı gelmiş kelimeler arasından ağırlıklı rastgele
  seçilir (`quiz/selection.js`): ağırlık = (1 + 1,5 × gecikme) × (1 + 4 × zorluk). Gecikme, kelimenin
  kendi aralığı cinsinden ölçülür ve en çok 2 sayılır.
- Son üç soruda sorulan kelime seçilmez; kelime azsa bu gevşer ama aynı kelime hiçbir zaman art arda
  sorulmaz.
- **Kasa sırayla döner.** Sorular turlar halinde gider: bir turda cevaplanan kelime, vadesi yeniden
  gelse bile, diğer kelimelere sıra gelene kadar bekler. Tek istisna son cevabı yanlış ya da
  tereddütlü olan kelimedir; o, tur bitmeden (10 dakika ve birkaç soru sonra) geri gelir. Zor
  kelimelerin daha sık sorulması böyle olur. Her kelimeye sıra geldiğinde yeni tur başlar
  (`quizState.roundStartedAt`). "Sonra sor", zaman aşımı ve kartın kapatılması kelimenin sırasını
  harcamaz.
- Zamanı gelmiş kelime yoksa en zor kelime, eşitlikte en uzun süredir sorulmayan sorulur
  (`quizAllowNotDue`, varsayılan açık; kapalıysa quiz çıkmaz).
- Yanlış şıklar (`quiz/question.js`) kasadaki diğer çevirilerden seçilir: doğru cevap, kelimenin diğer
  karşılıkları, aynı kelimenin başka dil çiftindeki kaydı ve doğru cevaba ya da birbirine fazla benzeyen
  yazımlar elenir; aynı kelime türünden ve benzer uzunluktakiler öne alınır.

Bir kelimenin durumunu arka plan betiğinin konsolundan görmek için:

```js
chrome.storage.local.get(null).then((all) => console.table(Object.entries(all).filter(([k]) => k.startsWith('vault:')).map(([, v]) => ({ kelime: v.text, sonraki: v.dueAt ? new Date(v.dueAt).toLocaleString() : '-', ...v.quiz }))))
```

### Senkronizasyonun veri modeli

Cihazlar arasında dolaşan şey tek bir belgedir (`sync/model.js`):

```json
{ "v": 1, "e": { "en|tr|book": { "w": "book", "t": "kitap", "sl": "en", "tl": "tr", "c": "A good book.", "b": 2, "n": 1791700000000, "q": { "a": 5, "k": 4, "s": 3, "e": 2.4, "i": 4320, "l": 1, "m": 2100, "d": 0.22, "x": 1791440800000 }, "u": 1791682256926, "r": 3 },
                 "en|tr|door": { "d": 1791690000000, "r": 2 } } }
```

`w` kelime, `t` çeviri, `sl`/`tl` dil çifti, `c` kısa bağlam cümlesi (en çok 160 karakter), `b` Leitner
kutusu, `n` sonraki tekrar, `q` quiz istatistikleri (yukarıdaki özet; cevap dökümü yok), `u` son
değişiklik zamanı, `r` sürüm sayacı. Silinen kelimenin yerinde `{ d, r }` biçiminde bir silme kaydı
kalır; 90 gün sonra bir sonraki eşitlemede temizlenir. Boş değerler yazılmaz. Belgeye **girmeyenler**:
sayfa adresleri ve başlıkları, diğer karşılıklar, sözlük verisi, ayarlar, API anahtarları, oturum
bilgileri, quiz'in zamanlayıcı durumu ve cevap temposu.

Birleştirme (`sync/merge.js`) her kelime için iki sürümden yenisini alır. "Yeni"nin sırası: büyük `r`,
sonra geç zaman, sonra silme kaydı, en son içeriğin sabit sıralı JSON metni. Bu bir tam sıralama olduğu
için birleştirme değişmeli, birleşmeli ve tekrar uygulanabilirdir; cihazlar hangi sırayla, kaç kez
eşitlerse eşitlesin aynı belgeye varır.

`r` kelime başına bir Lamport sayacıdır: bir cihaz n. sürümü gördükten sonra yaptığı her değişikliği
(düzeltme, silme, yeniden ekleme) n+1 olarak yazar. Böylece başka bir değişikliği bilerek yapılan
değişiklik, cihazların saati ne derse desin onu yener. Saat yalnızca birbirinden habersiz yapılmış
(aynı `r`) değişiklikler arasında karar verir. Yalnızca saate bakılsaydı saati ileride olan bir cihaz
bütün çakışmaları kazanır, saati geride olan bir cihazın sildiği kelime geri gelirdi.

Belgenin `v` alanı biçim sürümüdür. Daha yeni bir sürümle yazılmış belge bütünüyle reddedilir (üzerine
yazılmaz); aynı sürümde tanınmayan alanlar kayıtla birlikte korunur.

### Senkronizasyon

Ayarlar → **Senkronizasyon ve yedekleme** bölümünde, JSON dışa/içe aktarmanın altında dört yol vardır:

| Yol | Veri nereye gider | Durum |
| --- | --- | --- |
| Sadece bu cihaz (varsayılan) | Hiçbir yere | Hazır |
| Tarayıcı senkronu | Tarayıcının kendi senkron deposuna (`chrome.storage.sync`); Firefox Sync ya da Chrome senkronu taşır | Hazır |
| Bulut hesabı bağla | Google Drive, OneDrive ya da Dropbox'ta uygulamaya özel klasördeki tek dosyaya | Hazır. Kartlar her zaman görünür; client ID girilene kadar "Yapılandırma eksik" der ve "Bağlan" neyin eksik olduğunu söyler (`SETUP-OAUTH.md`) |
| Kendi sunucum | Kullanıcının girdiği WebDAV ya da HTTP adresine | Hazır; kurulum gerektirmez (`docs/self-hosted.md`) |

Bir yol seçmek tek başına hiçbir şey göndermez: önce neyin nereye gideceğini söyleyen onay metni
gösterilir, istek ancak **Devam et**'ten sonra yapılır. Bağlıyken bölümde bağlı olunan yer, dosyanın
nerede olduğu, son başarılı eşitleme, durum (güncel / eşitleniyor / bekliyor / durdu ve nedeni),
**Şimdi eşitle** ve **Bağlantıyı kes** görünür. Bağlantıyı keserken "buluttaki dosyayı da sil" sorulur
(varsayılan: silme); yerel kasa her durumda olduğu gibi kalır.

**Eşitleme motoru** (`sync/engine.js`) arka plan betiğinde çalışır: uzak kopyayı okur, yerel kasayla
birleştirir, sonuç uzaktakinden farklıysa yazar, sonra yerel kasayı sonuca uydurur. Tetikleyiciler:
kasa değişince 10 saniyelik bekleme, tarayıcı açılışı, 15 dakikada bir alarm, **Şimdi eşitle**. Aynı
anda tek eşitleme çalışır. Yazarken uzak kopya değişmişse yeniden okur, birleştirir, yazar (en fazla 5
deneme, üstel bekleme). Hatalar üçe ayrılır: ulaşılamadı (sessizce 1, 2, 4 … dakika sonra yeniden
dener), yetki bitti ("yeniden bağlan" der, kendiliğinden denemez), yer kalmadı (bildirir, yerelde devam
eder). Okunamayan ya da Wordvault'a ait olmayan uzak dosyanın üzerine asla yazılmaz. Hiçbir hata yerel
kasayı silmez ya da bozmaz. Ayar ve durum yalnızca `chrome.storage.local` içindedir (`syncConfig`,
`syncStatus`); oturum bilgileri oradan hiçbir yere gitmez.

**Tarayıcı senkronu** yaklaşık 100 KB'lık bir depodur. Belge gzip'lenip base64'e çevrilir ve 7000
karakterlik parçalara bölünür: `wv_meta` (`{ v, n, rev, at }`) ve `wv_0 … wv_<n-1>`. Bir sürümün bütün
parçaları tek çağrıda yazılır, kısalan sürümün artan parçaları silinir. Doluluk bölümde gösterilir,
%80'de uyarılır; sığmayan sürüm hiç yazılmaz, senkron durur ve kasa bu cihazda eksiksiz kalır.

**Google Drive** (`sync/providers/gdrive.js`): belge, Drive'ın gizli uygulama verisi klasöründe
(`appDataFolder`) `wordvault-vault.json.gz` adlı tek dosyadır; istenen tek izin `drive.appdata`'dır,
kullanıcının dosyaları görülmez. Kullanıcı dosyayı Drive'da Ayarlar → Uygulamaları yönet → Wordvault
altından görüp silebilir. Bağlanınca dosya aranır: yoksa yerel kasadan oluşturulur, varsa indirilip
kasayla birleştirilir. İki cihaz aynı anda ilk kez bağlanıp iki dosya oluşturduysa bir sonraki eşitleme
ikisini de okur, birleştirir, eskisini tutar ve diğerini birleşmiş dosya yazıldıktan sonra siler.
Oturum açma `identity.launchWebAuthFlow` ile yapılır; pakette client secret yoktur. Google, eklentiye
yönlendirebilen tek istemci türünde PKCE ile bile secret istediği için örtük akış kullanılır: erişim
token'ı yaklaşık bir saat geçerlidir ve kullanıcı Google'da oturumu açık tuttuğu sürece sessizce
yenilenir; yenilenemezse bölüm "yeniden bağlan" der. Token'lar yalnızca `storage.local` içindedir.

**OneDrive** (`sync/providers/onedrive.js`): dosya `Uygulamalar/Wordvault` klasöründedir (Graph'ta
`approot`); izinler `Files.ReadWrite.AppFolder` ve `offline_access`. Oturum açma PKCE ile, secret'sız.
Yazma koşulludur (`If-Match` ile `eTag`; ilk yazmada `conflictBehavior=fail`). Microsoft'un secret'sız
tarayıcı istemcilerine verdiği yenileme token'ı 24 saat yaşar; dolunca oturum sessizce yinelenir,
olmazsa "yeniden bağlan" denir.

**Dropbox** (`sync/providers/dropbox.js`): dosya `Uygulamalar/<uygulama adı>` klasöründedir ("App
folder" erişimi); izinler `files.content.read` ve `files.content.write`. Oturum açma PKCE ile,
secret'sız; yenileme token'ının süresi dolmaz. Yazma koşulludur (dosya yoksa `add`, varsa okunan `rev`
ile `update`).

**Kendi sunucum** iki türdür (`docs/self-hosted.md`). *WebDAV* (Nextcloud, ownCloud …): klasör adresi,
kullanıcı adı ve uygulama parolası; `PROPFIND` ile bağlanır (klasör yoksa `MKCOL`), `GET`/`PUT` ile okur
yazar, yazma `If-Match` (dosya yokken `If-None-Match: *`) ile koşulludur. *Basit HTTP uç noktası*: adres
ve anahtar; `GET /vault` (200 + gövde + `ETag`, yoksa 404) ve `PUT /vault` (`If-Match` ile, çakışmada
412). Depodaki `tools/self-hosted-server.js` bu protokolü uygulayan tek dosyalık bir Node sunucusudur.
Yalnızca `https` adres kabul edilir (`localhost` ve `127.0.0.1` hariç); adres içine yazılmış parola
reddedilir. Tarayıcıdan o adres için izin bağlanırken istenir. Kimlik bilgileri yalnızca
`storage.local` içindedir. Bağlantı kurulamazsa form, yazılanlarla ve nedeniyle birlikte geri gelir.

Bulut sağlayıcılarında da hesap dışına hiçbir şey gitmez: istekler tarayıcıdan doğrudan sağlayıcıya yapılır.
Google API Services User Data Policy (Limited Use), Microsoft API Terms of Use ve Dropbox Developer
Terms'e göre veri yalnızca kullanıcının istediği eşitleme için kullanılır, başka yere aktarılmaz.

**Şifreleme (isteğe bağlı, bütün yollar için)** (`sync/crypto.js`): bağlıyken bölümden açılır.
Dosya gzip'lendikten sonra, kullanıcının parolasından PBKDF2-HMAC-SHA-256 (600 000 tur) ile türetilen
256 bitlik anahtarla AES-GCM ile şifrelenir. Zarf: `WVE1` | tur sayısı (4 bayt) | tuz (16) | nonce (12)
| şifreli metin + etiket; nonce her yazmada yenidir, başlık şifreli metinle birlikte doğrulanır. Tuz
dosyaya aittir: ikinci cihaz yalnızca parolayı sorar ve aynı anahtara varır. Parola hiçbir yerde
saklanmaz; türetilen anahtar oturum boyunca bellekte (`chrome.storage.session`), kullanıcı "Bu cihazda
hatırla" derse `storage.local` içinde durur. Anahtar yokken ya da parola yanlışken dosya okunamaz ve
**üzerine yazılmaz**: bölüm parolayı sorar. Parola kaybolursa uzaktaki kopya kurtarılamaz (bölüm bunu
açmadan önce söyler); cihazdaki kasa şifrelenmez ve etkilenmez. Kapatılırken dosya yeniden şifresiz
yazılır ve anahtar unutulur; bütün cihazlarda kapatılmalıdır, açık kalan cihaz dosyayı yeniden şifreler.

**iCloud sunulmuyor.** Apple'ın web için verdiği tek yol CloudKit JS'tir ve uygulamanın kendi CloudKit
kapsayıcısına erişir (Apple Developer Program üyeliği, Xcode ile oluşturulmuş kapsayıcı, CloudKit
Dashboard'dan API anahtarı gerekir); kullanıcının iCloud Drive'ına erişim vermez. Bunun yerine bölümde
"JSON'u dışa aktarıp iCloud Drive klasörüne kaydedebilirsin" notu durur.

### Telaffuz

Kelimeler normalde tarayıcının kendi sesiyle (`speechSynthesis`, yalnızca cihazdaki sesler) okunur.

**Firefox tabanlı tarayıcılarda (Firefox, Zen …) macOS'te** bu yol kullanılmaz: Gecko orada her okumanın
sonunda, son duyulan sesten yaklaşık 200 ms sonra tam ölçekli bir çıtlama üretir. Gecko 157 / macOS 27
üzerinde sistemin ses çıkışı kaydedilerek ölçüldü: eklenti olmadan düz bir sayfada da, her seste, her ses
seviyesinde (0 dahil), her hız ve perdede oluyor; Chromium'da ve macOS'in `say` komutunda olmuyor. Web
Speech API'de bunu değiştiren bir ayar yok. Bu tarayıcılarda kelime, Wiktionary sayfasındaki ses kaydından
(Wikimedia Commons) okunur ve Web Audio ile, 50 ms'lik sönümle çalınır. Kaydı olmayan kelimede düğme
"Bu kelimenin ses kaydı yok" der; ayarlar sayfasındaki anahtarla bu durumda tarayıcının sesi (çıtlamasıyla
birlikte) kullanılabilir. Çalınan kaydın Commons sayfasına (yazar ve lisans orada) pencerenin altından
bağlantı verilir.

### Çeviride kaybolan harfler

Çeviri servisi bazen bir kelimeyi harfleri kendi tarafında bozulmuş olarak gönderir: MyMemory'nin
makine çevirisi `sync` için `e? itle` döndürür (`ş` yerine `?`), aynı kelime `Sync` yazılınca ya da dil
çiftiyle sorulunca doğru gelir. Zincirin bizim tarafında (yanıtın okunması, mesajlaşma, kasa, yedek
dosyası, eşitleme belgesi) karakter kaybı yoktur; `tests/characters.test.js` bunu Türkçe ve bir düzine
başka yazı sistemiyle doğrular. Bozuk yanıt `lib/text-damage.js` ile fark edilir (kelime içinde `?`,
`U+FFFD`, `ÅŸ` gibi yanlış çözülmüş UTF-8); sağlayıcı o zaman temiz olan diğer yanıtı kullanır, o da
bozuksa kelimeyi ilk harfi diğer büyüklükte yeniden sorar. Temiz yanıt alınamazsa çeviri penceresi bunu
bir notla söyler. Kasadaki eski kayıtlar değiştirilmez; kasa penceresi "N kayıtlı çeviride harf
kaybolmuş görünüyor" diye haber verir ve yalnızca onları listeleyebilir. Çeviri önbelleği olmadığı için
temizlenecek bozuk önbellek yoktur.

### Yeni çeviri sağlayıcısı eklemek

`src/providers/` altına `TranslationProvider` arayüzünü (bkz. `providers/index.js`) uygulayan bir modül
ekle ve aynı dosyadaki kayıt listesine yaz. Sağlayıcının sunucusu CORS başlığı göndermiyorsa adresini
iki manifestteki `host_permissions` listesine de ekle.

## İzinler

| İzin | Neden gerekli |
| --- | --- |
| `storage` | Ayarları ve kasayı (ileride çeviri önbelleğini) `chrome.storage.local` içinde, yalnızca bu tarayıcıda saklamak için. |
| `alarms` | Quiz'in zamanlayıcısı için. Arka plan betiği uyurken zamanı gelince onu uyandırır. |
| `activeTab` | Ekrandan metin tarama için: kullanıcı kısayola bastığında ya da menüden seçtiğinde, yalnızca o sekmenin ekran görüntüsünü almak (`tabs.captureVisibleTab`). Sürekli bir izin değildir; kullanıcı taramayı başlatmadıkça hiçbir sekmenin görüntüsü alınamaz. |
| `offscreen` (yalnızca Chrome) | Metin tanımayı (WebAssembly, Worker) çalıştıracak görünmez bir eklenti sayfası açmak için: Chrome'un service worker'ı Worker başlatamaz. Firefox'ta arka plan sayfası bu işi kendi yapar, izin orada yoktur. |
| `scripting` (yalnızca Chrome) | Kullanıcı taramayı, eklenti yüklenmeden önce açılmış bir sekmede başlatırsa içerik betiklerini o sekmeye eklemek için (Chrome bunu kendiliğinden yapmaz). Yalnızca `activeTab` ile, yani kullanıcının taramayı başlattığı sekmede çalışır. |
| `contextMenus` | Sağ tık menüsüne ve araç çubuğu simgesinin menüsüne "Ekrandan metin tara" maddesini eklemek için. Sayfa içeriğine erişim vermez. |
| `identity` | Bulut hesabına bağlanırken sağlayıcının oturum penceresini açmak (`identity.launchWebAuthFlow`) için. Tarayıcı hesabının e-postası istenmez (`identity.email` yok). |
| İsteğe bağlı adres izni: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Kurulumda verilmez. Bir bulut hesabı ya da kendi sunucun bağlanırken tarayıcı yalnızca o adres için sorar (Google Drive: `www.googleapis.com`, `oauth2.googleapis.com`; OneDrive: `graph.microsoft.com`, `login.microsoftonline.com`; Dropbox: `api.dropboxapi.com`, `content.dropboxapi.com`). Desen geniştir çünkü kullanıcının gireceği sunucu adresi önceden bilinemez; verilen izin yalnızca istenen adrestir. | Geri bildirim gönderilirken de aynı yol kullanılır: ilk gönderimde tarayıcı yalnızca geri bildirim alıcısının alan adı (`FEEDBACK_ENDPOINT`) için sorar; başka hiçbir adres istenmez. DeepL seçilirse `api-free.deepl.com` ya da `api.deepl.com` için de aynı yolla, "Anahtarı test et"e basıldığında sorulur.
| `notifications` (isteğe bağlı) | Kurulumda istenmez. Yalnızca ayarlardan **İzin ver**'e basılırsa tarayıcı sorar; quiz başka hiçbir yolla gösterilemediğinde bildirimle haber vermek için. Ayarlardan geri alınabilir. |
| `unlimitedStorage` | Kasa büyüdükçe `storage.local`'ın 10 MB sınırına takılmamak için. Kasadaki kelimeler asla otomatik silinmez. |
| İçerik betiği: `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*` (bütün çerçevelerde) | Altyazıda üzerine gelinen kelimeyi bulmak için. Yalnızca YouTube'da (gömülü oynatıcılar dahil) yüklenir; yeni bir izin değildir, `<all_urls>` betiğinin kapsamı içindedir ama altyazı kodu başka sitelere hiç eklenmez. Altyazı metni kaydedilmez ya da indirilmez. |
| İçerik betiği: `<all_urls>` (yalnızca üst çerçeve) | Tarama alanını seçtiren arayüz ve taranan metnin katmanı. Kullanıcı taramayı başlatana kadar hiçbir şey yapmaz, sayfadan hiçbir şey okumaz. |
| İçerik betiği: `<all_urls>` | Çift tıklama herhangi bir sayfada çalışmalı. Betik, kullanıcı bir kelimeye çift tıklayana kadar sayfadan hiçbir şey okumaz. |
| Sunucu izni: `https://api.mymemory.translated.net/*` | Varsayılan çeviri servisi. İstekler arka plan betiğinden gider. |
| Sunucu izni: `https://en.wiktionary.org/*` | Kasaya eklenen kelimenin türünü, tanımlarını ve örnek cümlelerini almak; Firefox/macOS'te kelimenin ses kaydını bulmak için. |
| Sunucu izni: `https://upload.wikimedia.org/*` | Firefox/macOS'te telaffuz için ses kaydını (Wikimedia Commons) indirmek için. |

Sekme açmak (`chrome.tabs.create`), ayarlar sayfasını açmak, eklenti açılır penceresini açmak
(`action.openPopup`) ve quiz penceresini açmak (`windows.create`) izin gerektirmez; `tabs` izni istenmez.
Klavye kısayolu (`commands`) bir izin değildir.

Manifestteki `content_security_policy` (`script-src 'self' 'wasm-unsafe-eval'`) eklenti sayfalarında
WebAssembly derlemeye izin verir; metin tanıma motoru (Tesseract'ın çekirdeği) WebAssembly'dir. Uzak kod
yüklenmez: motorun bütün dosyaları pakettedir (`src/vendor/tesseract`). `web-ext lint` bu dosyalar için üç
`DANGEROUS_EVAL` uyarısı verir: kütüphanenin içindeki `regenerator-runtime` yedek yolunda `Function`
kurucusu geçer; bu yol çalışmaz ve CSP zaten engeller. Dosyalar değiştirilmediği için uyarı kalır.

Chrome'daki `key` alanı bir izin değildir: yalnızca bir açık anahtardır ve geliştirici modunda yüklenen
eklentinin kimliğini sabitler (OAuth yönlendirme adresi kimlikten türer; bkz. `SETUP-OAUTH.md`).

Firefox manifestindeki `data_collection_permissions` beyanında geri bildirim için üç **isteğe bağlı**
tür vardır; kurulumda verilmez, ilk gönderimde tarayıcının kendi onay penceresi sorar ve yalnızca o
mesajın taşıdığı türler istenir: `personalCommunications` (kullanıcının yazdığı metin; her zaman),
`technicalAndInteraction` (teknik bilgi ya da hata kayıtları eklenmişse), `personallyIdentifyingInfo`
(e-posta yazılmışsa). Tür adları Mozilla'nın belgesinden alınmıştır
(extensionworkshop.com, "Firefox built-in consent for data collection and transmission"; `technicalAndInteraction`
yalnızca isteğe bağlı olabilir).

Aynı beyanın zorunlu kısmı `websiteContent` içerir. Eşitleme açılırsa
kasadaki kelimeler (web sayfalarından alınmış metin) kullanıcının seçtiği hesaba ya da sunucuya gider;
bu da aynı veri türüdür ve geliştiriciye ulaşmaz. Ayrıntı: `PRIVACY.md`. Tarayıcıdan çıkan veriler
şunlardır: çevrilmesini istediğin (seçtiğin ya da YouTube altyazısında üzerinde durduğun) metin seçili çeviri servisine, kasaya eklediğin
kelime Wiktionary'ye gönderilir; Firefox tabanlı tarayıcılarda macOS'te telaffuz düğmesine bastığın
kelime de ses kaydı için Wiktionary'ye sorulur; eşitlemeyi açtıysan kasan seçtiğin yere gider. Bunun
dışında hiçbir veri tarayıcıdan çıkmaz; analitik ya da izleme yoktur. Dil algılama tarayıcının kendi yerel algılayıcısıyla yapılır; diğer tarayıcılarda
telaffuz cihazdaki seslerle yapılır. Seçimin etrafındaki cümle ve sayfa adresi yalnızca kasada, bu
tarayıcıda saklanır.

## Arayüz dili

Arayüz metinleri `src/_locales` altında; şimdilik Türkçe ve İngilizce var. Tarayıcı dili bu ikisinden
biri değilse İngilizce gösterilir (`default_locale`).
