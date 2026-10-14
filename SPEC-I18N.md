# Wordvault: çok dilli arayüz (i18n)

Wordvault'a çok dilli arayüz (i18n) ekle. Önce mevcut yapıyı (popup, ayarlar, kasa sayfası, quiz, streak/rütbe, bildirimler, sağ tık menüsü, hata mesajları, destek/geri bildirim kartı, onboarding, manifestler) incele, arayüzdeki sabit metinlerin nerelerde geçtiğini çıkar, kısa bir plan ve anahtar adlandırma şeması öner, sonra aşama aşama uygula. Mevcut çalışan özelliklere dokunma. Her şey yerel çalışsın, çeviri dosyaları paketin içinde olsun, hiçbir arayüz metni çalışma anında sunucudan ya da bir çeviri API'sinden çekilmesin.

## GENEL KURALLAR
- Projenin kaynak dili İngilizce olacak: kod yorumları, değişken/fonksiyon adları, commit mesajları, README ve geliştirici belgeleri İngilizce. Koddaki Türkçe yorum ve sabit metinleri İngilizceye çevir. Referans (kaynak) çeviri dosyası İngilizce olsun ve tek doğruluk kaynağı olarak kabul edilsin.
- Arayüz dili, çeviri hedef dilinden bağımsız bir ayardır ("Arayüz dili" ve "Çeviri hedef dili" ayarlarda ayrı gösterilsin ve karışmasın).
- Kullanıcı verisi (kasadaki kelimeler, notlar, cümleler) asla çevrilmez veya değiştirilmez.

## AŞAMA 1 — ALTYAPI VE İNGİLİZCE KAYNAK
1. Tarayıcının hazır chrome.i18n/_locales sistemi arayüz dilini tarayıcı diline bağlar ve çalışma anında değiştirilemez. Bu yüzden kendi küçük çeviri yükleyicini yaz: her dil için ayrı bir JSON dosyası (örneğin locales/en.json, locales/tr.json), düz anahtar-değer ya da düz iç içe yapı, tek biçim kullan.
2. Yükleyici: seçilen dili yükler, eksik anahtarlarda İngilizceye düşer (fallback), anahtar hiçbir dilde yoksa anahtar adını gösterir ve geliştirme modunda konsola uyarı yazar. İlk açılışta varsayılan dil: tarayıcı dili destekleniyorsa o, değilse İngilizce. Seçim storage.local'da saklansın (senkronizasyon ayarına dahil edilmesi gerekip gerekmediğine karar ver ve raporla).
3. Yerel yer tutucular: "{name}" gibi sabit biçim kullan. Çoğul biçimler için Intl.PluralRules kullan (örneğin "1 word / 2 words"). Tarih, sayı ve göreli zaman biçimleri için Intl kullan, elle biçimlendirme yapma.
4. Tüm arayüz yüzeyleri çevrilebilir olsun: eklenti penceresi, ayarlar, kasa sayfası, quiz (mod adları, zorluk seviyeleri, ipuçları, geri bildirim mesajları), streak ve rütbe adları, bildirim metinleri, hata mesajları, destek ve geri bildirim kartı, sağ tık menüsü başlığı, kısayol açıklamaları, tooltip ve aria-label'lar (erişilebilirlik metinleri de çevrilsin).
5. Sağ tık menüsü ve bildirimler arka plan betiğinde olduğu için o tarafta da aynı yükleyici çalışsın. Dil değişince sağ tık menüsü başlıklarını contextMenus.update ile güncelle, bildirimler yeni dile göre üretilsin. İçerik betikleri ve Shadow DOM pencereleri dil değişimini anında (sayfayı yenilemeden) yansıtsın, bunun için depolama değişikliğini dinle.
6. Mağaza sayfası için ayrı olarak _locales/ klasörünü kullan (yalnızca eklenti adı ve kısa açıklama, manifestin __MSG_...__ alanları). Bu, çalışma anındaki dil seçiminden bağımsızdır, bu ayrımı belgele. Chrome ve Firefox'ta manifest yerelleştirmesinin nasıl çalıştığını resmi belgelerden kontrol et.
7. Koddaki tüm sabit arayüz metinlerini anahtarlara taşı. Mevcut Türkçe metinleri locales/tr.json'a, İngilizce karşılıklarını locales/en.json'a koy. Taşıma sırasında hiçbir metni kaybetme.
8. Dil seçici: ayarlarda "Arayüz dili" listesi, her dil kendi dilinde yazılmış adıyla (örneğin "Deutsch", "日本語", "العربية"). Arama kutusu olmasına gerek yok, 15 dil için açılır liste yeterli.

## AŞAMA 2 — DİLLER
Aşağıdaki 15 dili ekle: İngilizce (kaynak), Türkçe, İspanyolca, Almanca, Fransızca, Portekizce (Brezilya), Rusça, Arapça, Japonca, Çince (Basitleştirilmiş), Korece, İtalyanca, Hintçe, Endonezce, Felemenkçe.
1. Çevirileri kendin (yapay zekâ olarak) üret, ama bunların makine çevirisi olduğunu ayarlarda küçük bir not olarak belirt ("Çeviriler otomatik olarak üretildi, hata bulursan bildir") ve GitHub'daki sorun/PR yolunu göster. Kısa, doğal ve tutarlı çevir, arayüz terimlerini sözlük olarak sabit tut ("vault", "streak", "flashcard", "quiz" gibi terimler her dilde aynı karşılıkla geçsin ya da bilinçli olarak çevrilmeden bırakılsın, kararını raporla).
2. Yer tutucuları ve biçimleri bozma. Çeviri dosyalarında yer tutucuların kaynakla birebir aynı olduğunu doğrulayan bir doğrulama betiği yaz (npm script olarak çalışsın).
3. Dil adı listesinde her dil kendi adıyla yazılsın.
4. Sağ tık menüsü "Translate with Wordvault" gibi metinlerin her dildeki karşılığını da ekle.

## AŞAMA 3 — SAĞDAN SOLA, YAZI TİPİ VE TEST
1. Arapça için sağdan sola düzen: dir="rtl" ve CSS'te mantıksal özellikler (margin-inline-start gibi) kullan. Tüm arayüz yüzeylerini (popup, ayarlar, kasa, quiz, Shadow DOM pencereleri, yön ikonları, ilerleme çubukları, alev ve rütbe göstergeleri) RTL'de kontrol et ve düzelt. İbranice, Farsça ve Urduca eklenmese de altyapı bunlara hazır olsun.
2. Çince, Japonca, Korece ve Hintçe için uygun yazı tipi yedek zincirini (sistem yazı tipleri) tanımla, harici yazı tipi dosyası yükleme (uzak kod ve boyut sorunu olmasın).
3. Uzun metinler (Almanca, Rusça gibi) düğmeleri ve satırları taşırmasın. Arayüzü esnek yap (satır kaydırma, min/max genişlik).
4. Doğrulama betiği: tüm dillerde anahtar eşitliği (eksik/fazla anahtar), yer tutucu tutarlılığı, boş değer, JSON geçerliliği. Eksik anahtar varsa derleme uyarı versin (hata mı uyarı mı olacağına karar ver ve raporla).
5. Çeviri katkı kılavuzu: CONTRIBUTING-TRANSLATIONS.md dosyası (yeni dil nasıl eklenir, hangi dosya, hangi biçim, doğrulama betiği nasıl çalıştırılır, makine çevirisi hatası nasıl düzeltilir, sözlük). Dil listesine yeni dil eklemenin tek bir yerde yapılmasını sağla.
6. Dosya boyutunu raporla: tüm dil dosyaları toplam ne kadar, paketin büyüklüğü ne kadar arttı. Yalnızca seçili dilin yüklendiğini doğrula.

## TEST
- Birim testleri: yükleyici ve fallback davranışı, yer tutucu değişimi, çoğul kuralları, dil seçiminin kalıcılığı, doğrulama betiğinin eksik anahtarı yakalaması.
- Chrome ve Firefox'ta elle: dil değiştirince her yüzeyin yeni dile geçmesi (popup, ayarlar, kasa, quiz, sağ tık menüsü, bildirim), sayfayı yenilemeden güncelleme, Arapçada düzen aynalaması, Çince/Japonca/Korece yazı tipi görünümü, uzun metinli dillerde taşma, tarayıcı dili desteklenmiyorsa İngilizceye düşme, arka plan betiği uyuyup uyandıktan sonra dilin korunması.
- Sonunda neyi değiştirdiğini, hangi kararları sen verdiğini (anahtar şeması, terim sözlüğü, doğrulama betiğinin sert/yumuşak davranışı), dosya boyutlarını ve gerçekten test ettiklerini ile edemediklerini ayrı ayrı yaz. Aşama 1 bitince dur ve bana raporla, diğer aşamalara ben onay vereyim.
