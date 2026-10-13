# Wordvault: çeviri önbelleği denetimi ve katmanlı önbellek

Wordvault'ta çeviri önbelleğini denetle, eksiklerini tamamla ve katmanlı bir önbellek yapısı kur. Önce
kodu oku ve bana raporla, sonra değişiklik yap. Mevcut çalışan özelliklere (kasa, quiz, altyazı, OCR,
senkronizasyon, sağ tık çevirisi, sağlayıcı seçimi) dokunma.

## Aşama 1: denetim (kod değiştirmeden önce raporla)

Şu soruları gerçek koda bakarak cevapla, tahmin etme:

1. Kasaya eklenmemiş kelime/cümle çevirileri önbelleğe yazılıyor mu? Nerede (storage.local, IndexedDB,
   bellek)?
2. Son kullanma süresi gerçekten 7 gün mü? Kayıtta zaman damgası var mı? Süre nerede kontrol ediliyor
   (okuma anında mı, düzenli temizlikte mi)?
3. Süresi dolmuş kayıtlar fiilen siliniyor mu, yoksa depolamada birikmeye devam ediyor mu? Düzenli
   temizlik (chrome.alarms veya benzeri) var mı?
4. "Bir hafta boyunca tekrar sorulmazsa silinir" davranışı var mı, yoksa kayıt ilk yazıldığı andan mı
   sayılıyor? Bu davranışın spesifikasyondaki (SPEC.md) tanımını bul ve koddakiyle karşılaştır. Fark
   varsa belirt.
5. Anahtar nasıl oluşturuluyor (kelime + dil çifti + sağlayıcı)? Büyük/küçük harf ve boşluk farklarını
   normalize ediyor mu?
6. Kasaya eklenen kelimelerin önbellekle ilişkisi nedir? Kasadaki kayıtlar yanlışlıkla temizlenebiliyor mu?
7. Önbelleğe örnek cümleler, söz türü gibi sözlük verisi de giriyor mu? Boyut üst sınırı var mı?
   Önbellek boyutu şu an kabaca ne kadar?
8. Önbellek senkronizasyona, yedeğe ya da JSON dışa aktarmaya sızıyor mu? Girmemeli.

Denetim sonucunu kısa bir tablo olarak ver: ne var, ne eksik, ne yanlış.

## Aşama 2: eksikleri tamamla

Denetimde eksik veya yanlış çıkanları düzelt:

- Önbellek yoksa ekle, 7 gün kuralı yoksa ekle. Kayıt "son erişim" zaman damgası tutsun ve yazılırken ya
  da okunurken güncellensin; böylece 7 gün tekrar sorulmayan kayıt silinir.
- Süresi dolmuş kayıtlar için düzenli temizlik ekle (chrome.alarms, günde bir kez ve eklenti
  uyandığında). MV3 service worker uyuduğu için durumu bellekte değil depolamada tut. Firefox'ta da
  çalıştığını doğrula.
- Önbelleğe toplam kayıt sayısı veya boyut üst sınırı koy (en eski erişilenden silen LRU mantığı), makul
  bir varsayılanla.
- Önbellek hiçbir koşulda senkronizasyona, yedeğe, dışa aktarmaya veya geri bildirim raporuna girmesin.
  Girdiği bir yer varsa kaldır.

## Aşama 3: katmanlı önbellek

Arama sırası: 1 → 2 → 3 → API. Sonuç bulununca üst katmanlara da yaz.

1. Content script içinde küçük bir bellek Map'i (LRU, yaklaşık 200 kayıt). Sayfa değişince kaybolması
   normal.
2. chrome.storage.session (tarayıcı kapanınca temizlenir, sekmeler arası ortak). Content script'in
   erişebilmesi için gerekirse setAccessLevel kullan. Firefox'ta storage.session desteğini ve sürüm
   gereksinimini kontrol et; desteklenmiyorsa bu katmanı atla ve nedenini raporla. MV3 service worker
   uyuyabileceği için service worker'daki değişkenleri önbellek olarak kullanma.
3. Mevcut 7 günlük kalıcı önbellek (storage.local veya IndexedDB).

Yeni katmanlar kalıcı verinin yerine geçmesin, sadece hızlı erişim için olsun. Katmanlar arası
tutarlılık: sağlayıcı veya hedef dil değişince ilgili önbellek kayıtlarının karışmaması gerekir
(anahtarda sağlayıcı ve dil çifti olsun).

Eklentiyi kapatıp açınca ve tarayıcıyı yeniden başlatınca hangi katmanın temizlendiğini ayarlardaki
küçük bir "Önbellek" bölümünde kısaca açıkla (kasaya dokunmadığını belirt) ve "Önbelleği temizle"
düğmesi koy.

## Aşama 4: istek optimizasyonu

Aşağıdakileri ekle (hover, çift tık, sağ tık çevirisi, altyazı ve OCR aynı yolu kullansın, ortak bir
modülde topla):

1. Eş zamanlı istek tekilleştirme: aynı anahtar için bekleyen bir istek varsa ikinci istek atma, aynı
   Promise'i paylaş.
2. Eski isteği iptal etme: kullanıcı başka kelimeye geçince önceki istek AbortController ile iptal
   edilsin. İptal edilen isteğin sonucu pencerede gösterilmesin ve önbelleğe yanlış yazılmasın.
3. Küçük bekleme (debounce): fare bir kelimenin üstünde kısa süre durmadan istek atılmasın (süreyi
   ayarlanabilir sabit yap, yaklaşık 150-250 ms, mevcut hover davranışıyla çakışmadan).
4. Anahtar normalizasyonu: küçük harfe çevirme (dile uygun, Türkçe İ/ı kurallarına dikkat),
   baştaki/sondaki boşluk ve noktalama temizleme, Unicode normalizasyonu (NFC). Anahtar: normalleştirilmiş
   metin + kaynak dil + hedef dil + sağlayıcı. Kasadaki orijinal yazım bozulmasın.
5. Başarısız sonuç önbelleği: hata/boş yanıtları 1-2 dakika tut (kota dolduğunda aynı istek
   tekrarlanmasın). Kullanıcıya gösterilen hata mesajını koru.

## Aşama 5: ölçüm ve test

- Önce ve sonra ölçüm yap: aynı kelimeyi ikinci kez çevirirken geçen süreyi (bellek, session, kalıcı,
  API) milisaniye cinsinden raporla. Kazanç ihmal edilebilir derecedeyse yeni katmanları sade tut ve bunu
  raporda söyle.
- Birim testleri: anahtar normalizasyonu (Türkçe İ/ı dahil), süre dolumu ve temizlik, LRU üst sınırı,
  istek tekilleştirme, iptal edilen isteğin önbelleği bozmaması, sağlayıcı değişince önbellek
  karışmaması, önbelleğin senkron/yedek/dışa aktarmaya girmemesi.
- Chrome ve Firefox'ta elle: aynı kelimeyi arka arkaya hızlı taratma, internet kapalıyken önbellekten
  cevap, tarayıcıyı kapatıp açınca session katmanının temizlenmesi, 7 günlük kuralı hızlandırılmış
  zamanla (test için süreyi kısaltarak) doğrulama.
- Sonunda şunları ayrı ayrı yaz: denetim bulguları, neyi değiştirdiğin, ölçüm sonuçları, gerçekten test
  ettiklerin ve test edemediklerin.
