# Wordvault: seçilen cümle/paragrafı çevirme

Wordvault'ta sayfada seçilen bir cümle/paragrafı çevirme özelliği eksik. Önce mevcut durumu denetle, sonra eksikleri tamamla. Kod yazmadan önce bulduklarını kısaca raporla.

## AŞAMA 1 — DENETİM

Şunları gerçek koda bakarak cevapla:

1. Sağ tık menüsünde "Translate with Wordvault" seçeneği var mı? Manifestlerde "contextMenus" izni var mı?
2. Çok kelimeli seçimler için bir "cümle modu" pencere var mı, yoksa seçim hâlâ yalnızca tek kelime olarak mı işleniyor?
3. Metin parçalama (uzun metni cümle sınırlarında bölüp çevirme) ve üst sınır var mı?
4. Sağlayıcı seçimi (MyMemory/DeepL) var mı ve bu özellik seçili sağlayıcıyı kullanıyor mu?

Sonucu kısa bir tablo olarak ver: ne var, ne eksik, ne bozuk. Eksik olanları aşağıdakilere göre tamamla, var olanları yeniden yazma.

## AŞAMA 2 — ÖZELLİK

Kullanıcı sayfada bir cümle ya da paragraf seçtiğinde üç yoldan çevirebilsin:

1. Sağ tık menüsü: metin seçiliyken "Translate with Wordvault" (arayüz Türkçeyse "Wordvault ile çevir"). Menüyü onInstalled'da oluştur, onClicked dinleyicisini üst düzeyde kaydet, MV3 service worker uyuyup uyandığında menünün kaybolmadığını doğrula. Seçim info.selectionText'ten alınsın, iframe'ler için frameId hedeflensin.
2. Küçük "Çevir" düğmesi: seçim yapıldığında (mouseup/selectionchange, kısa bekleme ile) seçimin yanında küçük bir düğme belirsin. Düğmeye basınca çeviri penceresi açılsın. Seçim kaybolunca ya da başka yere tıklanınca düğme kaybolsun. Bu düğme ayarlardan kapatılabilir olsun (varsayılan açık, sayfaları rahatsız etmesin, sadece birden çok kelime seçildiğinde göster). Tek kelime seçiminde mevcut kelime davranışı korunsun. Düğme Shadow DOM içinde olsun, sayfa stilinden etkilenmesin ve sayfanın metin seçimini bozmasın.
3. Klavye kısayolu: seçili metni çeviren bir komut (chrome.commands). macOS'ta Option/Alt kullanma, Mac ve Windows için ayrı varsayılanlar tanımla (Command+Shift veya Ctrl+Shift tabanlı, bilinen çakışmalardan kaçın), seçtiğin kombinasyonu raporla. Ayarlarda atanmış kısayol gösterilsin, atanmamışsa yönlendirme göster.

Çeviri penceresi (cümle modu):

- Mevcut ui/popup bileşenini yeniden kullan. Kaynak metin (uzunsa kısaltılmış, "tümünü göster"), çeviri, algılanan kaynak dil, kopyala düğmesi, seslendirme, hangi sağlayıcının kullanıldığını gösteren küçük etiket.
- Seçimin yanında açılsın (getBoundingClientRect, ekran dışına taşarsa içeri al), Esc veya dışarı tıklamayla kapansın, uzun metinde kaydırılabilir olsun, karanlık/açık tema ve Unicode karakterler doğru görünsün.
- Hedef dil ve kaynak dil ayarları mevcut seçimle aynı olsun. Kaynak dil "otomatik" ise algılanan dil hedef dille aynıysa yanlış uyarı çıkarma.
- İsteğe bağlı "ifade olarak kasaya ekle" düğmesi (kelime kartlarından ayrı tür, varsayılan olarak quiz'e girmesin, ayardan açılabilsin). Cümle çevirisi kasaya otomatik girmesin.

Çeviri mantığı:

- Seçili sağlayıcıyı kullan (MyMemory varsayılan, DeepL seçilmişse ve anahtar girilmişse DeepL). Sağlayıcının tek istek uzunluk sınırını resmi belgelerden araştır, metni cümle sınırlarında (Intl.Segmenter) parçalara bölüp sırayla çevir ve birleştir. Bir parça başarısız olursa kısmi sonucu göster ve hatayı belirt.
- Üst sınır koy (örneğin 5000 karakter), aşılırsa açıklayıcı mesaj göster.
- Sonuçlar mevcut önbelleğe (anahtarda metin, dil çifti ve sağlayıcı olsun) yazılsın.
- Çok kelimeli seçimde kelime modu (hover/çift tık) tetiklenmesin.
- Sağlayıcı seçimi henüz yoksa MyMemory ile çalış ve bunu raporla, sağlayıcı seçimini bu işin kapsamına katma.

Sınır durumları:

- Chrome'un yerleşik PDF görüntüleyicisi ve chrome:// sayfalarında content script çalışmaz. Bu durumlarda sağ tık menüsünden gelen çeviriyi küçük bir bağımsız pencerede veya bildirimde göster. Firefox PDF.js'te çalışıp çalışmadığını dene ve raporla.
- Mevcut açık sekmelerde content script yoksa (eklenti yeni yüklendiyse) gerektiğinde chrome.scripting ile enjekte et.
- Ayarlara "Sağ tık menüsü", "Seçimde Çevir düğmesi" anahtarlarını ekle ve kapatılınca ilgili davranış kalksın.

## GİZLİLİK

Çevrilen metin yalnızca seçili sağlayıcıya gönderilir, başka hiçbir yere gönderilmez. Bunu gizlilik metnine ve mağaza veri açıklamalarına ekle.

## TEST

- Chrome ve Firefox'ta elle: kısa cümle, uzun paragraf (parçalama), iframe içindeki metin, YouTube açıklaması, PDF sayfası, Türkçe/Arapça/Japonca metin, sağ tık, "Çevir" düğmesi ve kısayolun her biri, yeni yüklenen eklentiden sonra açık duran sekme.
- Birim testleri: cümle bölme ve birleştirme, üst sınır, önbellek anahtarı, tek kelime/çok kelime ayrımı.
- Sonunda neyi değiştirdiğini, denetimde ne bulduğunu, hangi sınırlamaların kaldığını ve gerçekten test ettiklerini ayrı ayrı yaz. Mevcut çalışan özelliklere (kasa, quiz, altyazı, OCR, senkronizasyon) dokunma.
