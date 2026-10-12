# Wordvault: Flash card quiz'i zamanlayıcıyla tüm kelimelere uygula ve eklenti alanından açılır pencere olarak göster

Önce mevcut kodu, QUIZ-SPEC.md'yi ve SPEC.md'yi oku, mevcut yapıya uy.

## Sorun
Ayarlar > Flash card bölümündeki "Test" düğmesine basınca quiz çıkıyor ve doğru/yanlış kısmı
çalışıyor. Ama quiz **sadece bu elle tetiklemede, o da tek soru olarak** çalışıyor:
- Ayarladığım sıklıkta (ör. 10 dk, 1 saat) kendiliğinden hiç çıkmıyor.
- Kasadaki **tüm kelimeleri** sırayla/akıllıca sormuyor, sadece tek bir kart soruyor.

Önce **kök nedeni bul**, tahminle yama yapma. Bulduğun nedeni özetinde yaz. Şunlara bak:
- "Test" düğmesinin kullandığı kod yolu ile zamanlayıcının kullandığı yol aynı mı? İki ayrı yol
  varsa tek bir `showQuiz()` akışında birleştir, test düğmesi sadece zamanlayıcı ve koşulları
  atlasın.
- `chrome.alarms` gerçekten kuruluyor mu (periyodik mi, tek seferlik mi)? Tek seferlikse quiz
  sonrası bir sonraki alarm kurulmuyor olabilir. Her quiz gösterildikten/atlandıktan sonra bir
  sonrakini kur.
- MV3'te arka plan betiği uyuyor. Alarm dinleyicisi dosyanın en üst seviyesinde, senkron
  kaydedilmiş mi? Durum bellekte mi tutuluyor (uyanınca kayboluyor)? Tarayıcı açılışında
  (`runtime.onStartup`), kurulumda (`onInstalled`) ve ayar değişince alarm yeniden kuruluyor mu?
- Kart seçimi hep aynı kartı mı ya da hep boş kümeyi mi döndürüyor (ör. vadesi gelmiş kart
  filtresi, "yeni kart" durumu, tarih karşılaştırması)? Soru sonrası kartın `due` değeri yanlış
  hesaplanıp kartları sonsuza itiyor olabilir.
- Quiz'i gösteren mesajlaşma: aktif sekmeye mesaj ulaşıyor mu? Sekmede içerik betiği yoksa
  (ör. eklenti kurulumundan önce açılmış sekmeler, `chrome://` sayfaları) ne oluyor?
- "Video oynarken/yazarken gösterme" koşulları engelledikten sonra yeniden deneme var mı, yoksa
  quiz sessizce kayboluyor mu?

## İstediğim davranış
1. **Zamanlayıcı:** Quiz açıkken, ayarlardaki sıklıkta (5 dk, 10 dk, 15 dk, 30 dk, 1 saat, 2 saat,
   4 saat ya da özel süre) sürekli periyodik çıksın. Ayar değişince alarm hemen yeniden kurulsun.
   Quiz kapalıysa hiç alarm kurulmasın. Tarayıcıyı kapatıp açınca da devam etsin. Durumu
   (`sonrakiQuizZamani`, son gösterilen kart) `storage.local`'da tut.
2. **Tüm kelimeler:** Kasadaki bütün kartlar sorulabilir olsun. Seçim QUIZ-SPEC'teki akıllı
   algoritmayla yapılsın (vadesi gelenler, zor kartlar daha sık, aynı kart art arda gelmez).
   Vadesi gelen kart yoksa "vadesi gelmemişlerden de sor" ayarına göre davran. Bir kart
   cevaplanınca bir sonraki quiz zamanında **farklı bir kart** gelsin, yani sırayla tüm kasa
   dönsün.
3. **Seri mod (ayarlanabilir):** "Quiz geldiğinde kaç soru sorulsun" ayarı ekle (1, 3, 5, 10;
   varsayılan 1). 1'den büyükse cevaptan sonra aynı pencerede bir sonraki soru gelsin ve sonda
   "3/5 doğru" gibi kısa bir özet göstersin. Her zaman "Kapat" ve "Bugün sorma" düğmeleri olsun.
4. **Görünüm: eklenti alanından açılan pencere.** Quiz, tarayıcı araç çubuğundaki eklenti
   simgesinin altından açılan küçük pencere (action popup) olarak çıksın. Tarayıcılar bunu her
   zaman izin vermediği için şu sırayla dene ve hangisinin hangi tarayıcıda çalıştığını
   güncel belgelerden ve gerçek denemeyle doğrula:
   - **A)** `action.openPopup()` ile eklenti popup'ını aç (quiz görünümü popup sayfasında).
     Chrome ve Firefox'ta kullanım şartlarını (kullanıcı hareketi, sürüm, odaklı pencere gerekliliği)
     kontrol et.
   - **B)** A çalışmıyorsa ya da engellenirse: küçük, bağımsız bir **popup penceresi**
     (`windows.create`, `type: "popup"`, ~360x480, ekranın sağ üstüne konumlanmış, quiz sayfasını
     `quiz.html` olarak yükler). Odağı gereksiz çalmamaya çalış (`focused: false`) ve bunun
     tarayıcıda nasıl davrandığını belirt.
   - **C)** O da olmazsa: sayfanın sağ üstünde Shadow DOM'lu kart (mevcut uygulama).
   - **D)** Hiçbiri mümkün değilse: sistem bildirimi + tıklayınca quiz penceresi.
   Ayarlarda **"Quiz nasıl görünsün"** seçeneği olsun: Otomatik (yukarıdaki sırayla dene),
   Eklenti açılır penceresi, Ayrı pencere, Sayfa içi kart. Seçilen yöntem çalışmazsa bir sonrakine
   düşsün ve tanı panelinde hangi yöntemin kullanıldığını ve nedenini göster.
5. Quiz içeriği ve algoritma QUIZ-SPEC.md'dekiyle aynı kalsın: 4 şık, yanlışlar kullanıcının
   diğer kelimelerinin anlamlarından, süre ölçümü, doğru/yanlış geri bildirimi, "Bilmiyorum" ve
   "Sonra sor". Quiz arayüzünü tek bir bileşen olarak yaz, popup/pencere/sayfa içi kart aynı
   bileşeni kullansın (kod tekrarı olmasın).
6. **Tanı paneli** (ayarlarda mevcut): sonraki quiz zamanı, alarm kurulu mu, son quiz ne zaman ve
   hangi yöntemle gösterildi, son atlama nedeni, kasada kaç kart var, kaçı sorulabilir. Panel
   gerçek zamanlayıcının durumunu göstersin, "Test" düğmesinin değil. "Test" düğmesi bu yeni akışı
   zorla tetiklesin (alarm koşullarını atlayarak).

## Testler ve doğrulama
- `node:test` ile: alarm kurulumu (sıklık değişince yeniden kurulur, kapalıyken kurulmaz, her
  quiz sonrası bir sonraki kurulur), kart seçiminin 20 ardışık quiz boyunca kasadaki tüm
  kartları dolaştığı (sahte saat ve sahte alarm API'siyle), seri modda soru sayısı ve özet.
- Gerçek tarayıcı denemesi için bana net adımlar yaz: sıklığı en kısaya çekince (ör. 1 dk
  test seçeneği ekle, yalnızca geliştirme için) quiz'in 3 kez üst üste kendiliğinden çıktığını,
  her seferinde farklı kart sorduğunu nasıl doğrulayacağımı, Chrome (`chrome://extensions` >
  Service Worker konsolu) ve Firefox (`about:debugging` > İncele) için ayrı ayrı anlat.
- `npx web-ext lint` temiz geçsin, eski testler geçsin.

## Çalışma şekli
Kök nedeni bulup düzelt ve commit at. Sonra görünüm yöntemlerini (A-D) uygula ve her biri için
Chrome ve Firefox'ta çalışıp çalışmadığını raporla. Belirsiz kalan yerde makul bir varsayım yap
ve belirt. Mevcut çalışan özellikleri bozma.
