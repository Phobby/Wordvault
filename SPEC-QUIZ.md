# Wordvault: Flash card (quiz) sistemini düzelt ve akıllı hale getir

Önce mevcut kodu, SPEC.md'yi ve varsa SYNC-SPEC.md'yi oku, mevcut yapıya uy (storage şeması,
build.js, iki manifest, Shadow DOM kuralı, sync birleştirme kuralları).

## Sorun
Kasaya çok sayıda kelime ekledim ama quiz hiçbir kelimeyi bana hiç sormadı. Önce **kök nedeni
bul**, tahminle yama yapma. Olası sebepler: arka plan zamanlayıcısı (`chrome.alarms`) hiç
kurulmuyor ya da MV3'te arka plan betiği uyuyunca kayboluyor, kart sayısı eşiği yanlış
hesaplanıyor, quiz'i gösteren içerik betiği sayfaya enjekte edilmiyor ya da mesaj ulaşmıyor,
"video oynarken/yazı yazarken gösterme" koşulları hep engelliyor, ayar anahtarı varsayılan olarak
kapalı geliyor, aktif sekme bulunamıyor. Bulduğun nedeni aşama sonu özetinde yaz.

Ayrıca bu tür sessiz hataları kullanıcının görebilmesi için **"Neden quiz çıkmıyor?" tanı paneli**
ekle (ayarlarda Flash card bölümünde): quiz açık mı, kasada kaç kart var, kaçı sorulabilir,
sıradaki quiz ne zaman planlı, en son quiz neden gösterilmedi (ör. "video oynuyor", "yazı
yazılıyor", "kart sayısı eşiğin altında", "sekme aktif değil"). Yanında **"Şimdi test et"** düğmesi
olsun: zamanlayıcıyı ve koşulları atlayıp quiz'i hemen gösterir.

## Quiz davranışı
- Quiz, sayfanın **sağ üstünde** küçük bir kart olarak çıkar (Shadow DOM, sayfa CSS'i ile
  çakışmaz, sayfa içeriği değişmez).
- Kasadaki bir kelimeyi gösterir, **ayarlardaki hedef dilde karşılığını 4 şıkla** sorar.
- **Yanlış şıklar, kullanıcının kasasındaki diğer kelimelerin anlamlarından** seçilir:
  - Aynı hedef dildeki kayıtlı çevirilerden rastgele al.
  - Doğru cevapla aynı ya da çok benzer şıkları, aynı kelimenin diğer anlamlarını ve tekrar eden
    şıkları ele. Mümkünse kelime türü ve metin uzunluğu doğru cevaba yakın olanları tercih et ki
    şıklar kolay elenemesin ("daha karışık olsun").
  - Şık sırası her seferinde rastgele olsun.
  - Kasada 4 farklı anlam yoksa (4'ten az benzersiz çeviri) quiz çıkmasın ve tanı panelinde nedenini
    göster.
- Cevaptan sonra doğru/yanlış geri bildirimi (yanlışsa doğru cevabı vurgula) birkaç saniye göster,
  sonra kapat. Düğmeler: **"Bilmiyorum"** (yanlış sayılır), **"Sonra sor"** (cezasız, kartı kısa
  süre sonraya erteler) ve kapat. Cevaplanmadan zaman aşımına uğrarsa (varsayılan 30 sn, ayarlanır)
  "atlandı" sayılır: cezasız, kart kısa süre sonra tekrar sorulur.
- Cevap süresi, şıklar **ekranda göründüğü andan** tıklamaya kadar ölçülür. Sekme gizli ya da
  odak dışındayken geçen süre sayılmasın (`visibilitychange` ile durdur/devam).
- Quiz yalnızca **aktif pencerenin aktif sekmesinde** çıksın (aynı anda birden fazla sekmede
  çıkmasın). Video oynarken, tam ekranda, kullanıcı bir yazı alanına yazarken ya da çeviri
  penceresi açıkken çıkmasın. Engellenirse atlama, birkaç dakika sonra yeniden dene.

## Öğrenme eğilimini algılama (cevap doğruluğu + hız)
Basit, açıklanabilir bir uyarlanabilir aralıklı tekrar yaz, aşırı mühendislik yapma. Her kart için
saklanacaklar (anahtar adlarını kısa tut, sync şemasına uy): deneme sayısı, doğru serisi, kolaylık
katsayısı (ease), sıradaki zaman (due), hata (lapse) sayısı, ortalama cevap süresi (üstel
hareketli ortalama), zorluk skoru (0-1), son güncelleme zamanı.

- **Cevap kalitesi:** Doğruluk ve hızı birlikte değerlendir. Hız eşiği sabit olmasın, kullanıcının
  **kendi doğru cevap sürelerinin hareketli medyanına** ve şık metninin uzunluğuna göre
  ayarlansın (başlangıç değeri ~4 sn). Kabaca: yanlış / çok yavaş doğru (tereddüt ya da tahmin
  sayılır) / yavaş doğru / normal doğru / hızlı doğru. SM-2'deki 0-5 kalite ölçeğine eşle.
- **Planlama:** Yanlış ya da çok yavaş cevapta kart "öğreniliyor" aşamasına geri döner, kolaylık
  katsayısı düşer, kart kısa süre sonra (varsayılan ~10 dk ve birkaç soru sonra) yeniden sorulur.
  Doğru cevaplarda aralık kolaylık katsayısı ve kaliteye göre büyür (10 dk, 1 gün, 3 gün, 7 gün, ...),
  hızlı doğrularda daha çok, yavaş doğrularda daha az. Sayıları kodda yorumla ve tek yerde sabit
  olarak tut ki ayarlanabilsin.
- **Soru seçimi:** Hiç sorulmamış (yeni) kartlar hemen sorulabilir sayılır. Vadesi gelmiş kartlar
  arasında seçimi **ağırlıklı rastgele** yap: gecikme oranı ve zorluk skoru ağırlığı artırsın, yani
  **zor ve öğrenilemeyen kartlar daha sık sorulsun**. Aynı kart art arda sorulmasın. Vadesi gelmiş
  kart yoksa ayarlara bağlı davran: "Vadesi gelmemiş kartlardan da sor" seçeneği (varsayılan açık)
  açıksa en zor ya da en uzun süredir sorulmamış kartı seç, kapalıysa quiz çıkmasın.
- Kartlar "yeni / öğreniliyor / öğrenildi / zor" durumlarına ayrılsın. Durum, kasa popup'ında ve
  kelime detayında görünsün (doğruluk yüzdesi, ortalama cevap süresi, hata sayısı).
- Senkron: kart istatistikleri kasa verisinin parçasıdır, bulut/`storage.sync` birleştirmesinde
  `updatedAt` kuralıyla birleşsin. Senkron boyutunu şişirmemek için cevap geçmişini tutma, sadece
  özet alanları sakla.

## Ayarlar sayfasında "Flash card" bölümü
- **Quiz'i aç/kapat** ana anahtarı. Kapalıyken hiçbir quiz çıkmaz ve zamanlayıcı çalışmaz.
- **Soru sıklığı:** ön ayarlar (5 dk, 10 dk, 15 dk, 30 dk, 1 saat, 2 saat, 4 saat) + özel süre
  girişi. Değişince zamanlayıcı hemen yeniden kurulur.
- Minimum kart sayısı (varsayılan 10), cevap zaman aşımı (varsayılan 30 sn), "vadesi gelmemişleri
  de sor", günlük en fazla soru sayısı (isteğe bağlı sınırsız), sessiz saatler (isteğe bağlı).
- Tanı paneli ve "Şimdi test et" düğmesi (yukarıda).
- Zamanlayıcıyı `chrome.alarms` ile kur, MV3'te arka plan betiği uyuyup uyanabilir: durumu
  (`sonrakiQuizZamani`) `storage.local`'da tut, tarayıcı açılışında ve uyanışta alarmı yeniden
  kur. Zamanı geçmiş quiz'i bir sonraki uygun anda göster, üst üste yığılmasın.
- Arayüz metinleri `_locales` ile çok dilli (en, tr).

## Manuel çalışma
Popup'taki **"Şimdi çalış"** modu aynı algoritmayı ve aynı şık üretimini kullansın, süre sınırı ve
günlük limit olmadan sürekli kart sorsun. Cevaplar yine istatistiklere işlensin.

## Testler
Node'un yerleşik `node:test` modülüyle (bağımlılık eklemeden):
- Planlayıcı: aynı kart için yanlış, yavaş doğru, hızlı doğru sonrası aralık ve ease değişimi
  beklenen sırada olsun (hızlı doğru > normal > yavaş > yanlış).
- Soru seçimi: tohumlu rastgele ile zor kartların daha sık seçildiğini, aynı kartın art arda
  gelmediğini ve yeni kartların hemen sorulabildiğini doğrula.
- Şık üretimi: her zaman 4 benzersiz şık, doğru cevap tam bir kez bulunur, yinelenen çeviri ve aynı
  kelimenin diğer anlamları şık olarak çıkmaz, 4'ten az benzersiz anlamda üretici hata vermeden
  "yetersiz" döner.
- Hız eşiği: kullanıcı medyanına göre uyarlanır, tek bir uç değer eşiği bozmaz.
- Zamanlayıcı: sıklık değişince yeniden kurulur, kapalıyken kurulmaz (alarm API'si sahte
  nesneyle).
- `npx web-ext lint` temiz geçsin. Eski testler geçmeye devam etsin.

## Çalışma şekli
Aşamalı ilerle, her aşamadan sonra dur, nasıl test edeceğimi söyle, aşama başına bir commit at:
1. Quiz neden çıkmıyor: kök neden, düzeltme, tanı paneli + "Şimdi test et"
2. Veri modeli, öğrenme algoritması, soru seçimi, şık üretimi + testler
3. Quiz kartı arayüzü (sağ üst, Shadow DOM, süre ölçümü, düğmeler)
4. Ayarlar: Flash card bölümü, zamanlayıcı, aç/kapat
5. Kart durumları ve istatistikler (popup, kelime detayı), sync entegrasyonu
6. Manuel çalışma modu, cilalama, lint

Belirsiz bir şey olursa makul bir varsayım yap, varsayımı kodda yorum olarak ve aşama sonu
özetinde belirt. Mevcut çalışan özellikleri bozma.
