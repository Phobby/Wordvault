# Wordvault: Video altyazılarında kelimenin üzerine gelince çeviri (YouTube öncelikli)

Önce mevcut kodu, SPEC.md (2. bölüm "Altyazılar" ve 5. aşama), QUIZ-SPEC.md ve SYNC-SPEC.md'yi oku.
Altyazı hover'ından bir kısmı yazılmış olabilir: ne var ne yok çıkar, varsa üzerine geliştir,
yeniden yazma. Mevcut çeviri açılır penceresini, "Kasaya ekle" akışını, önbelleği (7 gün kuralı),
sağlayıcı arayüzünü ve Shadow DOM kuralını **aynen yeniden kullan**.

## Mimari kural: özellikleri birbirinden ayır
Bu özellik kendi klasöründe yaşasın (`features/captions/`). İleride ayrı bir "ekran görüntüsü/OCR"
özelliği eklenecek ve aynı hover/baloncuk hattını kullanacak. Bu yüzden ortak parçaları
özellikten bağımsız yaz (`core/hover/` ve `ui/popup`):
- `WordSource` arayüzü: bir ekran noktasından kelimeyi (metin, aralık/kutu, çevresindeki tam
  satır/cümle, ekran dikdörtgeni) bulan ve kapanma olaylarını bildiren küçük sözleşme.
  Altyazı bunu DOM tabanlı uygular, OCR sonra kendi uygulamasını ekler.
- Baloncuk, "Kasaya ekle", bağlam saklama, çeviri ve önbellek bu sözleşmeye bağımlı olsun,
  altyazıya özgü olmasın.
Bu yapıyı kur ama OCR kodu yazma.

## İstediğim davranış
Video oynarken ya da durdurulmuşken altyazıdaki bir kelimenin üzerine gelince küçük bir baloncukta
çıksın: çeviri, kelime türü, telaffuz düğmesi, **"Kasaya ekle"**, **"Satırı çevir"** (tüm altyazı
satırının çevirisini aynı baloncukta göster). Çift tıklama ve metin seçimiyle çok kelimelik ifade
çevirisi de çalışsın. Hiçbir uyarı (ör. "metin zaten hedef dilde") çeviriyi ya da "Kasaya ekle"
düğmesini engellemesin, sadece küçük bir not olarak görünsün.

## Tetikleme ve oynatma (ayarlarda "Altyazılar" bölümü)
- Tetikleme: **Üzerine gel** (~150 ms gecikme, varsayılan), **Ctrl + üzerine gel**, **Çift tıkla**.
- **Videoyu otomatik duraklat:** Hover'da oynuyorsa duraklat, baloncuk kapanıp imleç altyazıdan
  ayrılınca **yalnızca bizim duraklattığımız** videoyu devam ettir (kullanıcı kendi elle
  duraklattıysa dokunma). Varsayılan açık, kapatılabilsin.
- Tarayıcı `commands` kısayolları (kullanıcı tarayıcıdan yeniden atayabilir): altyazı özelliğini aç/kapat,
  "Videoyu duraklat ve geçerli satırı çevir", "Son altyazılar panelini aç".
- Özelliği tamamen aç/kapat ve site bazlı kapatma.

## Teknik yaklaşım
1. **Kelimeyi imleç konumundan bul, altyazı DOM'unu değiştirme.** Altyazı container'ı içinde
   `mousemove` dinle (`requestAnimationFrame` ile sınırla), `document.caretPositionFromPoint`
   (yoksa `caretRangeFromPoint`) ile imlecin altındaki metin düğümü ve konumu al. Kelime sınırlarını
   `Intl.Segmenter` (granularity "word") ile bul ki boşluksuz yazılan diller çalışsın. Kelimeyi
   sayfaya dokunmadan CSS Custom Highlight API ile vurgula (desteklenmiyorsa vurgusuz devam et).
   Altyazıyı `<span>`'lara bölme: YouTube satırları sürekli yeniden çizer.
2. **Kararlı vuruş:** Baloncuk açılınca o anki kelimeyi ve satırı **dondur** (kopyala). Altyazı
   altta yenilense bile baloncuk, kullanıcı imleci uzaklaştırana kadar kapanmasın ve yanlış kelimeye
   atlamasın. Kelimeden baloncuğa geçerken kısa bir "grace" süresi kullan.
3. **Kaynak dili satırdan algıla:** Tek kelimeden dil algılama güvenilmez. Dili ayarlardaki kaynak dilden
   al, "otomatik" ise **tüm altyazı satırından** algıla ve videonun dili olarak o video için
   hatırla. Kullanıcı elle seçtiyse seçimi kullan.
4. **YouTube ayrıntıları** (seçicileri gerçek sayfada doğrula: ağ erişimin ya da başsız tarayıcın
   varsa gerçek bir videoda DOM'u incele, yoksa "doğrulanmadı" diye not düş):
   - Altyazı pencereleri (`.ytp-caption-window-container`, `.ytp-caption-segment` ve türevleri).
   - **Otomatik oluşturulan altyazılar:** Kelime kelime büyüyen, kayan iki satırlı yapı. Tekrarlanan
     metni tek satıra indirge, yarım kalmış satırı çeviri için bekleyip tamamlanınca kullan.
   - YouTube'un otomatik çevirdiği altyazılar, kullanıcının sürüklediği altyazı penceresi, kullanıcı
     altyazı stilleri (boyut, arka plan), çok parçalı satırlar, `♪` ve `[Music]` gibi
     açıklamalar (kelime olarak sayma), konuşmacı etiketleri.
   - **SPA gezinmesi:** `yt-navigate-finish` ve oynatıcıyı izleyen `MutationObserver` ile video
     değişince yeniden başlat. Shorts ve mini oynatıcıyı dene, çalışmıyorsa devre dışı bırak ve belirt.
   - **Gömülü oynatıcılar:** `youtube.com/embed/*` için `all_frames`.
5. **Tam ekran:** Baloncuk ve katmanlar `document.fullscreenElement` içinde de görünmeli;
   `fullscreenchange` ile taşı. Baloncuk oynatıcı kontrollerini ve altyazıyı kapatmasın. Baloncuk
   üzerindeyken fare/tıklama videoya gitmesin, oynatıcı kısayolları çalışmaya devam etsin.
6. **Satır geçmişi (isteğe bağlı aşama):** Son 10-20 benzersiz altyazı satırını bellekte tut. "Son
   altyazılar" paneli (duraklatılınca/kısayolla açılır) satırları gösterip içindeki kelimeleri
   tıklanır yapsın. Böylece kaçırılan kelimeye geri dönülebilir. Kalıcı kaydetme, yalnızca bellek.
7. **Bağlam ve kaydetme:** Kaydederken tam altyazı satırını bağlam olarak sakla (SYNC-SPEC alan
   sınırlarına uy). Video kimliği ve zaman damgasını **yalnızca yerel** sakla (senkronlanmasın).
   Kelime detayında "Duyduğum sahneye git" bağlantısı; aynı videodaysa oynatıcıyı o saniyeye sar.
8. **Performans:** `mousemove` yalnızca altyazı container'ı içinde işlensin. Aynı kelime için art arda
   API çağrısı yapma (önbellek). Hover, oynatmayı yavaşlatmasın.
9. **Gizlilik ve sınırlar:** Yalnızca hover edilen kelime ve satır seçilen çeviri servisine gider.
   Altyazı akışını kaydetme ya da indirme özelliği ekleme.
10. **Sağ-sola yazılan diller** (Arapça, İbranice) için baloncuk yönü ve konumu doğru çalışsın.

## Site bağdaştırıcıları
`features/captions/adapters/` altında: `youtube.js` (öncelik), `generic.js`. Tüm seçiciler tek
yapılandırma dosyasında (`selectors.js`) toplansın, siteler değişince tek yerden güncellensin.
- `generic.js`: HTML5 `<video>` `textTracks` (WebVTT) varsa parçayı `hidden` modunda okuyup altyazıyı
  **kendi Shadow DOM katmanında** çiz ve aynı hover mantığını uygula. Kullanıcı ayarlardan özel
  site + CSS seçici ekleyebilsin (`optional_host_permissions` ile çalışma anında izin iste).
- Netflix ve benzeri siteler **son aşama, isteğe bağlı**: çalışmayan ya da DRM nedeniyle
  erişilemeyenleri sessizce atla.

## Tanı paneli (YouTube arayüzü değişince hızlıca teşhis için)
Ayarlarda "Altyazılar > Tanı" bölümü: altyazı container'ı bulundu mu, hangi seçici eşleşti, son
okunan satır, algılanan dil, video kimliği, baloncuk neden açılmadı (ör. "Ctrl basılı değil",
"özellik site için kapalı"), "Şimdi test et" düğmesi (zamanlayıcı/koşulları atlayıp baloncuğu
göster). Sessiz hatalar kullanıcıya görünsün.

## Manifest ve izinler
`content_scripts` eşleşmelerini gereksiz genişletme: YouTube için ayrı eşleşme (`all_frames`, embed
dahil). Her iki manifest (Chrome, Firefox) güncellensin, `commands` ekle, gereksiz izin ekleme,
her iznin gerekçesini README'ye yaz. Metinler `_locales` ile çok dilli (en, tr).

## Testler ve doğrulama
- `node:test` ile: imleçten kelime çıkarma (sahte DOM/Range; Latin, boşluksuz ve sağdan sola dil
  örnekleri), kelime sınırları, otomatik altyazı tekrarlarını indirgeme, satır dondurma mantığı,
  duraklat/devam (yalnızca biz duraklattıysak devam eder), tetikleme modları, dil algılama
  (satırdan), satır geçmişi, seçici yapılandırması.
- Çevrimdışı çalışan bir **sahte sayfa** hazırla: YouTube altyazı DOM'unu (kelime kelime büyüyen
  otomatik altyazı ve yeniden çizim dahil) taklit etsin. Playwright ile yüklü eklenti üzerinde
  hover'da baloncuğun çıktığını, altyazı yeniden çizilince bozulmadığını, tam ekranda göründüğünü
  otomatik doğrula.
- `npx web-ext lint` temiz geçsin, eski testler geçsin.
- Bana gerçek YouTube'da nasıl deneyeceğimi adım adım yaz (oynarken, durdurulmuşken, otomatik
  altyazı, tam ekran, video değişince, Shorts, Chrome ve Zen/Firefox ayrı ayrı) ve neyin
  doğrulanamadığını açıkça belirt.

## Çalışma şekli
Aşamalı ilerle, her aşamadan sonra dur, nasıl test edeceğimi söyle, aşama başına commit at:
1. Mevcut durum raporu, ortak `WordSource`/baloncuk mimarisi, imleç tabanlı kelime bulma + YouTube
   bağdaştırıcısı
2. Kararlı vuruş, otomatik altyazı tekrarları, tam ekran, SPA gezinmesi, duraklat/devam, tetikleme
   modları
3. "Satırı çevir", dil algılama, bağlam ve "sahneye git"
4. Ayarlar, tanı paneli, `commands` kısayolları
5. Satır geçmişi paneli, genel `textTracks` bağdaştırıcısı
6. (İsteğe bağlı) Netflix ve benzeri siteler, son testler ve lint
Belirsiz yerde makul varsayım yap ve belirt. Mevcut çalışan özellikleri bozma.
