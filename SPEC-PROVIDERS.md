# Wordvault: çeviri sağlayıcısı seçimi ve sağ tık çevirisi

Wordvault'a iki özellik ekle: (A) çeviri sağlayıcısı seçimi (MyMemory varsayılan, DeepL isteğe bağlı),
(B) metin seçip sağ tıkla "Translate with Wordvault" ile cümle/paragraf çevirisi. B, seçili sağlayıcıyla
çalışmalı. Önce mevcut yapıyı (background, content script, ui/popup, provider katmanı, önbellek, ayarlar
sayfası) incele ve var olan parçaları yeniden kullan.

## A) Sağlayıcı seçimi

1. Ayarlarda "Çeviri sağlayıcısı" bölümü: iki seçenek, MyMemory (varsayılan, anahtarsız) ve DeepL.
2. DeepL seçilince bir anahtar alanı çıksın (parola tipi, göster/gizle düğmesi). Anahtar yalnızca
   chrome.storage.local'da saklansın. Senkronizasyona, yedeğe, JSON dışa aktarmaya, geri bildirim/hata
   günlüğüne asla dahil edilmesin. Bunu test et.
3. DeepL ücretsiz planı ve ücretli plan farklı adresler kullanır: anahtar ":fx" ile bitiyorsa ücretsiz
   plan uç noktasını, değilse ücretli plan uç noktasını kullan. Resmi DeepL belgelerinden güncel adresleri
   ve kimlik doğrulama başlığını kontrol et, hatırladığına güvenme.
4. DeepL için dil kodu eşlemesi yap (DeepL kendi kodlarını ister, örneğin hedef dilde bölge varyantları;
   desteklemediği bir dil seçilirse anlaşılır uyarı göster ve MyMemory'ye düşmeyi öner).
5. "Anahtarı test et" düğmesi: küçük bir istek atıp başarı/hata göstersin (geçersiz anahtar, kota doldu,
   ağ hatası için ayrı ve anlaşılır mesajlar).
6. Anahtar nasıl alınır: ayarlarda kısa bir kılavuz (DeepL API hesabı aç, ücretsiz planı seç, anahtarı
   kopyala). Kayıt sırasında kart doğrulaması istenebileceğini not düş. Metinler doğru ve abartısız olsun.
7. Yedek davranış: DeepL seçiliyken hata/kota dolması olursa kullanıcıya haber ver ve isteğe bağlı olarak
   "MyMemory ile devam et" seçeneği sun. Sessizce sağlayıcı değiştirme, hangi sağlayıcının kullanıldığı
   pencerede küçük bir etiketle görünsün.
8. Önbellek anahtarına sağlayıcıyı da ekle (aynı metnin MyMemory ve DeepL sonuçları karışmasın). Kelime
   çevirisi, örnek cümleler, altyazı ve OCR de aynı sağlayıcı ayarını kullansın. Hangi özelliklerin hangi
   sağlayıcıyı kullandığını raporla (örneğin sözlük/örnek cümle Wiktionary'den geliyorsa sağlayıcıdan
   bağımsız kalır).

## B) Sağ tık çevirisi

1. "contextMenus" iznini iki manifeste ekle. Menü yalnızca metin seçiliyken görünsün, başlığı "Translate
   with Wordvault" (arayüz Türkçeyse "Wordvault ile çevir"). Menüyü onInstalled'da oluştur, onClicked
   dinleyicisini üst düzeyde kaydet, MV3 service worker uyanıp uyuduğunda menünün kaybolmadığını doğrula.
   Seçim info.selectionText'ten alınsın, iframe'ler için frameId hedeflensin.
2. Çeviri penceresi mevcut ui/popup'ı yeniden kullansın, "cümle modu" eklensin: kaynak metin (uzunsa
   kısaltılmış, "tümünü göster"), çeviri, algılanan kaynak dil,

> NOT: Şartname yapıştırılırken bu noktada kesildi; B.2'nin devamı, varsa sonraki maddeler ve "çalışma
> şekli" bölümü eksik.
