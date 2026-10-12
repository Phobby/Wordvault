# Wordvault gizlilik politikası

Wordvault bir tarayıcı eklentisidir. **Kendi sunucusu yoktur**: geliştirici hiçbir veriyi toplamaz,
görmez ve saklamaz. Eklentide analitik, izleme, reklam ya da kullanım ölçümü bulunmaz.

Bu belge, verinin tarayıcıdan ne zaman, neden ve nereye çıktığını eksiksiz sayar.

## Tarayıcıda kalanlar

Aşağıdakiler yalnızca kullandığın tarayıcıda (`chrome.storage.local`) durur:

- **Kasa:** kaydettiğin kelimeler, çevirileri, dil çiftleri, bağlam cümlesi, kaydedildiği sayfanın
  adresi ve başlığı, sözlük bilgisi, tekrar ilerlemen.
- **Ayarlar:** hedef dil, quiz ayarları, site bazlı kaynak dil seçimleri.
- **Senkronizasyon bilgileri:** hangi yolu seçtiğin, bağlandığın hesabın erişim token'ları, kendi
  sunucunun adresi, kullanıcı adı, parolası ya da anahtarı, şifreleme anahtarı (hatırlamasını
  istediysen).

Eklentiyi kaldırdığında tarayıcı bunların hepsini siler.

## Tarayıcıdan çıkanlar

Veri yalnızca aşağıdaki durumlarda ve yalnızca belirtilen yere gider.

### Çeviri (her zaman, senin isteğinle)

Bir kelimeye çift tıkladığında ya da çeviri istediğinde **seçtiğin metin** ve dil çifti, çeviri
sağlayıcısına gönderilir (varsayılan: MyMemory, `api.mymemory.translated.net`). Sayfanın geri kalanı,
adresi ya da kimliğin gönderilmez. Sağlayıcının kendi gizlilik politikası geçerlidir.

YouTube'da altyazıdaki bir kelimenin üzerinde imleci tuttuğunda da aynı şey olur: **yalnızca o kelime**
ve dil çifti gönderilir. Altyazı satırı dili algılamak için tarayıcının içinde kullanılır, kelimeyi
kasaya eklersen onunla birlikte saklanır; altyazı akışı kaydedilmez ya da indirilmez.

### Ekrandan metin tarama (yalnızca sen başlattığında)

Taramayı kısayolla ya da menüden başlattığında, o sekmenin o anki ekran görüntüsü alınır ve seçtiğin
alan **bu tarayıcının içinde** okunur (Tesseract.js; motor ve dil verisi eklentinin içindedir, ağdan
hiçbir şey indirilmez). Görüntü ve ondan okunan metin cihazından çıkmaz, hiçbir yere kaydedilmez;
okuma bitince görüntü bellekten atılır. Eklentinin sekmelerin görüntüsünü kendiliğinden alma izni
yoktur (`activeTab`: yalnızca senin başlattığın anda, yalnızca o sekme). Bulut OCR kullanılmaz.
Okunan bir kelimeye tıklarsan yalnızca **o kelime** çeviri servisine gider; kasaya eklersen kelime,
okunan satırıyla birlikte kasada saklanır.

### Sözlük ve telaffuz (kelimeyi kasaya eklediğinde ya da dinlediğinde)

Kasaya eklediğin kelime, türünü ve örnek cümlelerini almak için Wiktionary'ye
(`en.wiktionary.org`) sorulur. Firefox tabanlı tarayıcılarda macOS'te telaffuz düğmesine bastığın
kelimenin ses kaydı Wikimedia Commons'tan (`upload.wikimedia.org`) indirilir. Diğer durumlarda
telaffuz cihazındaki seslerle yapılır ve hiçbir yere istek gitmez.

### Senkronizasyon (yalnızca sen açarsan)

Varsayılan **"Sadece bu cihaz"**tır: hiçbir şey gönderilmez. Ayarlardan bir yol seçip neyin nereye
gideceğini anlatan onayı verdiğinde kasan **senin seçtiğin yere** gönderilir:

| Seçtiğin yol | Veri nereye gider |
| --- | --- |
| Tarayıcı senkronu | Tarayıcının kendi senkron deposuna (Firefox Sync / Chrome senkronu); tarayıcı hesabınla taşınır |
| Google Drive | Kendi Google Drive'ında, uygulamanın gizli veri klasörüne |
| OneDrive | Kendi OneDrive'ında, `Uygulamalar/Wordvault` klasörüne |
| Dropbox | Kendi Dropbox'ında, uygulamanın klasörüne |
| Kendi sunucum | Girdiğin WebDAV ya da HTTP adresine |

**Gönderilen:** her kelime, çevirisi, dil çifti, kısa bağlam cümlesi (en çok 160 karakter), tekrar
ilerlemesi (kutu, sonraki tekrar zamanı, cevap özeti) ve silinen kelimelerin silme kayıtları.

**Asla gönderilmeyen:** sayfa adresleri ve başlıkları, ayarlar, API anahtarları, erişim token'ları,
sunucu parolaları, çeviri önbelleği, quiz zamanlayıcısının durumu.

İstekler tarayıcından doğrudan o hizmete yapılır; arada geliştiriciye ait bir sunucu yoktur. Bulut
sağlayıcılarından yalnızca en dar izin istenir (uygulamaya özel klasör); diğer dosyaların görülemez.
Erişim token'ları yalnızca tarayıcında durur ve hiçbir yere eşitlenmez.

**Şifreleme (isteğe bağlı):** Açarsan dosya, tarayıcından çıkmadan önce parolandan türetilen bir
anahtarla şifrelenir (PBKDF2 + AES-256-GCM); saklandığı yer içeriğini okuyamaz. Parola hiçbir yerde
saklanmaz. Parolayı kaybedersen uzaktaki kopya kurtarılamaz; cihazındaki kasa etkilenmez.

**Durdurmak ve silmek:** Ayarlardan **Bağlantıyı kes** eşitlemeyi durdurur; "buluttaki dosyayı da sil"
seçeneği uzaktaki dosyayı kaldırır. Dosyayı ilgili hizmetin kendi arayüzünden de silebilirsin (Google
Drive: Ayarlar → Uygulamaları yönet → Wordvault; OneDrive ve Dropbox: Uygulamalar klasörü).

### Sistem bildirimi (yalnızca izin verirsen)

Quiz başka hiçbir yolla gösterilemediğinde tarayıcının bildirim sistemi kullanılabilir. Bildirim
metninde kelime ya da kişisel veri bulunmaz.

## İzinler

Eklentinin istediği her iznin gerekçesi `README.md` dosyasının "İzinler" bölümündedir. Tarayıcı
hesabının e-posta adresi istenmez. Bulut ve sunucu adreslerine erişim izni kurulumda değil, o yolu
seçip bağlandığın anda ve yalnızca o adres için istenir.

## Üçüncü taraf hizmetlerin koşulları

Seçtiğin hizmetin kendi koşulları geçerlidir. Wordvault, Google API Services User Data Policy'nin
"Limited Use" gereklerine, Microsoft API Terms of Use'a ve Dropbox Developer Terms'e uygun davranır:
bu hizmetlerden alınan veri yalnızca kasanın eşitlenmesi için kullanılır, başka kimseye aktarılmaz,
reklam ya da profil çıkarma için kullanılmaz, insanlar tarafından okunmaz.

## Çocuklar

Wordvault kimseden kişisel veri toplamaz; yaş sınırı gerektiren bir veri işleme yoktur.

## Değişiklikler

Bu belge eklentiyle birlikte sürümlenir. Tarayıcıdan çıkan veride bir değişiklik olursa burada ve
sürüm notlarında belirtilir.
