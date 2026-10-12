# Kendi sunucunla eşitleme

Wordvault kasayı, bir bulut hesabı yerine senin çalıştırdığın (ya da güvendiğin) bir sunucuyla da
eşitleyebilir: Ayarlar → **Senkronizasyon ve yedekleme** → **Kendi sunucum**. İki tür desteklenir:

- **WebDAV** (Nextcloud, ownCloud, Apache `mod_dav` …): hazır bir sunucun varsa.
- **Basit HTTP uç noktası**: aşağıda anlatılan üç isteği karşılayan herhangi bir sunucu. Depoda tek
  dosyalık bir örneği var (`tools/self-hosted-server.js`).

Her iki türde de:

- Giden şey tek bir dosyadır: sıkıştırılmış kasa (`wordvault-vault.json.gz` biçimi; README'deki
  "Senkronizasyonun veri modeli"). Sayfa adresleri, ayarlar ve API anahtarları gitmez.
- Adres **https** olmalıdır. `http://` yalnızca kendi makinen (`localhost`, `127.0.0.1`) için kabul
  edilir.
- Tarayıcı, girdiğin adres için izni **bağlanırken** sorar; eklenti başka hiçbir adres için izin istemez.
- Kullanıcı adı, parola ve anahtar yalnızca bu tarayıcıda (`chrome.storage.local`) durur.
- İstersen ayarlardaki şifreleme seçeneğiyle dosyayı sunucuya şifreli gönderebilirsin.

## WebDAV

Girilecekler: **klasör adresi**, **kullanıcı adı**, **uygulama parolası**.

Nextcloud için klasör adresi `https://SUNUCU/remote.php/dav/files/KULLANICI/Wordvault/` biçimindedir.
Uygulama parolasını Nextcloud'da **Ayarlar → Güvenlik → Cihazlar ve oturumlar** altından oluştur; asıl
parolanı girme. Klasör yoksa Wordvault oluşturur; dosya o klasörde `wordvault-vault.json.gz` adıyla
durur.

Wordvault'un kullandığı istekler:

| İstek | Ne için |
| --- | --- |
| `PROPFIND <klasör>` (`Depth: 0`) | Bağlanırken: klasör var mı, parola doğru mu |
| `MKCOL <klasör>` | Klasör yoksa oluşturmak |
| `GET <klasör>/wordvault-vault.json.gz` | Dosyayı ve `ETag`'ini okumak |
| `PUT <klasör>/wordvault-vault.json.gz` | Yazmak: `If-Match: <etag>` ile, dosya henüz yoksa `If-None-Match: *` ile |
| `DELETE <klasör>/wordvault-vault.json.gz` | "Buluttaki dosyayı da sil" seçilirse |

Kimlik doğrulama HTTP Basic'tir. Sunucu `PUT` cevabında yeni `ETag`'i vermezse Wordvault bir `HEAD` ile
sorar. Hiç `ETag` vermeyen bir sunucuda koşullu yazma yapılamaz: son yazan kazanır, ezilen değişiklik
ilgili cihazın bir sonraki eşitlemesinde yeniden birleştirilir (kelime kaybolmaz).

## Basit HTTP uç noktası

Girilecekler: **sunucu adresi** ve **anahtar**. Wordvault adresin sonuna `/vault` ekler.

Her istek `Authorization: Bearer <anahtar>` başlığını taşır.

### `GET /vault`

- `200`: gövde saklanan belgedir (ikili), `ETag` başlığı belgenin sürümüdür.
- `404`: henüz saklanan belge yok.
- `401`: anahtar yok ya da yanlış.

### `PUT /vault`

Gövde yeni belgedir (ikili, `Content-Type: application/octet-stream`). İstek şu iki koşuldan birini
taşır:

- `If-Match: <etag>`: yalnızca saklanan belge hâlâ o sürümdeyse yaz.
- `If-None-Match: *`: yalnızca saklanan belge yoksa yaz.

Cevaplar:

- `200` ya da `201`: yazıldı; `ETag` başlığı yeni sürümdür.
- `412`: koşul sağlanmıyor (araya başka bir cihaz girdi). Wordvault yeniden okur, birleştirir ve yeniden
  yazar; en fazla beş kez dener.
- `413` ya da `507`: yer yok. Wordvault kullanıcıya bildirir, kasa yerelde kalır.
- `401`: anahtar yok ya da yanlış.

Koşulun sınanması ile yazma **tek adımda** olmalıdır; aksi halde aynı anda yazan iki cihazın ikisi de
başarılı olabilir.

### `DELETE /vault`

Saklanan belgeyi siler (`204`; belge yoksa `404` de kabul edilir).

### Diğer

- `ETag` belgenin içeriğiyle değişen herhangi bir değer olabilir (örnek sunucuda içeriğin özeti).
  Wordvault onu olduğu gibi geri gönderir.
- `429` ve `5xx` cevapları "sonra dene" sayılır; Wordvault sessizce 1, 2, 4 … dakika sonra yeniden dener.
- Eklenti, bağlanırken tarayıcıdan o adrese erişim izni aldığı için CORS başlıkları gerekmez.

## Örnek sunucu

`tools/self-hosted-server.js` bu protokolü uygulayan tek dosyalık bir Node programıdır; bağımlılığı
yoktur (Node 22 ya da üstü).

```sh
WORDVAULT_KEY=$(openssl rand -hex 24) node tools/self-hosted-server.js
```

Anahtarı kendin belirleyip not al; Wordvault'ta **Anahtar** alanına onu gireceksin.

| Ortam değişkeni | Anlamı | Varsayılan |
| --- | --- | --- |
| `WORDVAULT_KEY` | Eklentinin göndermesi gereken anahtar (zorunlu, en az 16 karakter) | |
| `PORT` | Dinlenecek port | `8787` |
| `HOST` | Dinlenecek adres | `127.0.0.1` (yalnızca bu makine) |
| `WORDVAULT_DATA` | Belgenin tutulduğu klasör | `./wordvault-data` |

Denemek için aynı makinede: Wordvault'ta **Kendi sunucum → Basit HTTP uç noktası**, adres
`http://localhost:8787`, anahtar yukarıdaki değer.

Elle sınamak için:

```sh
curl -i -H "Authorization: Bearer $WORDVAULT_KEY" http://localhost:8787/vault            # 404: henüz yok
printf 'deneme' | curl -i -X PUT --data-binary @- -H "Authorization: Bearer $WORDVAULT_KEY" -H 'If-None-Match: *' http://localhost:8787/vault   # 201 + ETag
printf 'ikinci' | curl -i -X PUT --data-binary @- -H "Authorization: Bearer $WORDVAULT_KEY" -H 'If-None-Match: *' http://localhost:8787/vault   # 412
```

**Başka cihazlardan erişmek için** sunucuyu doğrudan internete açma: düz HTTP konuşur. Önüne TLS
sonlandıran bir şey koy (Caddy, nginx, bir tünel) ve Wordvault'a o `https://` adresini ver. Örneğin
Caddy ile:

```
vault.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Sunucu tek bir belge tutar; birden fazla kişi kullanacaksa her biri için ayrı anahtar ve ayrı veri
klasörüyle ayrı bir kopya çalıştır.
