# Wordvault: Ayarlardaki "Yedekleme" bölümünde bulut senkronizasyonu görünmüyor, nedenini bul ve düzelt

Ayarlar sayfasında yedekleme bölümünde yalnızca JSON dışa/içe aktarma görünüyor. SYNC-SPEC.md'de
tarif edilen "Senkronizasyon ve yedekleme" bölümü (Sadece bu cihaz / Tarayıcı senkronu / Bulut
hesabı bağla / Kendi sunucum) ve bulut hesabı bağlama sihirbazı ekranda yok. Önce mevcut kodu,
SPEC.md, SYNC-SPEC.md ve `git log` geçmişini oku.

## Aşama 1: Teşhis (bu aşamada kod değiştirme, önce rapor yaz)
Aşağıdakileri **kanıtla** (dosya yolu ve satır numarası ver), sonra bana kısa bir rapor sun:

1. **Özellik yazılmış mı?** `sync/` klasörü, `engine`, sağlayıcı dosyaları (Google Drive,
   WebDAV), birleştirme/tombstone kodu, `sync/config.js` var mı? Hangi parçalar var,
   hangileri eksik, hangileri yarım ya da sadece iskelet? Git geçmişinde SYNC-SPEC'in hangi
   aşamalarına karşılık gelen commit'ler var?
2. **Arka planda bağlı mı?** Arka plan betiği (background) sync motorunu içe alıyor ve
   başlatıyor mu? Alarmlar, mesaj dinleyicileri ve `storage` değişim dinleyicisi kaydediliyor mu?
   Yoksa kod var ama hiç çağrılmıyor mu (ölü kod)?
3. **Arayüze bağlı mı?** Ayarlar sayfasında (`options.html`/`options.js`) "Senkronizasyon ve
   yedekleme" bölümü var mı? Varsa neden gösterilmiyor: yanlış HTML dosyası mı düzenlenmiş
   (popup mı, options mı), bölüm gizli bir CSS sınıfıyla ya da özellik bayrağıyla (feature flag)
   kapalı mı, JS hatası bölümü çizmeden duruyor mu, `_locales` anahtarı eksik olduğu için mi boş
   kalıyor, çizimi bir koşula (ör. sağlayıcı yapılandırılmış mı) bağlı mı?
4. **Build ve yükleme:** `build.js` yeni dosyaları (`sync/`, yeni HTML/JS/CSS) `dist/chrome` ve
   `dist/firefox` içine kopyalıyor mu? `dist` içindeki ayarlar sayfası kaynaktakiyle aynı mı yoksa
   eski bir build mi? Manifest'te `options_ui`/`options_page` doğru dosyayı gösteriyor mu?
   İzinler (`identity`, `alarms`, `optional_host_permissions`) manifest'te var mı?
5. **Çalışma zamanı hatası:** Ayarlar sayfasında konsolda hata var mı (eksik modül, yanlış yol,
   CSP ihlali, `import` hatası)? Mümkünse sayfayı başsız bir tarayıcıyla ya da jsdom ile yükleyip
   hata ve görünen bölümleri kontrol et.

Raporda şunu açıkça söyle: **sebep hangisi** ve özellik şu durumlardan hangisinde:
(A) hiç yazılmamış, (B) yazılmış ama ön yüze bağlanmamış, (C) bağlanmış ama build/yol/hata yüzünden
görünmüyor, (D) yarım yazılmış.

## Aşama 2: Düzeltme (rapordan sonra, durmadan devam et)
- **(A) ya da (D):** SYNC-SPEC.md'yi baştan sona, aşama sırasıyla uygula. Zaten yazılmış kısımları
  yeniden yazma, üzerine ekle.
- **(B):** Var olan kodu arka plana ve ayarlar arayüzüne bağla. SYNC-SPEC bölüm 1'deki arayüzü
  (dört mod, sağlayıcı kartları, bağlanma sihirbazı, durum göstergesi, "Şimdi eşitle",
  "Bağlantıyı kes") ekle.
- **(C):** Kök nedeni düzelt (build kopyalaması, yanlış dosya, hata, bayrak).
- Her durumda hedef: Ayarlar > Yedekleme/Senkronizasyon bölümünde, JSON dışa/içe aktarmanın
  **altında** senkronizasyon seçenekleri açıkça görünsün.

## OAuth yapılandırması henüz yokken arayüz görünür kalmalı
Google için benim henüz client ID'm yok (`sync/config.js` içinde yer tutucu).
Bu yüzden sağlayıcı bölümünü gizleme. Bunun yerine:
- Sağlayıcı kartları **her zaman görünsün**. Client ID yer tutucuysa kart "Yapılandırma eksik" rozeti
  göstersin ve "Bağlan" düğmesine basınca kullanıcıya hatayı değil, açıklayıcı bir mesaj
  göstersin: "Bu sağlayıcı için geliştirici yapılandırması eksik" ve `SETUP-OAUTH.md` yönlendirmesi.
- OAuth gerektirmeyen modlar **hemen çalışsın ve test edilebilsin**: Sadece bu cihaz, Tarayıcı
  senkronu (`storage.sync`) ve Kendi sunucum (WebDAV/HTTP).
- Bağlan düğmesi sessizce hiçbir şey yapmasın. Her başarısızlıkta nedenini ekranda göster.

## Doğrulama
- `npm run build` (veya build betiği) çalıştır, `dist/chrome` ve `dist/firefox` içindeki ayarlar
  sayfasında senkronizasyon bölümünün **dosya olarak** bulunduğunu doğrula.
- Başsız tarayıcı (Playwright ile yüklü eklenti) ya da jsdom ile ayarlar sayfasını aç ve şunları
  otomatik kontrol et: bölüm görünür, dört mod seçilebilir, sağlayıcı kartları listelenir,
  yapılandırması eksik olanlar rozet gösterir, `storage.sync` modu seçilince durum güncellenir.
- İki cihaz yakınsama testleri ve birleştirme testleri (SYNC-SPEC bölüm 9) geçsin. `npx web-ext lint`
  temiz geçsin. Eski testler bozulmasın.
- Sonda bana şunları yaz: **kök neden neydi**, ne değiştirdin, ve eklentiyi Chrome'da
  (`chrome://extensions` > yenile) ve Zen/Firefox'ta (`about:debugging` > yeniden yükle) nasıl
  deneyip senkronizasyon bölümünü göreceğimi adım adım.

## Çalışma şekli
Aşama 1 raporunu yazdıktan sonra benden onay beklemeden Aşama 2'ye geç. Belirsiz bir yerde makul
varsayım yap ve belirt. Her mantıklı parçada ayrı commit at.
