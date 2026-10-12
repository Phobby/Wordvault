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

## Client ID'yi nereye yazmalı

İki yol var:

- **Depoya girmeden (önerilen):** depo kökündeki `oauth.local.example.json` dosyasını
  `oauth.local.json` adıyla kopyala ve kimlikleri oraya yaz. Bu dosya `.gitignore` içindedir, commit
  edilmez. `node build.js` kimlikleri yalnızca `dist/` içindeki derlenmiş kopyaya yazar; `src/` içindeki
  dosya yer tutucularla kalır.
- **Doğrudan kaynakta:** `src/sync/config.js` içindeki yer tutucuyu değiştir. Kimlik o zaman depoya girer.

Aşağıda "`src/sync/config.js` içine yaz" denen her yerde ikisinden biri kastedilir. Client ID bir sır
değildir (eklentinin dağıtılan her kopyasında okunabilir); onu korumak değil, depoyu kişisel
tanımlayıcılardan uzak tutmak içindir. Asıl koruma, sağlayıcıdaki kayıtta yalnızca eklentinin
yönlendirme adreslerine izin verilmesi ve pakette client secret bulunmamasıdır.

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

## 3. OneDrive (Microsoft)

Kullanılan izinler: `Files.ReadWrite.AppFolder` (yalnızca uygulamanın kendi klasörü) ve
`offline_access` (bağlı kalabilmek için).

1. [Microsoft Entra yönetim merkezi](https://entra.microsoft.com/) → **Applications → App
   registrations → New registration**.
   - **Name:** Wordvault. (OneDrive'daki klasör bu adı alır: `Uygulamalar/Wordvault`.)
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft
     accounts". (Wordvault `common` uç noktasını kullanır; yalnızca kişisel hesaplara açılmış bir
     kayıt o uç noktada çalışmaz.)
   - **Redirect URI:** platform olarak **Single-page application (SPA)** seç ve 1. bölümdeki Chrome
     adresini yaz.
2. **Authentication** sayfasında aynı **Single-page application** platformuna Firefox adresini
   (`…extensions.allizom.org/`) da ekle. "Implicit grant" kutularını işaretleme.
3. **API permissions → Add a permission → Microsoft Graph → Delegated permissions:**
   `Files.ReadWrite.AppFolder` ve `offline_access`. Kendiliğinden eklenen `User.Read` kaldırılabilir.
4. **Certificates & secrets** boş kalır: client secret oluşturma.
5. **Overview** sayfasındaki **Application (client) ID**'yi `src/sync/config.js` içinde `onedrive`
   değerine yaz, yeniden derle.

**Neden "Single-page application":** Token isteği tarayıcı içinden yapılır ve `Origin` başlığı taşır.
Microsoft, secret'sız (PKCE ile) kod-token değişimini başka kaynaktan gelen isteklerde yalnızca bu
türdeki yönlendirme adresleri için yapar; "Web" ya da "Mobile and desktop" türünde kaydedilmiş adresle
"AADSTS9002326/9002327" hatası alınır.

**Bunun sonucu:** Bu türde yenileme token'ı 24 saat geçerlidir. Süresi dolunca Wordvault oturum açmayı
pencere açmadan (`prompt=none`) yineler; bu, kullanıcı o tarayıcıda Microsoft'ta oturumu açık tuttuğu
sürece çalışır. Aksi halde ayarlar sayfası "yeniden bağlan" der.

**Dosya nerede:** Kullanıcının OneDrive'ında `Uygulamalar (Apps) → Wordvault` klasöründe,
`wordvault-vault.json.gz` adıyla. Klasör ilk yazmada kendiliğinden oluşur.

**Politika:** Microsoft API Terms of Use ve Microsoft Graph veri kullanım koşullarına göre veri yalnızca
kullanıcının istediği işlev için kullanılır; Wordvault veriyi kendi tarafına almaz.

## 4. Dropbox

Kullanılan izinler: `files.content.read` ve `files.content.write`, yalnızca uygulamanın kendi
klasöründe.

1. [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
   - **Choose an API:** Scoped access.
   - **Type of access:** **App folder**. (Full Dropbox seçme.)
   - **Name:** benzersiz bir ad (örneğin `Wordvault-vault`). Dropbox'taki klasör bu adı alır:
     `Uygulamalar/<ad>`.
2. **Settings** sekmesi → **OAuth 2**:
   - **Redirect URIs:** 1. bölümdeki Chrome ve Firefox (`…extensions.allizom.org/`) adreslerini ekle.
   - **Allow public clients (Implicit Grant & PKCE):** Allow.
3. **Permissions** sekmesi: `files.content.write` ve `files.content.read` kutularını işaretle,
   **Submit**. (`account_info.read` varsayılan olarak açıktır; Wordvault onu kullanmaz, bu yüzden bağlı
   hesabın adı ayarlarda görünmez.)
4. **Settings** sekmesindeki **App key**'i `src/sync/config.js` içinde `dropbox` değerine yaz, yeniden
   derle. **App secret kullanılmaz.**
5. Uygulama "Development" durumundayken sınırlı sayıda kullanıcı bağlanabilir; herkese açmak için
   aynı sayfadan **Apply for production**.

Dropbox PKCE ile secret istemez ve `token_access_type=offline` ile süresi dolmayan bir yenileme token'ı
verir; bağlantı, kullanıcı kesene (ya da Dropbox ayarlarından uygulamayı kaldırana) kadar sürer.

**Dosya nerede:** Kullanıcının Dropbox'ında `Uygulamalar (Apps) → <uygulama adı>` klasöründe,
`wordvault-vault.json.gz` adıyla.

**Politika:** Dropbox Developer Terms & Conditions ve Developer Branding Guide'a göre veri yalnızca
kullanıcıya dönük işlev için kullanılır; ad ve logoda "Dropbox" sözcüğü uygulama adının başında
kullanılmaz.

## 5. Kurulumu sınamak

1. Eklentiyi yeniden yükle, ayarlar sayfasını aç.
2. **Senkronizasyon ve yedekleme → Bulut hesabı bağla**: sağlayıcının kartında "Yapılandırma eksik"
   rozeti artık görünmemeli.
3. **Bağlan → Devam et**: tarayıcı o adrese erişim izni sorar, sonra sağlayıcının oturum penceresi
   açılır. Onaylayınca bölümde hesabın, son eşitleme zamanı ve "güncel" durumu görünür.
4. İkinci bir tarayıcıda ya da cihazda aynı hesabı bağla: iki kasa birleşmeli.

Sağlayıcı "redirect_uri_mismatch" (ya da benzeri) derse kayıttaki yönlendirme adresi ile 1. bölümdeki
adres harfi harfine aynı değildir.
