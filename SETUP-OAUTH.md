# Bulut sağlayıcıları için OAuth kurulumu

Wordvault'un "Bulut hesabı bağla" seçeneği (Google Drive, OneDrive, Dropbox) ancak eklenti o
sağlayıcıya **uygulama olarak kaydedildiyse** çalışır. Kaydı eklentiyi derleyip dağıtan kişi bir kez
yapar; kullanıcıların bir şey yapması gerekmez. Kayıttan çıkan **client ID** `src/sync/config.js`
dosyasına yazılır.

Bu kurulum yapılmadan da çalışanlar: **Sadece bu cihaz**, **Tarayıcı senkronu** ve **Kendi sunucum**.
Kurulumu yapılmamış sağlayıcının kartı ayarlar sayfasında "Yapılandırma eksik" rozetiyle görünür.

- Pakette **client secret yoktur** ve olmamalıdır. Aşağıdaki adımlarda bir secret gösterilirse onu
  hiçbir yere yazma.
- Client ID gizli değildir; eklentinin her kopyasında bulunur.
- İstenen izinler en dar olanlardır: her sağlayıcıda yalnızca uygulamaya özel klasör.

## 1. Eklentinin kimliği ve yönlendirme adresleri

Sağlayıcı, kullanıcıyı oturum açtıktan sonra eklentiye geri gönderir. Bu adres eklentinin kimliğinden
türer, bu yüzden kimlik sabittir (Chrome'da manifestteki `key`, Firefox'ta `gecko.id`):

| Tarayıcı | Eklenti kimliği | Yönlendirme adresi |
| --- | --- | --- |
| Chrome, Edge ve diğer Chromium tabanlılar | `caggefgbpnebadhdlcaijbfcgdocednk` | `https://caggefgbpnebadhdlcaijbfcgdocednk.chromiumapp.org/` |
| Firefox, Zen | `wordvault@phobby` | `https://4e1e83b4f82a40a825858d9d7610ba8b8558e84e.extensions.allizom.org/` |
| Firefox, Zen (yalnızca Google için) | aynı | `http://127.0.0.1/mozoauth2/4e1e83b4f82a40a825858d9d7610ba8b8558e84e` |

Adresleri kendin de görebilirsin: ayarlar sayfasını aç, geliştirici konsoluna
`chrome.identity.getRedirectURL()` yaz. Sondaki `/` adresin parçasıdır; sağlayıcılar adresi harfi
harfine karşılaştırır.

**Chrome kimliği hakkında:** `manifest.chrome.json` içindeki `key` yalnızca bir açık anahtardır ve
paketlenmemiş (geliştirici modunda yüklenen) eklentinin kimliğini sabitler. Özel anahtarı saklanmadı;
gerekmez. Eklentiyi Chrome Web Store'da yayınlarsan mağaza kendi anahtarını ve kimliğini atar: o zaman
mağazanın geliştirici panelindeki açık anahtarı `key` alanına koy (yerelde aynı kimlik için), yüklenen
pakette `key` alanını bırakma, ve aşağıdaki kayıtlara yeni kimliğin yönlendirme adresini ekle.

**Firefox adresi hakkında:** Firefox, Google gibi "yalnızca sahibi olduğun alan adına yönlendiririm"
diyen sağlayıcılar için `127.0.0.1` biçimini de kabul eder (Firefox 86+). Wordvault bu biçimi yalnızca
Google için kullanır.

## 2. Google Drive

Kullanılan izin: `https://www.googleapis.com/auth/drive.appdata` (yalnızca uygulamanın gizli veri
klasörü; kullanıcının dosyaları görülmez).

1. [Google Cloud Console](https://console.cloud.google.com/)'da yeni bir proje oluştur.
2. **APIs & Services → Library** altında **Google Drive API**'yi etkinleştir.
3. **Google Auth Platform** (eski adıyla OAuth consent screen) bölümünde:
   - **Branding:** uygulama adı (Wordvault) ve destek e-postası.
   - **Audience:** kullanıcı türü **External**. Yayın durumu "Testing" iken yalnızca **Test users**
     listesine eklediğin hesaplar bağlanabilir; herkese açmak için "Publish app".
   - **Data access:** `.../auth/drive.appdata` kapsamını ekle. Bu kapsam "non-sensitive" sınıfındadır.
4. **Clients → Create client**:
   - **Application type: Web application.**
   - **Authorized redirect URIs:** yukarıdaki tablodan Chrome adresini ve Firefox'un `127.0.0.1`
     adresini ekle.
   - "Authorized JavaScript origins" boş kalabilir.
5. Oluşan **Client ID**'yi (`….apps.googleusercontent.com`) `src/sync/config.js` içinde `gdrive`
   değerine yaz. Aynı ekranda gösterilen **client secret kullanılmaz**; hiçbir yere yazma.
6. `node build.js` ile yeniden derle ve eklentiyi yeniden yükle.

**Neden "Web application" ve neden secret'sız:** Bir eklentiye (`chromiumapp.org` ya da `127.0.0.1`
adresine) yönlendirebilen tek istemci türü budur. Google bu türde, PKCE kullanılsa bile, kod-token
değişiminde client secret ister; pakete konan secret ise secret değildir. Bu yüzden Wordvault Google'da
**örtük akışı** (`response_type=token`) kullanır: secret gerekmez, karşılığında yenileme token'ı da
verilmez.

**Bunun sonucu:** Erişim token'ı yaklaşık bir saat geçerlidir. Süresi dolunca Wordvault aynı isteği
pencere açmadan, sessizce (`prompt=none`) yineler; bu, kullanıcı o tarayıcıda Google'da oturumu açık
tuttuğu sürece çalışır. Oturum kapanmışsa eşitleme durur ve ayarlar sayfası "erişim geri alınmış ya da
süresi dolmuş; yeniden bağlan" der. Kasa bu sırada yerelde eksiksiz kalır.

**Dosya nerede:** Drive'ın gizli "uygulama verisi" klasöründe, `wordvault-vault.json.gz` adıyla.
Kullanıcı dosyaları arasında görünmez; Drive'da **Ayarlar → Uygulamaları yönet → Wordvault** altından
görülüp silinebilir.

**Politika:** Google API Services User Data Policy'nin "Limited Use" koşullarına göre veri yalnızca
kullanıcıya dönük özelliği (kasanın eşitlenmesi) sağlamak için kullanılır, başka yere aktarılmaz,
reklam için kullanılmaz, insanlar tarafından okunmaz. Wordvault'un sunucusu olmadığı için veri
tarayıcıdan doğrudan kullanıcının Drive'ına gider.

## 3. Kurulumu sınamak

1. Eklentiyi yeniden yükle, ayarlar sayfasını aç.
2. **Senkronizasyon ve yedekleme → Bulut hesabı bağla**: sağlayıcının kartında "Yapılandırma eksik"
   rozeti artık görünmemeli.
3. **Bağlan → Devam et**: tarayıcı o adrese erişim izni sorar, sonra sağlayıcının oturum penceresi
   açılır. Onaylayınca bölümde hesabın, son eşitleme zamanı ve "güncel" durumu görünür.
4. İkinci bir tarayıcıda ya da cihazda aynı hesabı bağla: iki kasa birleşmeli.

Sağlayıcı "redirect_uri_mismatch" (ya da benzeri) derse kayıttaki yönlendirme adresi ile 1. bölümdeki
adres harfi harfine aynı değildir.
