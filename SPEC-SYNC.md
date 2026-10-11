# Wordvault: Senkronizasyon ve Yedekleme Sistemi

Mevcut Wordvault eklentisine (Firefox + Chrome, Manifest V3, düz JS, build aracı yok) kasadaki
kelimeleri cihazlar arasında eşitleyen bir sistem ekle. Önce mevcut kodu ve SPEC.md'yi oku, mevcut
yapıya uy (storage şeması, build.js, iki manifest, Shadow DOM kuralı). Sunucum yok: tüm veri
kullanıcının tarayıcısından, kullanıcının kendi hesabına/sunucusuna gider. Veriyi asla benim
kontrolümdeki bir yere gönderme.

## 1. Ayarlar sayfasında kullanıcı akışı
Ayarlar sayfasında mevcut "İçe/Dışa aktar" bölümünün altına **"Senkronizasyon ve yedekleme"**
bölümü ekle. Kullanıcı şunlardan birini seçer:

1. **Sadece bu cihaz** (varsayılan): Hiçbir şey bağlanmaz. Mevcut elle JSON dışa/içe aktarma
   düğmeleri bu bölümün üstünde durmaya devam eder.
2. **Tarayıcı senkronu**: `storage.sync` ile. Boyut sınırı (~100 KB) yüzünden küçük listeler
   içindir, ayarlarda bunu açıkça yaz ve doluluğu göster (`getBytesInUse`, %80'de uyar,
   dolunca senkronu durdurup yerelde devam et, veri silme).
3. **Bulut hesabı bağla**: tıklayınca sağlayıcı listesi açılır: **Google Drive, OneDrive, Dropbox**.
   Birine tıklayınca o sağlayıcının giriş/onay penceresi açılır, kullanıcı hesabını seçip izin
   verir, bağlantı kurulur.
4. **Kendi sunucum**: tıklayınca bir form açılır (WebDAV/Nextcloud: URL, kullanıcı adı, uygulama
   parolası. Alternatif: basit HTTP uç noktası, bkz. bölüm 7).

Bağlıyken bölümde şunlar görünsün: sağlayıcı adı, mümkünse bağlı hesabın e-postası/adı (ekstra
izin gerektirmiyorsa), son başarılı eşitleme zamanı, durum (eşitleniyor/hata/güncel), **"Şimdi
eşitle"** ve **"Bağlantıyı kes"** düğmeleri. Bağlantıyı keserken "buluttaki dosyayı da sil"
seçeneği sor (varsayılan: silme). Bağlanmadan önce neyin nereye gideceğini anlatan kısa bir onay
metni göster. Kullanıcı onaylamadan hiçbir bulut isteği yapma.

**iCloud:** Üçüncü taraf bir tarayıcı eklentisinin iCloud Drive'a ücretsiz ve doğrudan erişmesinin
gerçekçi bir yolu yok (CloudKit JS Apple geliştirici hesabı ve kendi container'ını gerektiriyor).
Bunu araştırıp doğrula. Mümkün değilse iCloud'u sağlayıcı listesine koyma, onun yerine ayarlarda
küçük bir not göster: "iCloud için JSON'u dışa aktarıp iCloud Drive klasörüne kaydedebilirsin."
Kararı ve gerekçesini aşama sonu özetinde yaz.

Arayüz metinleri `_locales` ile çok dilli olsun (`chrome.i18n`, en ve tr).

## 2. Aynı hesapla ikinci cihazda otomatik eşleşme (en önemli kısım)
Kullanıcı aynı bulut hesabını ikinci cihazdaki Wordvault'a bağladığında hiçbir elle adım olmadan
kasa birleşsin:

- Bağlanınca bulutta Wordvault dosyasını **bul-ya-da-oluştur**: yoksa yerel kasadan oluştur,
  varsa indir, yerel kasayla **birleştir**, birleşmiş sonucu hem yerele hem buluta yaz. Yerel
  kasadaki ya da buluttaki hiçbir kelime kaybolmamalı.
- İki cihaz aynı anda ilk kez bağlanıp iki ayrı dosya oluşturursa: dosya listesinde birden fazla
  Wordvault dosyası görünce hepsini oku, birleştir, en eski olanı tek kaynak olarak tut, diğerlerini
  birleştirme başarılı olduktan sonra sil.
- Sağlayıcıda veriyi kullanıcının görmediği uygulamaya özel alana yaz:
  - Google Drive: `drive.appdata` kapsamı, `appDataFolder`. Başka hiçbir Drive iznini isteme.
  - OneDrive (Microsoft Graph): `Files.ReadWrite.AppFolder` + `offline_access`, `approot`.
  - Dropbox: "App folder" erişimli uygulama, `files.content.read/write`.
  Dosya adı: `wordvault-vault.json.gz` (gzip'lenmiş JSON; binary yükleme kullan, base64 gerekmez).
- Kullanıcıya "dosya nerede" sorusunun cevabını README ve ayarlar sayfasında ver.

## 3. Veri modeli ve birleştirme
Birleştirme **değişmeli, birleşmeli ve tekrar uygulanabilir** (commutative, associative,
idempotent) olsun. Hangi cihaz hangi sırayla eşitlerse eşitlesin sonuç aynı çıkmalı.

- Her kelime kaydı: kararlı `id` (kelime+kaynak dil+hedef dil'den türetilmiş), kelime, çeviri,
  dil çifti, kısa bağlam cümlesi, Leitner kutusu, sonraki tekrar tarihi, `updatedAt`.
  Anahtar adlarını kısa tut (`w`, `t`, `sl`, `tl`, `c`, `b`, `n`, `u`).
- Kaydı çakışırsa **`updatedAt` büyük olan kazanır**, eşitlikte deterministik bir kural
  (örneğin cihaz kimliğine göre) uygula. Saat kayması için kayıt başına mantıksal sayaç (Lamport
  tarzı sürüm numarası) kullanmayı değerlendir ve seçimini gerekçelendir.
- **Silme = tombstone**: silinen kelimenin yerine `{id, deletedAt}` kaydı kalır, aksi halde silinen
  kelime diğer cihazdan geri gelir. Silmeden sonra yeniden eklenirse daha yeni olan kazanır.
  Tombstone'lar 90 gün sonra bir sonraki eşitlemede temizlensin.
- **Senkronlanacaklar:** sadece kasadaki kelimeler (ve silme kayıtları). **Senkronlanmayacaklar:**
  çeviri önbelleği, ayarlar (API anahtarları dahil), OAuth token'ları, sayfa adresleri.
- Şema sürümü alanı (`v`) ekle, eski/bilinmeyen sürümü bozmadan koru.
- `storage.sync` modunda: yukarıdaki veriyi gzip (`CompressionStream`) + base64 ile sıkıştırıp
  ~7 KB'lık parçalara böl (`wv_0`, `wv_1`, ...), yazma sınırına takılmamak için değişiklikleri
  5-10 sn biriktirip tek seferde yaz, parça sayısı değişince fazla parçaları temizle.

## 4. Sağlayıcı arayüzü ve eşitleme motoru
Sağlayıcıları tek bir ortak arayüze bağla (`sync/providers/` klasörü, her sağlayıcı ayrı dosya):
`connect()`, `disconnect()`, `read()` (içerik + sürüm bilgisi, yoksa `null`), `write(data,
expectedVersion)`, `accountInfo()`. Çeviri sağlayıcılarındaki modül yapısıyla uyumlu olsun.

Eşitleme motoru (`sync/engine.js`):
- Akış: oku → yerelle birleştir → değiştiyse yaz → yerel durumu güncelle. Yazarken **iyimser
  eşzamanlılık** kullan (Dropbox `rev`, Graph `eTag`/`If-Match`, WebDAV `If-Match`, Drive'da
  sürüm/değişiklik zamanı kontrolü). Çakışma hatasında yeniden oku-birleştir-yaz (en fazla 5 deneme,
  üstel bekleme).
- Tetikleyiciler: kasa değişince 10 sn debounce, tarayıcı açılışında, `chrome.alarms` ile
  periyodik (varsayılan 15 dk), elle "Şimdi eşitle".
- Aynı anda tek eşitleme çalışsın (kilit). Çevrimdışıyken kuyruğa al, bağlantı gelince devam et.
- Hata türlerini ayır: ağ hatası (sessizce tekrar dene), yetki hatası (token yenilenemedi,
  kullanıcıya "yeniden bağlan" göster), kota dolu (kullanıcıya bildir, yerelde devam et). Hiçbir
  hata yerel veriyi silmesin ya da bozmasın.
- Background script MV3'te uyuyabilir (Chrome service worker). Durumu `storage.local`'da tut,
  motoru her uyanışta sıfırdan başlatılabilir yaz.

## 5. Kimlik doğrulama (OAuth)
- İki tarayıcıda da çalışması için `identity.launchWebAuthFlow` + **PKCE** kullan, yönlendirme
  adresi `identity.getRedirectURL()`'den alınsın. Chrome ve Firefox'un yönlendirme adresi biçimleri
  farklıdır, ikisini de destekle.
- Eklenti kimliği sabit olmalı (Chrome için manifest `key` alanı, Firefox için `gecko.id`), yoksa
  yönlendirme adresi her kurulumda değişir ve OAuth kayıtları tutmaz.
- Her sağlayıcı için güncel resmi belgeleri kontrol et (token uç noktası, PKCE'nin client secret
  gerektirip gerektirmediği, yenileme token'ı alma yöntemi, Google'da istemci türü seçimi) ve
  buna göre uygula. **Gönderilen pakette client secret olmamalı.** Secret zorunluysa o sağlayıcıda
  token yenilemeyi sessiz `launchWebAuthFlow` (`interactive: false`) ile yap ve kısıtı belgele.
- Token'lar yalnızca `storage.local`'da dursun, asla `storage.sync`'e ya da buluta yazılmasın.
  Süresi dolan token'ı otomatik yenile.
- Client ID'leri bir yapılandırma dosyasında (`sync/config.js`) tutulan yer tutucu değerler olsun.
  Benim her sağlayıcıda (Google Cloud, Microsoft Entra, Dropbox App Console) hangi uygulamayı,
  hangi izinlerle, hangi yönlendirme adresleriyle oluşturmam gerektiğini adım adım anlatan
  `SETUP-OAUTH.md` yaz.
- Sadece gerekli en dar izinleri iste (bölüm 2'deki kapsamlar).

## 6. İsteğe bağlı uçtan uca şifreleme (tüm uzak modlar için)
Ayarlarda açılıp kapatılan bir seçenek: kullanıcının parolasından (PBKDF2 ya da Argon2 benzeri,
WebCrypto'da mevcut olanı kullan) türetilen anahtarla AES-GCM ile dosyayı şifrele, tuz ve nonce
dosyanın başlığında dursun. Parola eklentide saklanmasın (oturum boyunca bellekte ya da kullanıcı
isterse yerelde). Açıkça uyar: parola kaybolursa bulut verisi kurtarılamaz. İkinci cihazda aynı
parola istensin. Bu aşama en sona kalsın.

## 7. Kendi sunucu modu
- **WebDAV** (Nextcloud, ownCloud vb.): URL, kullanıcı adı, uygulama parolası. `PROPFIND`/`GET`/`PUT`
  ve `If-Match` ile çalış.
- **Basit HTTP uç noktası**: URL + Bearer anahtarı, `GET /vault` (200 + gövde + `ETag`, 404 yoksa),
  `PUT /vault` (`If-Match` desteğiyle, 412 çakışmada). Bu protokolü `docs/self-hosted.md` dosyasında
  anlat ve küçük bir örnek sunucu (Node, tek dosya) ekle ki kullanıcı kendi sunucusunu kolayca kursun.
- Kullanıcının girdiği adres için izni **çalışma anında** iste (`optional_host_permissions` ve
  `permissions.request`), geniş host izni verme. Sadece `https` kabul et (localhost hariç).
  Kimlik bilgileri `storage.local`'da dursun.

## 8. Gizlilik ve yayın
- `PRIVACY.md`, AMO `data_collection_permissions` beyanı ve mağaza açıklaması bu özelliği doğru
  yansıtsın: veri yalnızca kullanıcının seçtiği hesaba/sunucuya gider, bende toplanmaz.
- Manifest'e gereken izinleri (`identity`, `alarms`, sağlayıcı alan adları için `host_permissions`
  ya da isteğe bağlı izinler) ekle, her birinin gerekçesini README'ye yaz. Gereksiz izin isteme.
- Üçüncü taraf API verisinin kullanımı için Google/Microsoft/Dropbox'ın güncel geliştirici
  politikalarına uyduğunu kontrol et ve README'de belirt.

## 9. Testler
Node'un yerleşik `node:test` modülüyle (bağımlılık eklemeden) şunları yaz ve çalıştır:
- Birleştirme: değişme/birleşme/tekrar uygulama özellikleri (rastgele kayıt kümeleriyle).
- İki cihaz simülasyonu: bellek içi sahte sağlayıcıyla A ve B cihazı, sırayla ve aynı anda
  değişiklik yapıp eşitlesin, her koşulda aynı duruma yakınsasın.
- Silme: bir cihazda silinen kelime diğerine geçsin ve geri gelmesin; silmeden sonra yeniden
  ekleme doğru çalışsın; 90 günlük temizlik.
- İlk bağlanma: yerelde 50 kelime + bulutta farklı 50 kelime, sonuç 100'ü bulsun. İki cihaz aynı
  anda ilk kez bağlanınca iki dosya oluşursa tek dosyaya inmesi.
- `storage.sync` parçalama/sıkıştırma gidiş-dönüşü ve fazla parça temizliği.
- Çakışma hatası (412/409) sonrası yeniden deneme. Gerçek bulut anahtarıyla test yazma.
- `npx web-ext lint` çalıştır ve temiz geçsin.

## Çalışma şekli
Aşamalı ilerle, her aşamadan sonra dur, nasıl test edeceğimi söyle, aşama başına bir commit at:
1. Veri modeli, birleştirme, tombstone + testler (sağlayıcısız)
2. Sağlayıcı arayüzü, eşitleme motoru, bellek içi sahte sağlayıcı, iki cihaz testleri
3. Ayarlar arayüzü (bölüm 1), `storage.sync` modu, durum göstergesi, i18n
4. Google Drive (OAuth + appDataFolder + bul-ya-da-oluştur), `SETUP-OAUTH.md`
5. OneDrive ve Dropbox
6. Kendi sunucu modu (WebDAV + HTTP uç noktası + örnek sunucu)
7. İsteğe bağlı şifreleme, gizlilik belgeleri, lint ve son kontroller

Belirsiz bir şey olursa makul bir varsayım yap, varsayımı kodda yorum olarak ve aşama sonu
özetinde belirt. Mevcut çalışan özellikleri bozma, her aşamada eski testler geçmeli.
