# Wordvault: Ekrandan metin tarama (OCR) ve üzerine gelince çeviri

Önce mevcut kodu, SPEC.md, CAPTIONS-SPEC.md ve diğer SPEC dosyalarını oku. Bu özellik altyazı
özelliğinden **ayrı** bir özelliktir ve `features/screen-ocr/` altında yaşar. Altyazı davranışını
değiştirme. Ortak parçaları yeniden kullan: `core/hover` içindeki `WordSource` sözleşmesi,
`ui/popup` baloncuğu, "Kasaya ekle", bağlam saklama, çeviri sağlayıcısı, önbellek, Shadow DOM
kuralı, `_locales` (en, tr). `WordSource` henüz yoksa CAPTIONS-SPEC'teki tanıma uygun oluştur.

## İstediğim davranış
1. Kullanıcı bir **kısayola** basar (tarayıcı `commands` ile, kullanıcı yeniden atayabilir; araç
   çubuğu menüsünde ve sağ tık menüsünde "Ekrandan metin tara" da olsun).
2. Sayfa hafifçe kararır, imleç artı olur, kullanıcı **fareyle bir tarama alanı (dikdörtgen)
   sürükler**. Alan sürüklendikten sonra kenarlarından ayarlanabilsin. `Enter` ya da çift tıklama
   tüm görünür ekranı tarar, `Esc` iptal eder. Son seçilen alanı hatırlama ayarı olsun.
3. Alan seçilince sekmenin ekran görüntüsü alınır, seçilen alan kırpılır, **cihazda** OCR'dan geçer.
   Bu sırada ilerleme göstergesi çıkar (ilk kullanımda dil verisi iner).
4. Sonuç, orijinal görüntünün **tam üstüne** oturan, görünmez ama seçilebilir bir metin katmanı olarak
   gösterilir (PDF'deki metin katmanı gibi). Metin otomatik olarak **kelime, satır ve blok (paragraf)**
   olarak parçalanır. Fare bir kelimenin üzerine gelince kelime vurgulanır ve çeviri baloncuğu açılır.
   Baloncukta "Kasaya ekle" ve "Satırı çevir" (ve "Bloğu çevir") olur. Birden fazla kelimeyi sürükleyerek
   seçip ifade olarak çevirebilmeli.
5. OCR hatalı okuduysa kullanıcı kelimeye tıklayıp **düzeltebilsin** (satır içi düzenleme), düzeltilmiş
   metin çevrilsin ve bağlam olarak o saklansın.
6. Video üzerinde kullanılıyorsa, ayarlanabilir seçenekle videoyu otomatik duraklat ve kapatınca,
   yalnızca bizim duraklattığımız videoyu devam ettir (altyazı özelliğindeki mantığı yeniden kullan).
7. `Esc` ya da kapat düğmesi katmanı kaldırır. Görüntüyü hiçbir yerde saklama, OCR bitince belleğe
   ayrılan görüntü kaynaklarını serbest bırak.

## Ekran görüntüsü alma
- Kısayol/menü gibi kullanıcı eylemiyle tetiklenen `tabs.captureVisibleTab` kullan, izin olarak
  `activeTab` (her sitede sürekli okuma izni isteme). Chrome ve Firefox farklarını doğrula.
- Seçim arayüzünü **ekran görüntüsünden önce** gizle (bir iki kare bekle), yoksa kararan katman
  görüntüye girer.
- **Koordinat eşleme:** Görüntü piksel boyutu ile sayfa CSS pikseli arasındaki oranı
  (`devicePixelRatio`, tarayıcı yakınlaştırması, `visualViewport`) doğru hesapla. Kutuların sayfada
  kelimelerin tam üstüne oturduğunu farklı yakınlaştırma düzeylerinde ve yüksek DPI ekranda test et.
- `captureVisibleTab` hız sınırına dikkat et (art arda çağrılarda hata ver, kullanıcıya anlaşılır
  mesaj göster).
- Başarısız durumlar kullanıcıya açıkça söylensin: yasak sayfalar (`chrome://`, mağaza sayfaları vb.),
  **DRM'li videoda siyah kare** (görüntünün seçilen alanı neredeyse tamamen siyah/tekdüze ise "Bu içerik
  ekran görüntüsüne izin vermiyor olabilir" de), metin bulunamadı.

## OCR motoru: arayüzün arkasında, değiştirilebilir
`features/screen-ocr/engines/` altında ortak bir arayüz yaz:
`init(lang, onProgress)`, `recognize(image, options) -> { words:[{text, bbox, confidence, lineId,
blockId}], lines, blocks }`, `terminate()`, `listLanguages()`, `dataSize(lang)`.
- **Varsayılan: Tesseract.js** (Apache-2.0, 100+ dil, WebAssembly). Güncel sürümü ve kelime/satır/blok
  kutularının hangi çıktı seçeneğiyle alındığını güncel belgeden doğrula. Dil verisi ilk kullanımda iner,
  tarayıcıda kalıcı önbelleğe (IndexedDB) alınır, çevrimdışı çalışır. Ayarlarda hangi dil verilerinin
  inip toplam boyutunu gösteren ve **silebilen** bir bölüm olsun.
- **Deneysel ikinci motor: PaddleOCR** (örn. `ppu-paddle-ocr` + `onnxruntime-web`, MIT; WebGPU ya da
  WASM). Tarayıcı eklentisinde gerçekten çalışıp çalışmadığını **kendin dene** ve sonucu raporla (bazı
  kaynaklar tarayıcıda hata verdiğini söylüyor). Modelleri kalıcı olarak kendin önbelleğe al. Çalışmazsa
  motoru devre dışı bırak ve nedenini yaz.
- Ayarlarda "OCR motoru" seçimi olsun. Varsayılan değişikliği ancak kıyaslama sonucuna göre öner.
- **Ön işleme** (motor bağımsız modül): metin küçükse görüntüyü 2-3 kat büyüt (yüksek kaliteli yeniden
  örnekleme), gri tonlama, kontrast artırma, açık renk üzerinde koyu / koyu üzerinde açık metin
  için gerekirse ters çevirme (iki aday deneyip güven puanı yüksek olanı seç), isteğe bağlı eşikleme.
  Altyazı gibi dış çizgili (outline) beyaz metin için ayrı bir ön işleme profili dene.
- **Güven filtresi:** Düşük güvenli kelimeleri ayarlanabilir eşikle sönük göster ya da gizle.
- Dil: Ayarlardaki kaynak dili OCR dil koduna eşle (BCP-47 -> Tesseract kodu), çoklu dil
  (`eng+tur` gibi) seçilebilsin. Otomatik algılama zayıf olduğundan "otomatik" modda son kullanılan dil
  + İngilizce dene.
- **Çalıştırma yeri:** Ağır işi sayfadan ayrı, eklentinin kendi bağlamında yap (Chrome:
  `offscreen` belgesi; Firefox: arka plan sayfası). Sayfa betiği ile mesajlaş. Worker'ı kullanımdan
  sonra ~60 sn canlı tut, sonra sonlandır (bellek).
- **Paketleme:** MV3'te uzaktan kod yüklenemez. Kütüphane, WASM ve çalışan (worker) dosyalarını
  **değiştirmeden** `vendor/` altına koy, sürümlerini sabitle, lisans dosyalarını ekle, sağlama
  toplamlarını yaz. Gerekirse manifest CSP'sine `wasm-unsafe-eval` ekle (Firefox'ta gerekip
  gerekmediğini doğrula). Ana kodu düz JS tut, bundler zorunlu olursa gerekçelendir.

## Gizlilik
Görüntü cihazdan çıkmaz ve saklanmaz. Hover edilen kelime/satır dışında hiçbir şey çeviri servisine
gitmez. Bulut OCR ekleme. Gizlilik politikasına ve mağaza beyanlarına bu özelliği yaz.

## Ayarlar ("Ekrandan metin tara" bölümü)
Özelliği aç/kapat, kısayol hatırlatması (tarayıcı kısayol sayfasına yönlendir), OCR motoru, kaynak
dil(ler), güven eşiği, videoyu otomatik duraklat, son alanı hatırla, indirilen dil verileri
(boyut, sil), tanı paneli: son tarama süresi, motor, algılanan kelime sayısı, ortalama güven, görüntü
boyutu ve oran, hata nedeni.

## Manifest ve izinler
Gereken en az izin: `activeTab`, `commands`, Chrome için `offscreen`, mevcut `storage`/`unlimitedStorage`.
Gereksiz izin ekleme, her iznin gerekçesini README'ye yaz. Her iki manifest (Chrome, Firefox) güncellensin.

## Kıyaslama aracı (motoru tahminle değil ölçerek seç)
`npm run bench:ocr` ile çalışan bir araç yaz:
- Çevrimdışı sahte test görüntüleri üret: farklı yazı tipleri ve boyutları (12-32 px), açık/koyu
  zemin, dış çizgili altyazı tarzı, JPEG sıkıştırma kalıntısı, hafif eğiklik ve gürültü; İngilizce,
  Türkçe, Almanca, İspanyolca ve bir CJK örneği.
- `bench/frames/` klasörüne (gitignore'da) benim koyduğum gerçek video kareleri ve yanlarındaki
  `.txt` gerçek metin dosyalarını da okuyabilsin.
- Her motor için kelime doğruluğu (Levenshtein tabanlı), süre (soğuk başlangıç ve sıcak ayrı), model
  boyutu, bellek. Sonucu `bench/RESULTS.md` tablosuna yaz ve hangi motorun hangi koşulda iyi
  olduğunu özetle. Rakamları uydurma, yalnızca ölçtüklerini yaz.

## Testler
- `node:test`: koordinat eşleme (farklı oran ve yakınlaştırma), kutuların kelime/satır/blok gruplama
  mantığı, güven filtresi, ön işleme çıktı boyutları, dil kodu eşleme, siyah kare algılama, düzeltme
  akışı, WordSource sözleşmesi (altyazı ile ortak testler geçmeye devam etsin).
- Playwright ile yüklü eklenti üzerinde sahte bir sayfada: kısayol -> alan seçimi -> OCR -> hover ->
  baloncuk -> kasaya ekleme uçtan uca (Chrome; Firefox'ta mümkün olanı).
- `npx web-ext lint` temiz geçsin, eski testler geçsin, paket boyutunu raporla.

## Çalışma şekli
Aşamalı ilerle, her aşamadan sonra dur, nasıl test edeceğimi söyle, aşama başına commit at:
1. Kısayol, alan seçimi, ekran görüntüsü, koordinat eşleme, sahte (mock) motorla katman iskeleti
2. Motor arayüzü + Tesseract.js (worker, dil verisi, önbellek, ilerleme), ön işleme, kelime/satır/blok
3. WordSource entegrasyonu: hover -> baloncuk -> kasaya ekle, kelime düzeltme, satır/blok çevirisi,
   ifade seçimi, video duraklatma
4. Ayarlar, tanı paneli, hata durumları (DRM, yasak sayfalar, metin yok)
5. Kıyaslama aracı + PaddleOCR denemesi + sonuç raporu ve varsayılan motor önerisi
6. Cilalama, testler, lint, paket boyutu raporu
Belirsiz yerde makul varsayım yap ve belirt. Mevcut çalışan özellikleri bozma.
