# Wordvault: zorluk seviyeleri ve eklenti penceresinde quiz düğmesi

Wordvault'taki quiz modları tasarımını aşağıdaki gibi güncelle. Bu, önceki quiz modları tanımının
(Klasik/Yazma/Dinleme/Karışık, SPEC-LEARNING.md Bölüm A) yerine geçer. Çakışan yerleri bu tanıma göre
değiştir. Önce mevcut quiz, ayarlar ve eklenti penceresi (action popup) kodunu incele, mevcut yapıyı
yeniden kullan, kısa bir plan çıkar, sonra uygula. Mevcut çalışan özelliklere dokunma. Kasadaki
kelimelerle sınırlı kal, her şey yerel çalışsın.

## Zorluk seviyeleri (dört mod)

1. Easy = Klasik: kelime/anlam gösterilir, 4 şıktan seçilir (şu anki mod, şıklar kasadaki diğer
   kelimelerin anlamlarından gelir).
2. Medium = Yazma: kullanıcının dilindeki anlam gösterilir (örneğin "mavi"), kullanıcı kasadaki kelimeyi
   yazar (örneğin "blue"). Yazım hatası yanlış sayılır, doğru cevap ve hatalı harfler gösterilir. İpucu
   düğmesi (her basışta bir harf açar, ipucu kullanılan cevap kısmi puan sayılır) ve "Geç" düğmesi
   (cevabı gösterir, yanlış sayar). Aksan toleransı ayarı (varsayılan kapalı). Enter ile gönderme, alan
   otomatik odaklanır.
3. Hard = Dinleme (şıklı): boş bir kutu ve sağ tarafında hoparlör düğmesi. Tıklayınca kasadan rastgele
   bir kelime sesli okunur, kullanıcı aşağıdaki 4 şıktan doğru olanı seçer (şık türü ayarlanabilir: anlam
   veya yazılış, varsayılan anlam).
4. Expert = Dinleme + yazma: kelime sesli okunur ve kullanıcı duyduğunu yazar. Anlam gösterilmez. İpucu
   (harf açma) ve "Geç" bulunur, ipucu kullanılan cevap kısmi puan sayılır. Yazım hatası yanlış sayılır.

Seslendirme için mevcut TTS altyapısını kullan. Daha önce seslendirme sonunda yüksek bir patlama sesi
olmuştu, dinleme modlarında bu hatanın tekrarlanmadığından emin ol. Kelimenin dilinde ses yoksa
kullanıcıya açıklayıcı mesaj göster ve o kelimeyi atlayıp başka kelime seç. Dinleme sorusunda kelime
otomatik bir kez okunsun (ayarlanabilir), hoparlör düğmesiyle tekrar dinlenebilsin.

## Eklenti penceresinde quiz düğmesi

1. Eklenti simgesine basınca açılan arayüzde, boş bir alana bir "Quiz" bölümü ekle: quiz başlatma düğmesi
   ve yanında zorluk seçici.
2. Zorluk seçici tek bir düğmedir: her tıklayışta sırayla Easy → Medium → Hard → Expert → Easy şeklinde
   döner. Seçili zorluğun adı ve hangi modu başlatacağı açıkça görünür.
3. Her tıklayışta zorluğu yansıtan temalı kısa bir animasyon oynar. Fikirler (özgün çizimler yap, bilinen
   marka veya karakterlere benzetme): Easy için filizlenen bir yaprak/yeşil tonlar, Medium için yükselen
   bir kıvılcım/turuncu tonlar, Hard için şimşek/kırmızı tonlar, Expert için parlayan bir kristal ya da
   mor/siyah tonlar. Tüm animasyonlar CSS ile yapılsın, harici dosya yok, kısa (yaklaşık yarım saniye)
   olsun ve "hareketi azalt" ayarına saygı göstersin. Düğmenin rengi ve etiketi de zorluğa göre değişsin.
4. Seçilen zorluk hatırlansın (storage.local, sonraki açılışta aynı seviyeden başlasın). Hızlı
   tıklamalarda animasyonlar üst üste binmesin ve takılma olmasın.
5. Düğmeye basınca quiz seçili zorluktaki modla, kasadaki kelimelerden başlar. Quiz penceresinin
   yerleşimi (açılır pencere, bağımsız küçük pencere veya sayfa içi kart) mevcut görüntüleme zinciriyle
   uyumlu olsun. Kasada yeterli kelime yoksa (örneğin 4 şık için en az 4 kelime gerekir) açıklayıcı bir
   mesaj göster.

## Ayarlar (otomatik quiz penceresi için)

1. Quiz bölümünde Classic, Writing, Listening ve Expert için ayrı ayrı seçilebilir anahtarlar olsun
   (çoklu seçim). Aynı anda hepsi açıkken ayrı bir "Mixed" düğmesi olmasın: dört mod birden seçiliyse bu
   durum arayüzde "Mixed" etiketiyle gösterilsin (bilgi amaçlı), hiçbiri seçili değilse uyarı göster, en
   az biri seçili kalsın.
2. Otomatik açılan quiz, seçili modlar arasından seçim yapsın. Birden fazla mod seçiliyse sırayla/rastgele
   dağıt (ağırlığı ayarlardan değiştirme gerekmez).
3. Eklenti penceresindeki zorluk seçici manuel quiz için ayrıdır, ayarlardaki seçimden bağımsızdır. Bu
   ayrımı ayarlarda kısaca açıkla.

## Puan ve öğrenme

1. Dört modun sonucu aynı uyarlanabilir zamanlayıcıya (SM-2 benzeri, hız ve doğruluk) beslesin. Zorluk
   arttıkça doğru cevabın ağırlığı artsın: Easy < Medium < Hard < Expert. İpucu kullanımı ve "Geç" puanı
   düşürsün.
2. "Öğrenildi" kuralı (üst üste doğru cevap ve farklı günler) yalnızca Easy ile sağlanmasın: öğrenildi
   sayılması için en az bir doğru cevabın Medium veya daha yüksek seviyeden olması gereksin (ayarlardan
   kapatılabilir).
3. Manuel (eklenti penceresinden başlatılan) quiz oturumları da günlük streak hedefine sayılsın.

## Test

- Birim testleri: zorluk seçicinin döngüsü ve kalıcılığı, mod seçim mantığı (hepsi seçili = Mixed,
  hiçbiri seçili değil uyarısı), yazma ve expert'te normalizasyon ve ipucu puanı, puan ağırlıkları.
- Chrome ve Firefox'ta elle: seçiciye art arda hızlı tıklama, her seviyenin animasyonu ve hareketi azalt
  ayarı, dört modun her biri, TTS olmayan bir dil, kasada az kelime durumu, tarayıcıyı kapatıp açınca
  seçili zorluğun hatırlanması.
- Sonunda neyi değiştirdiğini, hangi kararları sen verdiğini (animasyon temaları, puan ağırlıkları, mixed
  etiketinin davranışı), gerçekten test ettiklerini ve test edemediklerini ayrı ayrı yaz.
