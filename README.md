# Wordvault

Firefox ve Chrome için dil öğrenme eklentisi. Web sayfalarında bilmediğin kelimeyi çevir, kasana
kaydet, sonra kısa quizlerle tekrar et. Her şey tarayıcında çalışır; Wordvault'un bir sunucusu yoktur.

> Geliştirme aşamalı ilerliyor. Şu an hazır olanlar: çift tıklama ile çeviri penceresi (kaynak ve hedef
> dil seçimi, telaffuz, "Kasaya ekle"), araç çubuğundaki kasa (liste, arama, detay, dışa/içe aktarma)
> ve hedef dil ile çift tıklama ayarlarını içeren ayarlar sayfası.
> Sırada: sağ tık menüsü, çeviri penceresinde kelime türü etiketi, önbellek ve 7 günlük temizlik,
> quiz, altyazılar, ayarlar sayfasının kalanı (sağlayıcı ve API anahtarı) ve gizlilik politikası.

## Derleme

Bağımlılık yok, bundler yok. Node.js 22.2 veya üstü yeterli.

```sh
node build.js            # dist/firefox ve dist/chrome klasörlerini üretir
node build.js --watch    # src/ değiştikçe yeniden üretir
node build.js firefox    # tek hedef
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
manifest.firefox.json   Firefox manifesti (background.scripts, gecko ayarları)
manifest.chrome.json    Chrome manifesti (background.service_worker)
build.js                dist/ klasörlerini üretir
tools/make-icons.js     src/icons altındaki PNG'leri üretir (yalnızca tasarım değişince)
src/
  background/           Arka plan betiği: mesaj yönlendirme, tüm ağ istekleri
  shared/               Hem sayfaya eklenen betiklerin hem eklenti sayfalarının kullandığı arayüz
                        parçaları (klasik betik, ortak WV ad alanı)
    dom.js              Öğe üretici, mesajlaşma, Shadow DOM yüzeyi
    styles.js           Renkler, düğmeler ve çeviri penceresinin CSS'i
    language-list.js    Dil adları ve aranabilir dil listesi
    speech.js           Telaffuz: tarayıcı sesi (speechSynthesis) ya da ses kaydı (Web Audio)
  content/              Yalnızca web sayfalarına eklenen betikler
    selection.js        Seçim, bağlam cümlesi ve dil yardımcıları
    popup.js            Çeviri penceresi
    triggers.js         Pencereyi açan tetikleyiciler (çift tıklama)
  popup/                Araç çubuğu simgesinin açtığı kasa: liste, arama, detay, dışa aktarma
  options/              Ayarlar sayfası: hedef dil, çift tıklama, yedekleme (dışa/içe aktarma)
  lib/                  Arka plan ve eklenti sayfalarının paylaştığı ES modülleri
    translator.js       Hedef/kaynak dil kararı ve sağlayıcı çağrısı
    settings.js         Ayarlar ve site bazlı kaynak dil
    vault.js            Kasa deposu
    dictionary.js       Wiktionary: kelime türü, tanım, örnek cümle
    pronunciation.js    Wikimedia Commons'taki telaffuz kayıtlarını bulur ve indirir
    backup.js           JSON dışa/içe aktarma
  providers/            Çeviri sağlayıcıları (ortak arayüz: providers/index.js)
  _locales/             Arayüz metinleri (en, tr)
  icons/
```

Sayfaya eklenen bütün arayüz kapalı bir Shadow DOM içinde yaşar: sayfanın CSS'i eklentiye, eklentinin
CSS'i sayfaya ulaşamaz. Sayfanın kendi içeriği değiştirilmez.

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

### Yeni çeviri sağlayıcısı eklemek

`src/providers/` altına `TranslationProvider` arayüzünü (bkz. `providers/index.js`) uygulayan bir modül
ekle ve aynı dosyadaki kayıt listesine yaz. Sağlayıcının sunucusu CORS başlığı göndermiyorsa adresini
iki manifestteki `host_permissions` listesine de ekle.

## İzinler

| İzin | Neden gerekli |
| --- | --- |
| `storage` | Ayarları ve kasayı (ileride çeviri önbelleğini) `chrome.storage.local` içinde, yalnızca bu tarayıcıda saklamak için. |
| `unlimitedStorage` | Kasa büyüdükçe `storage.local`'ın 10 MB sınırına takılmamak için. Kasadaki kelimeler asla otomatik silinmez. |
| İçerik betiği: `<all_urls>` | Çift tıklama herhangi bir sayfada çalışmalı. Betik, kullanıcı bir kelimeye çift tıklayana kadar sayfadan hiçbir şey okumaz. |
| Sunucu izni: `https://api.mymemory.translated.net/*` | Varsayılan çeviri servisi. İstekler arka plan betiğinden gider. |
| Sunucu izni: `https://en.wiktionary.org/*` | Kasaya eklenen kelimenin türünü, tanımlarını ve örnek cümlelerini almak; Firefox/macOS'te kelimenin ses kaydını bulmak için. |
| Sunucu izni: `https://upload.wikimedia.org/*` | Firefox/macOS'te telaffuz için ses kaydını (Wikimedia Commons) indirmek için. |

Sekme açmak (`chrome.tabs.create`) ve ayarlar sayfasını açmak izin gerektirmez; `tabs` izni istenmez.

Firefox manifestindeki `data_collection_permissions` beyanı `websiteContent` içerir. Tarayıcıdan çıkan
veriler şunlardır: çevrilmesini istediğin (seçtiğin) metin seçili çeviri servisine, kasaya eklediğin
kelime Wiktionary'ye gönderilir; Firefox tabanlı tarayıcılarda macOS'te telaffuz düğmesine bastığın
kelime de ses kaydı için Wiktionary'ye sorulur. Bunun dışında hiçbir veri tarayıcıdan çıkmaz; analitik
ya da izleme yoktur. Dil algılama tarayıcının kendi yerel algılayıcısıyla yapılır; diğer tarayıcılarda
telaffuz cihazdaki seslerle yapılır. Seçimin etrafındaki cümle ve sayfa adresi yalnızca kasada, bu
tarayıcıda saklanır.

## Arayüz dili

Arayüz metinleri `src/_locales` altında; şimdilik Türkçe ve İngilizce var. Tarayıcı dili bu ikisinden
biri değilse İngilizce gösterilir (`default_locale`).
