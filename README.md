# Wordvault

Firefox ve Chrome için dil öğrenme eklentisi. Web sayfalarında bilmediğin kelimeyi çevir, kasana
kaydet, sonra kısa quizlerle tekrar et. Her şey tarayıcında çalışır; Wordvault'un bir sunucusu yoktur.

> Geliştirme aşamalı ilerliyor. Şu an hazır olan: **çift tıklama ile çeviri penceresi** (Aşama 1).
> Sırada: sağ tık menüsü, Wiktionary bilgileri ve önbellek (2), kasa (3), quiz (4), altyazılar (5),
> ayarlar sayfası ve yayın hazırlığı (6).

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
    speech.js           Telaffuz: ses seçimi ve okuma kuyruğu (speechSynthesis)
  content/              Yalnızca web sayfalarına eklenen betikler
    selection.js        Seçim, bağlam cümlesi ve dil yardımcıları
    popup.js            Çeviri penceresi
    triggers.js         Pencereyi açan tetikleyiciler (çift tıklama)
  options/              Ayarlar sayfası
  lib/                  Arka plan ve eklenti sayfalarının paylaştığı ES modülleri
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

### Yeni çeviri sağlayıcısı eklemek

`src/providers/` altına `TranslationProvider` arayüzünü (bkz. `providers/index.js`) uygulayan bir modül
ekle ve aynı dosyadaki kayıt listesine yaz. Sağlayıcının sunucusu CORS başlığı göndermiyorsa adresini
iki manifestteki `host_permissions` listesine de ekle.

## İzinler

| İzin | Neden gerekli |
| --- | --- |
| `storage` | Ayarları (ileride kasayı ve çeviri önbelleğini) `chrome.storage.local` içinde, yalnızca bu tarayıcıda saklamak için. |
| `unlimitedStorage` | Kasa büyüdükçe `storage.local`'ın 10 MB sınırına takılmamak için. Kasadaki kelimeler asla otomatik silinmez. |
| İçerik betiği: `<all_urls>` | Çift tıklama herhangi bir sayfada çalışmalı. Betik, kullanıcı bir kelimeye çift tıklayana kadar sayfadan hiçbir şey okumaz. |
| Sunucu izni: `https://api.mymemory.translated.net/*` | Varsayılan çeviri servisi. İstekler arka plan betiğinden gider. |

Firefox manifestindeki `data_collection_permissions` beyanı `websiteContent` içerir: çevrilmesini
istediğin (seçtiğin) metin, seçili çeviri servisine gönderilir. Bunun dışında hiçbir veri tarayıcıdan
çıkmaz; analitik ya da izleme yoktur. Dil algılama tarayıcının kendi yerel algılayıcısıyla yapılır,
seçimin etrafındaki cümle hiçbir yere gönderilmez.

## Arayüz dili

Arayüz metinleri `src/_locales` altında; şimdilik Türkçe ve İngilizce var. Tarayıcı dili bu ikisinden
biri değilse İngilizce gösterilir (`default_locale`).
