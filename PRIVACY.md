# Wordvault gizlilik politikası

Wordvault bir tarayıcı eklentisidir. Kasan ve ayarların için **bir sunucu yoktur**: geliştirici
kelimelerini, gezdiğin sayfaları ya da ayarlarını toplamaz, görmez ve saklamaz. Eklentide analitik,
izleme, reklam ya da kullanım ölçümü bulunmaz.

Geliştiriciye veri ulaşan **tek durum**, senin ayarlardaki "İletişim ve geri bildirim" formunu doldurup
gönderilecek veriyi gördükten sonra "Gönder"e basmandır (aşağıda, "Geri bildirim").

Bu belge, verinin tarayıcıdan ne zaman, neden ve nereye çıktığını eksiksiz sayar.
İngilizcesi ve web sürümü: `docs/privacy.html`.

## Tarayıcıda kalanlar

Aşağıdakiler yalnızca kullandığın tarayıcıda (`chrome.storage.local`) durur:

- **Kasa:** kaydettiğin kelimeler, çevirileri, dil çiftleri, bağlam cümlesi, kaydedildiği sayfanın
  adresi ve başlığı, sözlük bilgisi, tekrar ilerlemen.
- **Ayarlar:** hedef dil, quiz ayarları, site bazlı kaynak dil seçimleri.
- **Senkronizasyon bilgileri:** hangi yolu seçtiğin, bağlandığın hesabın erişim token'ları, kendi
  sunucunun adresi, kullanıcı adı, parolası ya da anahtarı, şifreleme anahtarı (hatırlamasını
  istediysen).

- **Geri bildirim taslağı:** forma yazdığın ama henüz göndermediğin metin (gönderince silinir).
- **Yerel hata günlüğü:** eklentinin kendi hatalarından son 20 kayıt (hata mesajı, eklentinin hangi
  bölümü, zaman, yığının eklenti dosyalarını gösteren ilk satırları). Sayfa adresi ya da içeriği
  içermez. Formdaki "Kayıtları sil" ile silinir; sen eklemedikçe hiçbir yere gitmez.

Eklentiyi kaldırdığında tarayıcı bunların hepsini siler.

## Tarayıcıdan çıkanlar

Veri yalnızca aşağıdaki durumlarda ve yalnızca belirtilen yere gider.

### Çeviri (her zaman, senin isteğinle)

Bir kelimeye çift tıkladığında ya da çeviri istediğinde **seçtiğin metin** ve dil çifti, çeviri
sağlayıcısına gönderilir (varsayılan: MyMemory, `api.mymemory.translated.net`). Sayfanın geri kalanı,
adresi ya da kimliğin gönderilmez. Sağlayıcının kendi gizlilik politikası geçerlidir.

Ayarlardan **DeepL**'i seçip kendi API anahtarını girersen bu metin MyMemory yerine DeepL'e
(`api-free.deepl.com` ya da `api.deepl.com`) gider; anahtarın isteğin başlığında DeepL'e gönderilir ve
başka hiçbir yere gitmez. Anahtar yalnızca bu tarayıcıda saklanır; yedeğe, senkronizasyona ve geri
bildirime dahil edilmez. Bir hata olursa servis kendiliğinden değiştirilmez; MyMemory ile devam etmek
senin seçimindir. Çevirilerin yanıtları 7 gün boyunca yalnızca bu tarayıcıda önbellekte tutulur.

Bir **cümle ya da paragraf** seçip çevirdiğinde (sağ tık menüsündeki "Wordvault ile çevir", seçimin
yanındaki "Çevir" düğmesi ya da klavye kısayolu) de aynı şey olur: **yalnızca seçtiğin metin** ve dil
çifti, yalnızca seçili çeviri servisine gider; başka hiçbir yere gönderilmez. Uzun metin servise cümle
sonlarında bölünmüş parçalar halinde, sırayla gönderilir (bir kerede en çok 5.000 karakter). Metnin
dili tarayıcının içinde algılanır. Çeviri kasaya kendiliğinden girmez; "İfade olarak kasaya ekle"ye
basarsan saklanır ve ifadeler için sözlüğe (Wiktionary) sorulmaz. Wordvault'un sayfaya çizim
yapamadığı yerlerde (tarayıcının kendi sayfaları, PDF görüntüleyicisi) çeviri küçük bir pencerede
gösterilir; seçilen metin o pencereye tarayıcının oturum belleği üzerinden verilir, diske yazılmaz.

YouTube'da altyazıdaki bir kelimenin üzerinde imleci tuttuğunda da aynı şey olur: **yalnızca o kelime**
ve dil çifti gönderilir. Altyazı satırı dili algılamak için tarayıcının içinde kullanılır, kelimeyi
kasaya eklersen onunla birlikte saklanır; altyazı akışı kaydedilmez ya da indirilmez.

### Yapay zekâ özellikleri (yalnızca sen bir sağlayıcı bağlarsan ve her seferinde sen başlatırsan)

Varsayılan olarak kapalıdır. Ayarlardan kendi yapay zekâ sağlayıcını (Google Gemini, Claude API,
OpenAI uyumlu bir servis ya da bilgisayarındaki Ollama) bağlarsan çeviri penceresinde "Yapay zekâ ile
açıkla" çalışır. Düğmeye **sen bastığında** şunlar, tarayıcından doğrudan **yalnızca seçtiğin
sağlayıcıya** gider, başka hiçbir yere gönderilmez; arada Wordvault'un bir sunucusu yoktur:

- kelime için: kelime, geçtiği cümle ve sayfanın başlığı;
- seçtiğin cümle/paragraf için: o metin ve sayfanın başlığı;
- "Sayfayı özetle" için (sayfanın sağ tık menüsü ya da Wordvault penceresi; yalnızca bir sağlayıcı
  ayarlıyken görünür): sayfanın **ana metni** ve başlığı. Menüler, reklamlar ve yan içerikler
  ayıklanır. Sayfa yalnızca sen özet isteyince okunur; kart önce ne kadar metnin, kaç parçada, hangi
  sağlayıcıya gideceğini gösterir ve sen "Özetle"ye basmadan hiçbir şey gönderilmez. Uzun sayfa
  birkaç parçada gider; en çok 120.000 karakter, fazlası gönderilmez ve bu sana söylenir.
- "Sayfayı yapay zekâ ile çevir" için (deneysel; aynı iki yerde): sayfanın **görünür metni** ve
  başlığı, art arda birkaç istekte. Kart önce yaklaşık kaç karakterin kaç istekte, hangi sağlayıcıya
  gideceğini ve bunun kotandan düşeceğini gösterir; sen "Çevir"e basmadan hiçbir şey gönderilmez.
  En çok 100.000 karakter. Sayfaya sonradan gelen metin kendiliğinden gönderilmez: kart yeni metin
  olduğunu söyler, sen istersen çevrilir. Çeviri yalnızca sayfadaki metnin yerine yazılır, hiçbir
  yere kaydedilmez; "Orijinale dön" ya da kartı kapatmak sayfayı eski hâline getirir.

Gönderilmeyenler: sayfanın adresi, parola alanları, form girdileri, gizli alanlar ve gizlenmiş
bölümler, yazı yazdığın kutulardaki ve düzenlenebilir alanlardaki metin (böyle bir alandan seçilen
metin için "açıkla" düğmesi çalışmaz; özet ve sayfa çevirisi bu alanları hiç okumaz), kasan.
"Açıkla" için ayrıca sayfanın geri kalanı da gönderilmez. Hiçbir şey
kendiliğinden ya da arka planda gönderilmez. İlk kullanımda pencere neyin nereye gideceğini söyler
ve onayını ister; sağlayıcıyı değiştirirsen yeniden sorar. Banka, e-posta ve sağlık sitesine benzeyen
sitelerde bu özellikler kapalıdır; listeyi ayarlardan sen yönetirsin.

API anahtarın yalnızca bu tarayıcıda (`chrome.storage.local`) saklanır ve yalnızca o sağlayıcıya,
isteğin başlığında gönderilir. Yedeğe, senkronizasyona, geri bildirime, hata günlüğüne ve
önbelleklere girmez. Yapay zekâ cevapları diske yazılmaz: en fazla tarayıcı kapanana kadar bellekte
tutulur (ayarlardan kapatılabilir); sayfanın metni yalnızca özet kartı açıkken bellekte durur. Bir açıklamayı kasadaki kelimenin notuna yalnızca sen eklersen
saklanır. Gönderilen metinle sağlayıcının ne yaptığı kendi koşullarına bağlıdır (örneğin Google,
Gemini'nin ücretsiz katmanında içeriğin ürünlerini geliştirmek için kullanıldığını yazar).

Sağlayıcı bağlı değilken "İstemi kopyala ve aç" hazır istemi panona kopyalar ve seçtiğin sohbet
sitesini yeni sekmede açar; eklenti hiçbir şey göndermez, oraya sen yapıştırırsın.

### Ekrandan metin tarama (yalnızca sen başlattığında)

Taramayı kısayolla ya da menüden başlattığında, o sekmenin o anki ekran görüntüsü alınır ve seçtiğin
alan **bu tarayıcının içinde** okunur (Tesseract.js; motor ve dil verisi eklentinin içindedir, ağdan
hiçbir şey indirilmez). Görüntü ve ondan okunan metin cihazından çıkmaz, hiçbir yere kaydedilmez;
okuma bitince görüntü bellekten atılır. Eklentinin sekmelerin görüntüsünü kendiliğinden alma izni
yoktur (`activeTab`: yalnızca senin başlattığın anda, yalnızca o sekme). Bulut OCR kullanılmaz.
Okunan bir kelimeye tıklarsan yalnızca **o kelime** çeviri servisine gider; kasaya eklersen kelime,
okunan satırıyla birlikte kasada saklanır.

### Sözlük ve telaffuz (kelimeyi kasaya eklediğinde ya da dinlediğinde)

Kasaya eklediğin kelime, türünü ve örnek cümlelerini almak için Wiktionary'ye
(`en.wiktionary.org`) sorulur. Firefox tabanlı tarayıcılarda macOS'te telaffuz düğmesine bastığın
kelimenin ses kaydı Wikimedia Commons'tan (`upload.wikimedia.org`) indirilir. Diğer durumlarda
telaffuz cihazındaki seslerle yapılır ve hiçbir yere istek gitmez.

### Senkronizasyon (yalnızca sen açarsan)

Varsayılan **"Sadece bu cihaz"**tır: hiçbir şey gönderilmez. Ayarlardan bir yol seçip neyin nereye
gideceğini anlatan onayı verdiğinde kasan **senin seçtiğin yere** gönderilir:

| Seçtiğin yol | Veri nereye gider |
| --- | --- |
| Tarayıcı senkronu | Tarayıcının kendi senkron deposuna (Firefox Sync / Chrome senkronu); tarayıcı hesabınla taşınır |
| Google Drive | Kendi Google Drive'ında, uygulamanın gizli veri klasörüne |
| OneDrive | Kendi OneDrive'ında, `Uygulamalar/Wordvault` klasörüne |
| Dropbox | Kendi Dropbox'ında, uygulamanın klasörüne |
| Kendi sunucum | Girdiğin WebDAV ya da HTTP adresine |

**Gönderilen:** her kelime, çevirisi, dil çifti, kısa bağlam cümlesi (en çok 160 karakter), tekrar
ilerlemesi (kutu, sonraki tekrar zamanı, cevap özeti, öğrenildi durumu), quiz çözdüğün günlerin tarih
listesi (seri için) ve silinen kelimelerin silme kayıtları.

**Asla gönderilmeyen:** sayfa adresleri ve başlıkları, ayarlar, API anahtarları, erişim token'ları,
sunucu parolaları, çeviri önbelleği, quiz zamanlayıcısının durumu.

İstekler tarayıcından doğrudan o hizmete yapılır; arada geliştiriciye ait bir sunucu yoktur. Bulut
sağlayıcılarından yalnızca en dar izin istenir (uygulamaya özel klasör); diğer dosyaların görülemez.
Erişim token'ları yalnızca tarayıcında durur ve hiçbir yere eşitlenmez.

**Şifreleme (isteğe bağlı):** Açarsan dosya, tarayıcından çıkmadan önce parolandan türetilen bir
anahtarla şifrelenir (PBKDF2 + AES-256-GCM); saklandığı yer içeriğini okuyamaz. Parola hiçbir yerde
saklanmaz. Parolayı kaybedersen uzaktaki kopya kurtarılamaz; cihazındaki kasa etkilenmez.

**Durdurmak ve silmek:** Ayarlardan **Bağlantıyı kes** eşitlemeyi durdurur; "buluttaki dosyayı da sil"
seçeneği uzaktaki dosyayı kaldırır. Dosyayı ilgili hizmetin kendi arayüzünden de silebilirsin (Google
Drive: Ayarlar → Uygulamaları yönet → Wordvault; OneDrive ve Dropbox: Uygulamalar klasörü).

### Geri bildirim (yalnızca sen gönderirsen)

Ayarlardaki "İletişim ve geri bildirim" formu, sen "Gönder"e basmadıkça hiçbir şey göndermez. Önce
"Gönderilecek veriyi göster" ile gidecek verinin **tamamını** görürsün; gönderilen, o ekranda
gördüğünün aynısıdır.

**Gönderilen (yalnızca bunlar):**

- seçtiğin tür (hata / öneri / diğer) ve ilgili özellik,
- yazdığın metin,
- **yazdıysan** e-posta adresin (boş bırakırsan mesaj anonimdir),
- **"Teknik bilgileri ekle" işaretliyse:** tarayıcının adı ve sürümü (ve üzerine kurulduğu motor),
  işletim sisteminin adı, eklentinin sürümü, arayüz dili, hangi özelliklerin açık olduğu (yalnızca
  evet/hayır) ve senkronizasyonun türü (kapalı / tarayıcı / bulut / kendi sunucu; hangi hizmet ya da
  hesap olduğu değil),
- **"Son hata kayıtlarını ekle" işaretliyse** (varsayılan kapalı): yukarıdaki yerel hata günlüğü.

**Asla gönderilmeyen:** sayfa adresleri, sayfa içeriği, kasandaki kelimeler, bağlam cümleleri, API
anahtarları, erişim token'ları, kullanıcı kimliği. Eklenti bir kurulum kimliği ya da başka bir kalıcı
tanımlayıcı üretmez.

**Nereye gider:** tarayıcından HTTPS ile geliştiricinin geri bildirim alıcısına
(`wordvault-feedback.phoby.workers.dev`, Cloudflare Workers üzerinde çalışan küçük bir program). Alıcı
mesajı denetler ve geliştiricinin Telegram hesabına, bir bot aracılığıyla iletir.

**Ne saklanır:**

- Alıcı mesajı **saklamaz** ve hiçbir şeyi günlüğe yazmaz. Tuttuğu tek şey, günde kaç mesaj
  iletildiğini gösteren tek bir sayıdır (kötüye kullanıma karşı tavan); mesajla ya da gönderenle ilgili
  hiçbir şey içermez ve iki gün sonra silinir.
- **IP adresin:** her internet isteğinde olduğu gibi altyapı sağlayıcısı (Cloudflare) tarafından
  görülür. Alıcı onu yalnızca dakikalık hız sınırı için Cloudflare'in sınırlayıcısına verir;
  kaydetmez, iletmez, geliştirici onu görmez.
- Firefox tabanlı tarayıcılar isteğe, eklentinin o kuruluma özgü iç adresini içeren bir `Origin`
  başlığı ekler. Bunu tarayıcı yapar; alıcı bu başlığı okumaz, kaydetmez ve iletmez.
- İletilen mesaj geliştiricinin **Telegram sohbetinde** durur (Telegram'ın sunucularında), geliştirici
  silene kadar. Telegram'ın kendi gizlilik politikası geçerlidir.

**Sildirmek:** gönderdiğin bir mesajın silinmesini istersen aynı formdan yaz (mesajı ayırt etmeye
yetecek kadar: yaklaşık tarih ve saat, verdiysen e-posta adresi) ya da mağaza sayfasındaki geliştirici
iletişim adresini kullan. Mesaj Telegram sohbetinden silinir; başka bir kopyası yoktur.

Firefox'ta bu veri türleri (`personalCommunications`, `technicalAndInteraction`,
`personallyIdentifyingInfo`) isteğe bağlı olarak beyan edilmiştir: kurulumda verilmez, ilk gönderimde
tarayıcının kendi penceresi sorar.

### Destek bağlantısı

"Projeyi destekle" düğmesi sade bir bağlantıdır; basarsan destek sayfası (Buy Me a Coffee) yeni bir
sekmede açılır. Basmadıkça o hizmete hiçbir istek gitmez: eklenti oradan betik, resim ya da yazı tipi
yüklemez. Açılan sayfada o hizmetin kendi koşulları geçerlidir.

### Sistem bildirimi (yalnızca izin verirsen)

Quiz başka hiçbir yolla gösterilemediğinde ve akşam hatırlatmasında tarayıcının bildirim sistemi
kullanılabilir. Bildirim metninde kelime ya da kişisel veri bulunmaz.

### Seri, rütbe ve öğrenme durumu

Seri (quiz çözdüğün günler), rütbe ve hangi kelimeyi öğrendiğin bu tarayıcıda hesaplanır ve durur.
Sıralama, paylaşım ya da karşılaştırma yoktur; geliştiriciye gitmez. Eşitlemeyi açtıysan kasanla
birlikte senin seçtiğin yere gider.

## İzinler

Eklentinin istediği her iznin gerekçesi `README.md` dosyasının "İzinler" bölümündedir. Tarayıcı
hesabının e-posta adresi istenmez. Bulut ve sunucu adreslerine erişim izni kurulumda değil, o yolu
seçip bağlandığın anda ve yalnızca o adres için istenir; geri bildirim alıcısının adresi için de izin
ilk gönderimde ve yalnızca o adres için istenir. Mağaza için hazırlanmış gerekçeler: `store/permissions.md`.

## Üçüncü taraf hizmetlerin koşulları

Seçtiğin hizmetin kendi koşulları geçerlidir. Wordvault, Google API Services User Data Policy'nin
"Limited Use" gereklerine, Microsoft API Terms of Use'a ve Dropbox Developer Terms'e uygun davranır:
bu hizmetlerden alınan veri yalnızca kasanın eşitlenmesi için kullanılır, başka kimseye aktarılmaz,
reklam ya da profil çıkarma için kullanılmaz, insanlar tarafından okunmaz.

## Çocuklar

Wordvault kendiliğinden kimseden kişisel veri toplamaz. Geri bildirim formu çocuklara yönelik
değildir; e-posta alanı isteğe bağlıdır.

## Değişiklikler

Bu belge eklentiyle birlikte sürümlenir. Tarayıcıdan çıkan veride bir değişiklik olursa burada ve
sürüm notlarında belirtilir.
