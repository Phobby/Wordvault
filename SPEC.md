# Wordvault: Tarayıcı Eklentisi Spesifikasyonu

Firefox ve Chrome için "Wordvault" adında bir dil öğrenme eklentisi yap. Kullanıcı web sayfalarında ve video altyazılarında bilmediği kelimeleri çevirecek, istediklerini "kasaya" kaydedecek ve kayıtlı kelimeler çoktan seçmeli sorularla tekrar ettirilecek. Her şey kullanıcının kendi tarayıcısında, sunucu olmadan çalışacak.

## Teknik çerçeve
- Manifest V3, düz HTML/CSS/JavaScript. Framework ve bundler yok (AMO incelemesi kolay olsun).
- Tek kod tabanı, tarayıcı API'leri için `chrome.*` kullan (Firefox da destekliyor).
- İki manifest üret: `manifest.firefox.json` (background `scripts`, `browser_specific_settings.gecko.id`, `data_collection_permissions` beyanı) ve `manifest.chrome.json` (background `service_worker`). Küçük bir Node betiği (`build.js`) `dist/firefox` ve `dist/chrome` klasörlerini oluştursun.
- Sayfaya eklenen tüm arayüz (açılır pencere, quiz kartı) **Shadow DOM** içinde olsun. Sayfanın CSS'i eklentiyi, eklentinin CSS'i sayfayı asla bozmamalı. Sayfanın içeriği değiştirilmeyecek, yeni sekme açılmayacak.
- Veriler `chrome.storage.local` içinde, `unlimitedStorage` izniyle.
- Proje başında `git init` yap, her aşamanın sonunda commit at.

## 1. Çeviri tetikleyicileri
- **Sağ tık menüsü:** Metin seçiliyken bağlam menüsünde "Wordvault ile çevir" seçeneği olsun (`contextMenus`). Tıklanınca açılır pencere seçimin hemen yanında açılsın.
- **Çift tıklama:** Bir kelimeye çift tıklayınca açılır pencere kelimenin olduğu yerde açılsın. Ayarlardan çift tıklama tetikleyicisi kapatılabilsin.
- Açılır pencere dışarı tıklayınca, `Esc` ile ya da kapat düğmesiyle kapansın. Ekran kenarına taşmayacak şekilde konumlansın, kaydırınca seçimi takip etsin ya da kapansın.
- Input, textarea ve contenteditable alanlarında çift tıklama tetiklenmesin.

## 2. Altyazılar
- **YouTube:** Video durdurulmuşken altyazıdaki (`.ytp-caption-segment`) bir kelimenin üzerine gelince kelimenin anlamı küçük bir baloncukta çıksın. Altyazı satırını kelimelere bölüp her kelimeyi hover edilebilir yap ama YouTube'un altyazı DOM'u sürekli yeniden çizildiği için MutationObserver kullan. Video oynarken hover çevirisi çalışmasın.
- Baloncuktan da "Kasaya ekle" yapılabilsin.
- **Diğer siteler (ikinci öncelik):** HTML5 `<video>` öğelerinde `textTracks` ile alınabilen altyazılar için aynı davranışı dene. Çalışmadığı sitelerde sessizce devre dışı kalsın, hata vermesin.

## 3. Diller ve API'ler
- Kaynak dil otomatik algılansın, hedef dil ayarlardan seçilsin (varsayılan: tarayıcı dili). Kullanılan API'nin desteklediği tüm diller seçilebilsin, sadece İngilizce-Türkçe değil.
- Çeviri sağlayıcısını değiştirilebilir bir modül olarak yaz (`providers/` klasörü, ortak arayüz). Varsayılan sağlayıcı anahtar istemeyen ücretsiz bir servis olsun (örn. MyMemory). Ayarlardan kullanıcı kendi API anahtarını (örn. DeepL Free, LibreTranslate sunucusu) girebilsin.
- Kelime türü (fiil, isim, sıfat vb.), tanımlar ve örnek cümleler için Wiktionary REST API (`/api/rest_v1/page/definition/{kelime}`) kullan. Çok dilli olduğu için uygun.
- Tüm istekler kullanıcının tarayıcısından gitsin. Sunucu yok. İstek başarısız olursa açılır pencerede anlaşılır bir hata göster.

## 4. Açılır pencere içeriği
- Seçilen kelime/ifade, algılanan dil, çeviri, varsa telaffuz düğmesi (tarayıcının `speechSynthesis`'i).
- Kelime türü etiketi.
- **"Kasaya ekle"** düğmesi. Zaten kayıtlıysa "Kasada" olarak görünsün ve tıklayınca çıkarabilsin.
- Kaydederken kelimenin geçtiği cümleyi (bağlam) ve sayfa adresini de sakla.

## 5. Kasa sayfası
- Eklenti simgesine tıklayınca açılan popup'ta kayıtlı kelimeler listelensin: arama, dile göre filtre, silme.
- Bir kelimeye tıklayınca detay görünümü açılsın:
  - Çeviri ve hedef dildeki karşılıkları
  - Kelime türleri (fiil, isim, sıfat vb.) ve her biri için tanım
  - **3-5 örnek cümle** (Wiktionary'den, yetmezse kaydederken saklanan bağlam cümlesi)
  - Kelimenin kaydedildiği cümle ve sayfa bağlantısı
- JSON olarak dışa/içe aktarma (cihazlar arası taşıma ve yedek için).

## 6. Flash card / quiz
- Kasada **10'dan fazla** kart olduğunda quiz sistemi devreye girsin.
- Quiz, sayfanın sağ üstünde küçük bir kart olarak çıksın (Shadow DOM): kayıtlı kelimeyi gösterip hedef dildeki karşılığını **4 şıkla** sorsun.
- Yanlış şıklar, **aynı hedef dildeki diğer kayıtlı kelimelerin anlamlarından** rastgele seçilsin. Doğru cevapla aynı ya da çok benzer şıklar elensin.
- Cevaptan sonra doğru/yanlış geri bildirimi verip birkaç saniyede kapansın. "Sonra sor" ve "Bugün sorma" seçenekleri olsun.
- Hangi kelimenin ne zaman sorulacağını basit bir aralıklı tekrar (Leitner kutuları) belirlesin: doğruysa kutu ilerler, yanlışsa başa döner.
- Quiz sıklığı ayarlanabilir olsun (varsayılan: en fazla 20 dakikada bir, `chrome.alarms` ile). Video oynarken ya da kullanıcı bir alana yazı yazarken quiz çıkmasın.
- Popup'ta "Şimdi çalış" düğmesiyle sınırsız manuel tekrar da yapılabilsin.

## 7. Önbellek (kaydedilmeyen kelimeler)
- Çevrilen ama kasaya eklenmeyen her kelimenin sonucunu ayrı bir önbellekte sakla (anahtar: kelime + kaynak dil + hedef dil).
- Aynı kelime tekrar çevrilirse API'ye gitmeden önbellekten cevap ver ve `sonErisim` tarihini güncelle.
- **7 gün** boyunca tekrar sorulmayan önbellek kayıtlarını sil (günde bir `chrome.alarms` temizliği).
- Kasadaki kelimeler önbellekten bağımsızdır ve asla otomatik silinmez.

## 8. Ayarlar sayfası
Hedef dil, çeviri sağlayıcısı ve API anahtarı, çift tıklama açık/kapalı, YouTube hover açık/kapalı, quiz açık/kapalı ve sıklığı, önbelleği temizle, dışa/içe aktar.

## 9. Gizlilik ve yayın hazırlığı
- Hiçbir analitik ya da izleme yok. Sadece seçilen metin, seçilen çeviri servisine gönderilir.
- Kısa bir `PRIVACY.md` gizlilik politikası yaz.
- Sonunda `npx web-ext lint` çalıştır ve çıkan sorunları düzelt.
- Gereksiz izin isteme. İstediğin her izni README'de gerekçesiyle açıkla.

## Çalışma şekli
Aşamalı ilerle ve her aşamadan sonra dur, nasıl test edeceğimi söyle:
1. İskelet, iki manifest, build betiği, çift tıkla açılır pencere + çeviri
2. Sağ tık menüsü, Wiktionary bilgileri, önbellek ve 7 günlük temizlik
3. Kasaya ekleme, kasa popup'ı, detay görünümü, dışa/içe aktarma
4. Quiz sistemi ve aralıklı tekrar
5. YouTube altyazı hover'ı, sonra diğer HTML5 videolar
6. Ayarlar sayfası, gizlilik politikası, lint ve son kontroller

Belirsiz bir şey olursa makul bir varsayım yap, varsayımı kodda yorum olarak ve aşama sonu özetinde belirt.
