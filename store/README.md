# Mağaza hazırlığı

Chrome Web Store (ve addons.mozilla.org) gönderimi için hazır metinler ve görseller.

| Dosya | İçinde ne var |
| --- | --- |
| `listing.md` | Ad, kısa açıklama (≤ 132 karakter), uzun açıklama (en, tr), kategori, görsellerin listesi |
| `permissions.md` | Her izin için panele yapıştırılacak gerekçe |
| `privacy-practices.md` | Tek amaç, uzak kod beyanı, veri kullanım beyanı, AMO beyanı |
| `test-instructions.md` | İnceleyiciler için test adımları |
| `screenshots/` | 1280×800 ekran görüntüleri |
| `promo-440x280.png` | Küçük tanıtım görseli (taslak) |

Gizlilik politikası: `PRIVACY.md` (tr) ve `docs/privacy.html` (en + tr, web sürümü).

## Paketleme

```sh
npm run package
```

`dist/` klasörlerini derler ve `web-ext-artifacts/` altına iki zip yazar (git'e girmez):
`wordvault-<sürüm>-chrome.zip` ve `wordvault-<sürüm>-firefox.zip`. Zip'in kökünde `manifest.json` durur.

## Gönderimden önce kontrol listesi

- [ ] `src/config.js`: `SUPPORT_URL` ve `FEEDBACK_ENDPOINT` gerçek adresler (yer tutucu ya da `localhost` değil).
- [ ] `npm test` ve `npm run lint` temiz (lint: 0 hata; 3 uyarı değiştirilmemiş Tesseract dosyalarından).
- [ ] `manifest.*.json` ve `package.json` sürümü aynı ve bir öncekinden büyük.
- [ ] `npm run package`, zip'i temiz bir tarayıcı profilinde yükleyip `test-instructions.md` adımlarını dene.
- [ ] Gizlilik politikası adresi herkese açık ve açılıyor.
- [ ] Panelde: açıklamalar, görseller, tek amaç, izin gerekçeleri, veri beyanı, test talimatları.

## Açık kalanlar (geliştiricinin yapacağı)

- **Gizlilik politikasının adresi.** `docs/privacy.html` GitHub Pages için hazır, ama depo özel; ücretsiz
  GitHub hesabında Pages yalnızca herkese açık depolarda çalışır. Seçenekler: depoyu herkese açmak,
  yalnızca bu dosyayı içeren ayrı bir herkese açık depo açmak, ya da dosyayı başka bir yerde yayınlamak.
- **Geliştirici iletişim e-postası.** Chrome Web Store hesabı bir iletişim adresi ister ve onu mağaza
  sayfasında gösterir. Gizlilik politikası silme talepleri için o adrese de atıf yapıyor. Depoda e-posta
  adresi yoktur.
- **Chrome'daki `key` alanı.** Manifestteki `key` geliştirici modunda kimliği sabitlemek içindir.
  Mağazaya yüklenen pakette durabilir (mağaza kendi anahtarını kullanır ve bu alanı yok sayar ya da
  kaldırmanı ister); mağazanın verdiği kimlik farklı olursa Google OAuth istemcisindeki yönlendirme
  adresi ona göre güncellenmelidir (`SETUP-OAUTH.md`).
- **Bulut sağlayıcıları.** OneDrive ve Dropbox istemci kimlikleri hâlâ yer tutucu; ayarlarda "yapılandırma
  eksik" görünürler. Google Drive için OAuth izin ekranı "test" kipindeyse yalnızca eklenen test
  kullanıcıları bağlanabilir; herkese açmak Google'ın doğrulamasını gerektirebilir.
- **Tanıtım görseli** bir taslaktır.
