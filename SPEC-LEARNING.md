# Wordvault: öğrenildi durumu, kelime haznem, streak, rütbeler ve yeni quiz modları

Wordvault'a iki büyük güncelleme yap: (1) öğrenme durumu, kelime haznem, streak ve rütbe sistemi, (2)
quiz'e iki yeni mod: yazma (writing) ve dinleme (listening). Önce QUIZ-SPEC.md, SYNC-SPEC.md ve mevcut
quiz/zamanlayıcı/kasa/senkronizasyon kodunu incele, mevcut yapıyı yeniden kullan. Önce kısa bir plan ve
veri modeli taslağı çıkar, sonra aşama aşama uygula. Mevcut çalışan özelliklere (kasa, altyazı, OCR, sağ
tık çevirisi, sağlayıcı seçimi, önbellek) dokunma. Her şey yerel çalışsın, hiçbir sunucuya veri
gönderilmesin.

## Bölüm A: quiz modları (yalnızca kasadaki kelimeler)

Quiz yalnızca kasaya eklenmiş kelimelerden oluşur. Önbellekteki kaydedilmemiş aramalar quiz'e girmez. Üç
mod olsun, ayarlardaki quiz bölümünden seçilebilsin: Klasik, Yazma, Dinleme ve "Karışık" (modları
sırayla/rastgele karıştırır). Her mod ayrı ayrı açılıp kapatılabilsin, varsayılan klasik+karışık olsun.

1. Klasik mod: şu an çalışan 4 şıklı mod aynı kalsın, şıkların diğer kayıtlı kelimelerin anlamlarından
   gelmesi korunsun.
2. Yazma modu:
   - Kullanıcının hedef dilindeki anlam gösterilir (örneğin "mavi"), kullanıcı kasadaki kelimeyi yazar
     (örneğin "blue").
   - Kontrol: büyük/küçük harf ve baştaki/sondaki boşluk önemsiz, Unicode normalizasyonu uygula. Aksan
     farkını (é/e gibi) ayarlardan "aksanlara toleranslı" seçeneğiyle aç/kapat yapılabilir yap
     (varsayılan kapalı, yani aksan hatası yazım hatası sayılır).
   - Yazım hatası yaparsa "hatalı" göster, doğru cevabı ve hangi harflerin yanlış olduğunu (küçük bir
     fark gösterimi) göster. Yanlış sayılsın.
   - İpucu düğmesi: her basışta bir harf daha açar (örneğin "b _ _ _"). İpucu kullanılan soru kısmen
     doğru sayılsın (zamanlayıcıya daha düşük başarı puanı olarak yansısın).
   - "Geç" düğmesi: cevabı gösterir, yanlış sayar ve sonraki karta geçer.
   - Kullanıcı Enter ile gönderebilsin, alan otomatik odaklansın, mobil olmayan masaüstü kullanımı için
     yeterli.
   - Birden fazla anlamı olan kelimeler için kasadaki ana çeviri esas alınır. Tek bir doğru cevap şartı
     sorun çıkarıyorsa (eş anlamlılar) bunu raporla.
3. Dinleme modu:
   - Boş bir kutu ve sağ tarafında hoparlör düğmesi. Tıklayınca kasadan rastgele seçilen kelime sesli
     okunur. Altta 4 şık görünür; şıklar ya kelimenin yazılışı ya da anlamıdır (ayarlanabilir, varsayılan
     anlam). Kullanıcı duyduğu kelimeye uygun şıkkı seçer.
   - Düğmeye tekrar basınca tekrar okunur. Soru açıldığında otomatik bir kez okunsun (ayarlanabilir).
   - TTS için mevcut seslendirme altyapısını kullan. Daha önce seslendirme sonunda yüksek bir patlama
     sesi olmuştu, bu hatanın dinleme modunda da tekrarlanmadığından emin ol (ses seviyesi, kesme/bitirme
     davranışı).
   - Kelimenin dilinde ses bulunmazsa (platforma göre değişir) kullanıcıya açıklayıcı bir mesaj göster,
     o kelimeyi dinleme modundan atla ve sonraki kelimeye geç.
   - Dinleme sorusunda cevaplanan kartın sonucu zamanlayıcıya yansısın.
4. Üç modun sonucu aynı uyarlanabilir zamanlayıcıya (SM-2 benzeri, hız ve doğruluk) beslesin. Her kartın
   modlar arası ayrı bir başarı geçmişi olsun, ama tek bir "öğrenme durumu" olsun. Yazma modundaki
   başarı, klasik moddakinden daha ağır sayılsın (çünkü hatırlama daha zor, tanıma daha kolay).

## Bölüm B: öğrenildi durumu ve kelime haznem

1. Bir kelime şu koşulda "öğrenildi" olur: üst üste N doğru cevap (varsayılan 5) ve bunlar en az 3 farklı
   takvim gününe yayılmış olsun. Yalnızca klasik modla öğrenilmiş sayma: en az bir doğru cevap yazma veya
   dinleme modundan olsun (ayarlardan kapatılabilir olsun).
2. Öğrenilen kelime silinmez. Tekrar aralığı çok uzar (örneğin 30 gün ve üstü), yani çok nadir sorulur.
   Öğrenilmiş bir kelimeyi yanlış yaparsa öğrenildi durumundan düşer ve tekrar sık sorulur.
3. Kasa sayfasına "Kelime haznem" sekmesi ekle: öğrenilen kelimeler, öğrenme tarihi, toplam sayı, arama
   ve filtre. Öğrenilenler ayrı bir görünümde olsun, kasadaki ana listeden silinmesin.
4. Öğrenildi durumu ve ilgili alanlar kasa kaydının parçası olsun ve senkronizasyon (SYNC-SPEC.md) ile
   birleştirilsin (updatedAt kuralı, mezar taşı), JSON dışa/içe aktarmaya girsin. Şemayı sürümle, eski
   verileri bozmadan taşı (migration) ve test et.

## Bölüm C: streak

1. "Günlük quiz": bir takvim günü içinde en az bir quiz oturumu tamamlanırsa o gün sayılır. Oturum
   tanımını sabit bir değere bağla (varsayılan: en az 5 soru cevaplanması, ayarlanabilir). Bu tanımı bana
   raporla.
2. Streak sayacı saklama: sayaç yerine "quiz çözülen günlerin" listesini tut (yerel tarih, YYYY-MM-DD)
   ve streak'i bu listeden hesapla. Böylece cihazlar arası senkronizasyonda iki listenin birleşimi alınır,
   çakışma olmaz. Saat dilimi/yerel gün geçişini doğru ele al.
3. Alev göstergesi: eklenti penceresinde, quiz kartında ve ayarlarda/kasa sayfasında streak sayısı alev
   animasyonuyla görünsün. Animasyon CSS ile yapılsın, harici dosya yok. "Hareketi azalt" ayarına uy.
   Bugünkü hedef tamamlandıysa alev canlı, tamamlanmadıysa soluk.
4. Streak koruma: haftada bir kez kullanılabilen "dondurma" hakkı ekle (ayarlardan açılıp kapatılabilir).
   Tarayıcı gün boyu kapalıysa streak haksız yere kopmasın diye bu hakkı kullanma önerisi göster.
5. Akşam uyarısı: yalnızca quiz özelliği açıksa ve kullanıcı o gün quiz'i ertelediyse ya da hiç
   çözmediyse, günün belirli bir saatinde (ayarlanabilir, varsayılan 20:00) tek bir bildirim göster:
   "Bugün hâlâ quiz çözmedin, N günlük streak'in gitmek üzere." Teşvik edici, baskıcı olmayan bir dil
   kullan. Günde en fazla bir kez, sessiz saatlere uy, ayarlardan kapatılabilsin. Bildirim izni
   gerekiyorsa isteğe bağlı olarak sor ve izin verilmezse sorunsuz çalışmaya devam et. Zamanlama için
   chrome.alarms kullan, MV3 service worker uyuduğu için durumu depolamada tut ve Firefox'ta da
   çalıştığını doğrula.
6. "Ertele" düğmesine basılırsa bir kereye mahsus şu mesaj gösterilsin: "Bugünü atlarsan N günlük
   streak'in sıfırlanır." Sonra kullanıcı yine erteleyebilsin.

## Bölüm D: rütbeler

1. Rütbe, "öğrenildi" sayısına göre belirlensin. Sınırları tek bir yapılandırma sabitinde tut.
   Kullanıcının istediği aralıklar: 100-200 Beginner, 200-300 Middle, 500-1000 Mafya, 1000-2000 Boss.
   Aradaki boşlukları (0-100, 300-500, 2000+) sen mantıklı rütbelerle doldur ve rütbe adlarını bana
   raporla (örneğin 300-500 için bir ara rütbe, 2000+ için en üst rütbe).
2. Eklenti penceresinde ve ayarlarda rütbe rozeti, sonraki rütbeye kalan kelime sayısı ve ilerleme
   çubuğu göster.
3. Rütbe atlayınca kısa, eğlenceli bir kutlama animasyonu (CSS, harici dosya yok, hareketi azalt ayarına
   uy) göster.
4. Rütbe adları, rozetler ve görseller özgün olsun. Bilinen bir marka, karakter ya da logoya benzeme.
5. Bu özellik tamamen yereldir. Herhangi bir sıralama, sunucu ya da paylaşım ekleme (bu aşamada kapsam
   dışı).

## Ayarlar

Ayarlarda quiz bölümüne şunları ekle: mod seçimi, öğrenildi eşiği (üst üste doğru sayısı), günlük hedef
(oturum tanımı), akşam uyarısı saati ve açma/kapama, streak dondurma açma/kapama, yazmada aksan
toleransı, dinlemede otomatik okuma ve şık türü. Her şeye makul varsayılan ver, "varsayılana dön"
düğmesi koy.

## Test

- Birim testleri: öğrenildi kuralı (üst üste doğru ve farklı günler), yanlışta durum düşmesi, streak'in
  gün listesinden hesaplanması (saat dilimi ve gün geçişi dahil), iki cihazdan gelen gün listelerinin
  birleşimi, yazma modunda normalizasyon ve aksan toleransı, rütbe eşikleri ve boşlukların doldurulması,
  şema migration'ı.
- Chrome ve Firefox'ta elle: üç modun her biri, ipucu ve geç düğmeleri, TTS olmayan bir dilde dinleme
  modunun nasıl davrandığı, akşam bildirimi (test için saati kısaltarak), tarayıcıyı kapatıp açınca
  streak ve öğrenildi durumunun korunması, senkronizasyon sonrası iki cihazda aynı sonuç.
- Sonunda neyi değiştirdiğini, hangi kararları senin verdiğini (oturum tanımı, rütbe adları, boşluk
  aralıkları, yazma modunda çok anlamlı kelimeler), gerçekten test ettiklerini ve test edemediklerini
  ayrı ayrı yaz.
