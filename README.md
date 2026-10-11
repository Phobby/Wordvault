# Wordvault

Firefox ve Chrome için dil öğrenme eklentisi. Web sayfalarında bilmediğin kelimeyi çevir, kasana
kaydet, sonra kısa quizlerle tekrar et. Her şey tarayıcında çalışır; Wordvault'un bir sunucusu yoktur.

> Geliştirme aşamalı ilerliyor. Şu an hazır olanlar: çift tıklama ile çeviri penceresi (kaynak ve hedef
> dil seçimi, telaffuz, "Kasaya ekle"), araç çubuğundaki kasa (liste, arama, detay, dışa/içe aktarma)
> ve hedef dil ile çift tıklama ayarlarını içeren ayarlar sayfası.
> Sırada: sağ tık menüsü, çeviri penceresinde kelime türü etiketi, önbellek ve 7 günlük temizlik,
> quiz, altyazılar, ayarlar sayfasının kalanı (sağlayıcı ve API anahtarı) ve gizlilik politikası.
>
> Cihazlar arası senkronizasyon (`SPEC-SYNC.md`) yedi aşamada ekleniyor; şu an 1. aşama hazır:
> veri modeli, birleştirme ve silme kayıtları. Henüz hiçbir yere veri gönderilmiyor.
>
> Flash card sistemi (`SPEC-QUIZ.md`) altı aşamada ekleniyor; şu an hazır olanlar: zamanlayıcı,
> "Neden quiz çıkmıyor?" tanı paneli, "Şimdi test et", öğrenme algoritması, soru seçimi, şık üretimi,
> quiz kartı (süre ölçümü, "Bilmiyorum", "Sonra sor", zaman aşımı) ve Flash card ayarları (aç/kapat,
> sıklık, en az kelime, cevap süresi, vadesi gelmemişleri sorma). Günlük soru sınırı, sessiz saatler,
> kelime durumlarının kasada gösterimi ve "Şimdi çalış" modu sonraki aşamalarda.

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
SPEC.md, SPEC-SYNC.md,  İstenen davranışın tanımı (eklenti, senkronizasyon, flash card)
SPEC-QUIZ.md
manifest.firefox.json   Firefox manifesti (background.scripts, gecko ayarları)
manifest.chrome.json    Chrome manifesti (background.service_worker)
build.js                dist/ klasörlerini üretir
tools/make-icons.js     src/icons altındaki PNG'leri üretir (yalnızca tasarım değişince)
tests/                  node:test testleri (tarayıcı API'leri bellek içi bir taklitle sağlanır)
src/
  background/           Arka plan betiği: mesaj yönlendirme, tüm ağ istekleri
  shared/               Hem sayfaya eklenen betiklerin hem eklenti sayfalarının kullandığı arayüz
                        parçaları (klasik betik, ortak WV ad alanı)
    dom.js              Öğe üretici, mesajlaşma, Shadow DOM yüzeyi
    styles.js           Renkler, düğmeler ve çeviri penceresinin CSS'i
    language-list.js    Dil adları ve aranabilir dil listesi
    speech.js           Telaffuz: tarayıcı sesi (speechSynthesis) ya da ses kaydı (Web Audio)
    stopwatch.js        Cevap süresi: yalnızca sayfa kullanıcının önündeyken işleyen kronometre
    quiz-card.js        Quiz kartı (web sayfalarında ve ayarlardaki "Şimdi test et"te)
  content/              Web sayfalarına eklenen betikler
    selection.js        Seçim, bağlam cümlesi ve dil yardımcıları
    popup.js            Çeviri penceresi
    quiz.js             Quiz'i sayfada gösterir; "şu an uygun mu" kontrolleri (ayarlar sayfası da yükler)
    triggers.js         Pencereyi açan tetikleyiciler (çift tıklama)
  popup/                Araç çubuğu simgesinin açtığı kasa: liste, arama, detay, dışa aktarma
  options/              Ayarlar sayfası: hedef dil, çift tıklama, Flash card ayarları ve tanı paneli,
                        yedekleme (dışa/içe aktarma)
  lib/                  Arka plan ve eklenti sayfalarının paylaştığı ES modülleri
    translator.js       Hedef/kaynak dil kararı ve sağlayıcı çağrısı
    settings.js         Ayarlar ve site bazlı kaynak dil
    vault.js            Kasa deposu
    dictionary.js       Wiktionary: kelime türü, tanım, örnek cümle
    pronunciation.js    Wikimedia Commons'taki telaffuz kayıtlarını bulur ve indirir
    backup.js           JSON dışa/içe aktarma
  providers/            Çeviri sağlayıcıları (ortak arayüz: providers/index.js)
  quiz/                 Flash card
    scheduler.js        Zamanlayıcı (chrome.alarms), quiz'in gösterilmesi, cevabın kaydı, tanı bilgisi
    learning.js         Öğrenme algoritması: cevabın kalitesi, sonraki tekrar, zorluk, durum (TUNING)
    selection.js        Sıradaki kelimenin seçimi (SELECTION)
    question.js         Soru ve şık üretimi
  sync/                 Senkronizasyon
    model.js            Eşitlenen belgenin biçimi; kasa kaydı <-> eşitleme kaydı dönüşümü
    merge.js            İki belgeyi birleştirme, silme kayıtlarının temizliği
    local.js            Bu cihazın kasasını belge olarak okuma ve belgeyi kasaya uygulama
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
- Zamanı gelince quiz yalnızca öndeki pencerenin aktif sekmesine, o sekmenin ana çerçevesine gönderilir.
  Sayfa "şu an uygun değil" derse (video oynuyor, tam ekran, yazı yazılıyor, çeviri penceresi açık)
  quiz atlanmaz, 3 dakika sonra (sıklık daha kısaysa o kadar sonra) yeniden denenir.
- Quiz'i ekrana getiren tek yol `quiz/scheduler.js` içindeki `showQuiz()` fonksiyonudur. Zamanlayıcı da
  **Şimdi test et** de onu çağırır; test yalnızca zamanlayıcıyı ve koşulları (anahtar, kelime sayısı,
  vade, sayfanın durumu) atlar ve zamanlayıcının planına ve kayıtlarına dokunmaz. Ayarlar sayfası da
  diğer sayfalar gibi quiz gösterebilir (`content/quiz.js` orada da yüklüdür).

Ayarlar sayfasındaki **Flash card** bölümü:

| Ayar | Anahtar | Varsayılan |
| --- | --- | --- |
| Flash card sor (ana anahtar) | `quizEnabled` | açık |
| Soru sıklığı: 5, 10, 15, 20, 30 dakika, 1, 2, 4 saat ya da özel süre (1–1440 dakika) | `quizIntervalMinutes` | 20 dakika |
| Vadesi gelmemiş kelimeleri de sor | `quizAllowNotDue` | açık |
| Başlamak için gereken kelime | `quizMinCards` | 10 |
| Cevap süresi (5–300 saniye) | `quizTimeoutSeconds` | 30 saniye |

Eklenti geliştirme için yüklendiğinde (`about:debugging` ya da "Load unpacked") sıklık listesinde
**Dakikada bir (deneme için)** seçeneği de çıkar; zamanlayıcıyı beklemeden izlemek içindir.

**Neden quiz çıkmıyor?** paneli gerçek zamanlayıcının durumunu gösterir ("Şimdi test et" buraya iz
bırakmaz): quiz açık mı, kasada kaç kelime var, kaçı sorulabilir, kaçının vadesi gelmiş, sıklık,
sıradaki quiz'in zamanı, alarmın kurulu olup olmadığı, son gösterilen quiz, son atlanan quiz ve nedeni
(`quizState.lastShown`, `lastSkip`), son sorunun nasıl bittiği.

Quiz için kasada en az 10 kelime (ayarlanır) ve hedef dilde en az 4 farklı anlam gerekir.

#### Zamanlayıcıyı denemek

1. Kasada en az 10 kelime olsun. Ayarlar → **Flash card** → **Soru sıklığı** → **Dakikada bir (deneme
   için)**. Panelde "Sıradaki quiz" bir dakika sonrasını, "Zamanlayıcı (alarm)" aynı saati göstermeli.
2. Sıradan bir web sayfası açık ve önde olsun, bir şeye dokunmadan bekle. Bir dakika sonra quiz
   kendiliğinden çıkar; cevapla. Bir dakika sonra başka bir kelimeyle yeniden çıkar. Üç kez üst üste
   izle: her seferinde farklı bir kelime sorulmalı.
3. Arka plan betiğinin konsolunda (Chrome: `chrome://extensions` → Wordvault → **Service worker**;
   Firefox: `about:debugging` → Bu Firefox → Wordvault → **İncele**) zamanlayıcının durumu:

```js
chrome.storage.local.get('quizState').then(({ quizState: s }) => console.log({ sıradaki: new Date(s.sonrakiQuizZamani).toLocaleTimeString(), sonGösterilen: s.lastShown && new Date(s.lastShown.at).toLocaleTimeString(), sonAtlanan: s.lastSkip, sonSorulanlar: s.recent.map((id) => id.split('|')[2]) }))
chrome.alarms.getAll().then((alarms) => console.table(alarms.map((a) => ({ ad: a.name, zaman: new Date(a.scheduledTime).toLocaleTimeString(), tekrarDakika: a.periodInMinutes }))))
```

   `sonSorulanlar` her quizden sonra bir kelime uzar ve aynı kelime art arda görünmez; alarmın zamanı
   her quizden sonra bir dakika ileri gider.

#### Quiz kartı

Kart sayfanın sağ üstünde, kapalı bir Shadow DOM içinde çıkar (`shared/quiz-card.js`) ve bir soru şu
beş yoldan biriyle biter; arka plan betiğine tek bir sonuç gider (`wv:quiz:answer`):

| Sonuç | Ne zaman | Kelimeye etkisi |
| --- | --- | --- |
| `answer` | Bir şık seçildi | Doğru ya da yanlış olarak, süresiyle birlikte işlenir |
| `unknown` | "Bilmiyorum" | Yanlış sayılır; doğru cevap gösterilir |
| `later` | "Sonra sor" | Sayılmaz; kelime 10 dakika sonra yeniden sorulur |
| `timeout` | Süresinde cevaplanmadı (varsayılan 30 sn, `quizTimeoutSeconds`) | Sayılmaz ("atlandı"); aynı |
| `closed` | Kart kapatıldı | Sayılmaz; aynı |

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
| `alarms` | Quiz'in zamanlayıcısı için. Arka plan betiği uyurken zamanı gelince onu uyandırır. |
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
