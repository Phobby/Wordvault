# Wordvault: Destek (Buy Me a Coffee), İletişim/Geri bildirim sistemi ve mağaza hazırlığı

Önce mevcut kodu, SPEC.md ve diğer SPEC dosyalarını oku, mevcut yapıya uy (storage, build.js, iki
manifest, ayarlar sayfası, `_locales`, Shadow DOM kuralı). Metinler en ve tr olsun.

## 1. Destek (Buy Me a Coffee)
- Bağlantı `config.js` içinde tek bir sabitte dursun (`SUPPORT_URL`, yer tutucu değer). Boşsa tüm destek
  arayüzü gizlensin. Başka bir servise geçmek tek satırlık değişiklik olsun.
- Ayarlar sayfasının **üstünde** belirgin bir "Projeyi destekle" kartı: kısa, samimi metin ve düğme.
- Popup altında küçük bir "Destekle" bağlantısı. Eklenti ilk kurulduğunda bir kez açılan karşılama
  sayfasında (`welcome.html`) özelliklerin kısa tanıtımı ve aynı destek kartı.
- Düğme sade bir bağlantı olsun (`target="_blank" rel="noopener noreferrer"`). **Uzaktan betik/widget
  yükleme** (MV3 yasak), görsel ve CSS pakete yerel konsun. Marka kurallarına uyan, yerel bir buton kullan.
- Rahatsız etme: açılır pencere, tekrar eden hatırlatma, kullanımı engelleyen hiçbir şey yok.
  Karşılama sayfasındaki kart "Bir daha gösterme" ile kapanabilsin.

## 2. "İletişim ve geri bildirim" sekmesi (ayarlar sayfasında)
- Alanlar: tür (Hata / Öneri / Diğer), ilgili özellik listesi (Çeviri baloncuğu, Altyazılar,
  Flash card/quiz, Senkronizasyon, Ayarlar, Diğer), serbest metin (10-1500 karakter), isteğe bağlı
  e-posta (boş bırakılabilir, "yanıt istersen" diye açıklanmış), "Teknik bilgileri ekle" (varsayılan açık),
  "Son hata kayıtlarını ekle" (varsayılan kapalı).
- **Göndermeden önce önizleme:** "Gönderilecek veriyi göster" ile tam JSON'u kullanıcıya göster.
  Kullanıcı onaylamadan hiçbir şey gönderme.
- **E-posta uygulaması açma (mailto kullanma).** Arka plan betiği verileri bir HTTPS uç noktasına
  `fetch` ile POST eder (`config.js` içinde `FEEDBACK_ENDPOINT`). Zaman aşımı, bir kez yeniden deneme,
  başarı/hata ekranı, istemci tarafı 60 sn bekleme (spam önleme). Gönderilemezse taslak kaybolmasın.
- **Toplanan teknik bilgi (yalnızca bunlar):** tarayıcı adı ve sürümü, işletim sistemi, eklenti sürümü,
  arayüz dili, hangi özelliklerin açık olduğu (yalnızca true/false), senkron modu türü. **Asla:** sayfa
  adresi, sayfa içeriği, kasadaki kelimeler, bağlam cümleleri, API anahtarları, OAuth token'ları,
  kullanıcı kimliği/kalıcı tanımlayıcı. Kalıcı kurulum kimliği üretme.
- Tarayıcıyı `runtime.getBrowserInfo` (varsa) ve `navigator.userAgentData`/`userAgent` ile tespit et,
  Brave, Edge, Zen gibi türevleri mümkün olduğunca ayırt et.
- **Yerel hata günlüğü:** Eklenti içinde yakalanan hataları (mesaj, özellik adı, zaman, kısaltılmış
  yığın) `storage.local`'da dairesel bir tamponda son 20 kayıt olarak tut. Sayfa içeriği ya da adresi
  içermesin. Yalnızca kullanıcı "hata kayıtlarını ekle"yi seçerse gönderilsin.
- İzinler: yalnızca geri bildirim uç noktasının alan adı için `host_permissions`/`optional_host_permissions`.
  Firefox'ta `data_collection_permissions` içinde bunu **isteğe bağlı** beyan et (teknik/etkileşim
  verisi ve kullanıcının yazdığı iletişim metni), kullanıcı ilk gönderimde onay versin. Güncel
  kategori adlarını resmî belgelerden doğrula.

## 3. Geri bildirim alıcısı (`feedback-worker/`)
Cloudflare Worker (ücretsiz plan), ayrı klasörde, bağımlılıksız:
- `POST /feedback`, JSON gövde. Doğrulama: gövde ≤ 8 KB, alanlar şemaya uygun (izin verilen
  değerler listesi), metin 10-1500 karakter, kontrol karakterlerini temizle, gizli alan (honeypot)
  doluysa sessizce 200 dön ama iletme. Başarısız doğrulamada anlaşılır hata kodu.
- Mesajı **Telegram Bot API**'ye gönder (`sendMessage`, HTML kaçışlı). Alternatif olarak Discord
  webhook adaptörü de yaz, hangisi kullanılacağı ortam değişkeniyle seçilsin. Gizli değerler
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) yalnızca Worker sırlarında (secrets) dursun, repoya girmesin.
- Mesaj biçimi (saat Europe/Istanbul, tr-TR):

> NOT: Şartname iki parça halinde yapıştırıldı; mesaj biçimini gösteren örnek blok bu noktada eksikti.

İstemci saatine güvenme, sunucu zamanını kullan. Hata günlüğü eklenmişse ikinci mesaj olarak kısalt.
- **Hiçbir şeyi kalıcı saklama ve IP'yi kaydetme/günlüğe yazma.** Hız sınırı: Cloudflare'in
  ücretsiz planda sunduğu mekanizmaları araştır (KV ile tuzlanmış IP özeti ve 1 gün TTL ya da
  rate-limiting bağlayıcısı) ve seç, seçimini gerekçelendir. Çalışmazsa bunu belgele.
- CORS gerekmez (istek arka plan betiğinden). Uç nokta dışında her yola 404 dön.
- `wrangler.toml`, `README` dağıtım adımları: BotFather ile bot oluşturma, sohbet kimliğini alma,
  `wrangler secret put`, `wrangler deploy`, `curl` ile test, spam durumunda sırrı değiştirme ve
  uç noktayı kapatma.
- Worker için `node:test` testleri: şema doğrulama, kaçış, boyut sınırı, honeypot, mesaj biçimi.

## 4. Gizlilik ve yayın hazırlığı
- `PRIVACY.md` ve GitHub Pages için `docs/privacy.html`: eklentinin neyi toplamadığı, geri bildirim
  gönderilirse tam olarak ne gittiği, nereye gittiği (Worker → Telegram), saklanmadığı, IP'nin altyapı
  tarafından görülüp Worker tarafından kaydedilmediği, silme talebi için iletişim, bulut senkronizasyonu
  ve çeviri servisleri. Chrome gizlilik sekmesi ve Firefox beyanıyla tutarlı olsun.
- **Chrome Web Store hazırlık dosyası** (`store/`): tek amaç açıklaması, her izin için gerekçe
  metni, uzak kod kullanılmadığı beyanı, kısa (≤132 karakter) ve uzun açıklama (en ve tr), test
  talimatları, veri kullanım beyanı taslağı. Kaynak: ayarlar ve manifest, hiçbir izni gerekçesiz bırakma.
- Playwright ile sahte sayfada **1280×800** ekran görüntüleri üret (çeviri baloncuğu, kasa, quiz,
  ayarlar) ve **440×280** küçük tanıtım görseli taslağı. 128×128 ikonu doğrula.
- `npx web-ext lint` temiz geçsin, eski testler geçsin, her iki paketi (`dist/chrome`, `dist/firefox`)
  zip'le ve boyutlarını raporla.

## Çalışma şekli
Aşamalı ilerle, her aşamadan sonra dur, nasıl test edeceğimi söyle, aşama başına commit at:
1. Destek kartı, karşılama sayfası, yapılandırma
2. İletişim sekmesi, önizleme, teknik bilgi toplama, hata günlüğü
3. Worker, testler, dağıtım README'si, uçtan uca deneme (sahte uç nokta ile)
4. Gizlilik belgeleri, mağaza hazırlık dosyaları, ekran görüntüleri, lint, paketleme
Belirsiz yerde makul varsayım yap ve belirt. Mevcut çalışan özellikleri bozma.
