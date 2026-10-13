# Wordvault geri bildirim alıcısı

Eklentinin "İletişim ve geri bildirim" sekmesinden gelen mesajı alır, denetler, Telegram'a (ya da
Discord'a) iletir ve unutur. Cloudflare Worker, ücretsiz plan, bağımlılık yok.

```
eklenti  --POST /feedback-->  Worker  --sendMessage-->  Telegram botu  -->  sen
```

Eklenti yalnızca Worker'ın adresini bilir. Bot token'ı ve sohbet kimliği yalnızca Worker'ın
sırlarında durur; depoda, `wrangler.toml` içinde ya da eklenti paketinde **yoktur**.

## Ne yapar

- Tek adres: `POST /feedback`, JSON gövde. Başka her yol ve yöntem `404`.
- Gövde en fazla 8 KB (`413 too_large`). Alanlar eklentinin kurduğu şemaya uymalı
  (`src/validate.js`): izinli tür ve özellik listeleri, 10-1500 karakter metin, listede olmayan tek
  bir alan bile olmamalı. Kontrol karakterleri temizlenir. Uymayan istek `400` ve nedenini söyleyen
  bir kodla döner: `bad_json`, `bad_shape`, `bad_type`, `bad_feature`, `message_too_short`,
  `message_too_long`, `bad_email`, `bad_tech`, `bad_errors`.
- Gizli alan (`website`) doluysa `200 {"ok":true}` döner ama mesaj **iletilmez** (eklenti bu alanı
  hiç göndermez; dolduran bir bottur).
- Mesaj Telegram'a HTML kipinde gider; kullanıcının yazdığı her şey kaçışlanır (`<`, `>`, `&`).
- Saat alıcının kendi saatidir (istemcinin saatine güvenilmez), `Europe/Istanbul`, `tr-TR`.
- Hata kayıtları eklenmişse ikinci, kısaltılmış bir mesaj olarak gider (en yeniler, kayıt başına
  yığının ilk iki satırı).
- CORS başlığı yoktur: istek eklentinin arka plan betiğinden gelir, bir web sayfasından değil.

Mesaj biçimi:

```
🐞 Hata · Flash card / quiz
🕒 13.10.2026 14:35 (İstanbul)

Kart sol kenardan kırpılıyor, şıklar boş görünüyor.

✉️ biri@ornek.com
🧩 Zen 1.16 (Gecko 143.0) · macOS · Wordvault 0.1.0 · dil: tr
Açık: doubleClick, quiz
Kapalı: ttsFallback, ocrRememberArea, ocrShowBoxes, sync, syncEncryption
Senkron: off
📎 2 hata kaydı sonraki mesajda
```

> Şartnamedeki örnek biçim elime ulaşmadığı için bu biçim bir varsayımdır; `src/format.js` içinde
> tek bir işlevdir, değiştirmesi kolaydır.

## Ne saklar, ne kaydeder

**Hiçbir mesajı saklamaz, hiçbir şeyi günlüğe yazmaz.**

- Kodda tek bir `console` çağrısı yoktur; `wrangler.toml` içinde Cloudflare'in günlük toplaması da
  kapalıdır (`[observability] enabled = false`).
- IP adresi tek bir yerde, hız sınırı için okunur ve Cloudflare'in sınırlayıcısına anahtar olarak
  verilir; Worker onu saklamaz, iletmez, yazmaz. IP'yi Cloudflare'in altyapısı her istekte zaten görür;
  bunu Worker engelleyemez.
- İsteğin `Origin` başlığı (Firefox'ta kuruluma özgü bir kimlik taşır), yönlendiren adres ve
  kullanıcı aracısı hiç okunmaz.
- Günlük tavan açıksa saklanan tek şey gün başına bir **sayıdır** (`count:2026-10-13` → `"37"`), iki
  gün sonra kendiliğinden silinir. Mesajla ya da gönderenle ilgili hiçbir şey içermez.
- Hata olursa yanıt yalnızca bir koddur; ayrıntı (içinde token ya da mesaj olabilir) dışarı verilmez.

Bunların testi var: `test/worker.test.js` kaynakta `console` çağrısı, başka başlık okuması ya da
birden fazla yazma olmadığını da denetler.

## Hız sınırı: neyi seçtim, neden

İki katman var.

**1. Gönderen başına: Workers Rate Limiting bağlayıcısı** (`[[ratelimits]]`, 60 saniyede 3 istek).

Şartnamedeki iki seçenekten bunu seçtim. Diğeri (KV'de tuzlanmış IP özeti, 1 gün TTL) şu yüzden
elendi:

- IP'nin özetini bir gün boyunca **saklar**; tuzlansa da bu, gönderenden türetilmiş bir kaydın
  tutulmasıdır ve "hiçbir şeyi kalıcı saklama" kuralına aykırıdır. Bağlayıcıda sayaçlar Cloudflare'in
  o konumdaki makinelerinde geçici olarak durur, Worker'ın eriştiği bir depoya yazılmaz.
- KV'nin ücretsiz planında günde 1000 yazma hakkı vardır; her istek bir yazma demek olur ve bir
  saldırgan bu hakkı dakikalar içinde bitirip sınırlayıcıyı işlemez hale getirir.
- KV yazmaları geç yayılır (aynı anahtara saniyede bir yazma, okumada gecikme); hızlı art arda
  gelen istekleri kaçırır.

Bağlayıcının bilinen sınırları (Cloudflare'in belgesinden): sayaç **konum başınadır** (başka bir
veri merkezine düşen istek ayrı sayılır), kesin değil "yaklaşık"tır ve süre yalnızca 10 ya da 60
saniye olabilir. Cloudflare IP'yi anahtar olarak önermez, çünkü aynı IP'yi birçok kişi paylaşabilir
(mobil ağlar); kimliksiz bir uç noktada başka bir anahtar olmadığı için yine de IP kullanılıyor.
Sonuç: aynı ağdan dakikada 3'ten fazla mesaj atan dürüst kullanıcılar `429` alır ve eklenti "sonra
yeniden dene" der; taslak kaybolmaz.

**2. Herkes için günlük tavan: KV'de tek bir sayaç** (`DAILY_LIMIT`, varsayılan 200; isteğe bağlı).

Birinci katman tek bir saldırganı yavaşlatır ama çok sayıda IP'den gelen bir saldırıyı durdurmaz.
Tavan, en kötü günde bile Telegram'a düşecek mesaj sayısını sınırlar; aşılınca `429 daily_limit`
döner. Yalnızca **iletilen** mesajlar sayılır, yani günde en fazla 200 yazma yapılır (ücretsiz hak
1000). Sayaç da yaklaşıktır (KV geç yayılır); birkaç mesaj fazla geçebilir. `DAILY` bağlayıcısı
tanımlı değilse tavan uygulanmaz.

> **Doğrulanmayan:** Rate Limiting bağlayıcısının ücretsiz planda kullanılabildiğini Cloudflare'in
> belgesinde açıkça yazılı bulamadım; `wrangler deploy --dry-run` yapılandırmayı kabul ediyor ama
> gerçek bir hesapta denemedim. Dağıtımda bağlayıcı reddedilirse `wrangler.toml` içindeki
> `[[ratelimits]]` bölümünü sil: kod bağlayıcı yokken de çalışır (o durumda yalnızca günlük tavan
> korur, bu yüzden 5. adımı mutlaka yap).

## Kurulum

Gerekenler: bir Cloudflare hesabı (ücretsiz), Node.js, Telegram.

### 1. Bot oluştur

1. Telegram'da **@BotFather**'ı aç, `/newbot` yaz.
2. Bir ad ve `bot` ile biten bir kullanıcı adı ver (ör. `wordvault_feedback_bot`).
3. BotFather bir **token** verir (`123456789:AA…`). Bunu kimseyle paylaşma, hiçbir dosyaya yazma.

### 2. Sohbet kimliğini al

1. Yeni botunu aç ve **Start**'a bas (ya da herhangi bir mesaj yaz). Bot, sen yazmadan sana yazamaz.
2. Tarayıcıda şunu aç (token'ı yerine koy):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Yanıttaki `"chat":{"id":123456789,…}` sayısı sohbet kimliğindir.

Mesajların bir gruba düşmesini istersen botu gruba ekle, grupta bir mesaj yaz ve aynı adresten
grubun kimliğini al (eksi işaretiyle başlar).

### 3. Cloudflare'e giriş

```sh
cd feedback-worker
npx wrangler login
```

### 4. Sırları koy

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Her komut değeri sorar; yapıştır ve Enter'a bas. Değerler Cloudflare'de şifreli durur, depoya girmez.
(İlk komut Worker henüz yoksa oluşturmayı önerir; kabul et.)

### 5. Günlük tavanı aç (önerilir)

```sh
npx wrangler kv namespace create DAILY
```

Çıktıdaki `id` değerini `wrangler.toml` içindeki `[[kv_namespaces]]` bölümüne yaz ve o üç satırın
başındaki `#` işaretlerini kaldır. Bu kimlik bir sır değildir, depoda durabilir.

### 6. Dağıt

```sh
npx wrangler deploy
```

Çıktıda adres görünür: `https://wordvault-feedback.<hesap-adın>.workers.dev`.

### 7. `curl` ile dene

```sh
curl -i -X POST https://wordvault-feedback.<hesap-adın>.workers.dev/feedback \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"type":"other","feature":"other","message":"curl ile deneme mesajı"}'
```

`200` ve `{"ok":true}` dönmeli, Telegram'a mesaj düşmeli. Sonra:

```sh
# 404 olmalı
curl -i https://wordvault-feedback.<hesap-adın>.workers.dev/feedback
# 400 message_too_short olmalı
curl -i -X POST https://wordvault-feedback.<hesap-adın>.workers.dev/feedback -d '{"v":1,"type":"bug","feature":"quiz","message":"kısa"}'
```

`502 delivery_failed` dönerse token ya da sohbet kimliği yanlıştır ya da bota hiç yazmamışsındır.

### 8. Eklentiye adresi yaz

`src/config.js` içinde:

```js
export const FEEDBACK_ENDPOINT = 'https://wordvault-feedback.<hesap-adın>.workers.dev/feedback';
```

`node build.js`, eklentiyi yenile. İlk gönderimde tarayıcı yalnızca bu alan adı için izin sorar.

## Dağıtmadan denemek

```sh
node feedback-worker/dev-server.js
```

Alıcıyı bu bilgisayarda `http://localhost:8787/feedback` adresinde çalıştırır. Telegram'a hiçbir şey
gitmez; gidecek mesaj terminale yazılır. `FEEDBACK_ENDPOINT`'e bu adresi yazıp derlersen formu uçtan
uca deneyebilirsin (yayınlamadan önce gerçek adrese geri çevir).

## Discord'a göndermek

`wrangler.toml` içinde `FEEDBACK_CHANNEL = "discord"` yap, kanalın webhook adresini sır olarak koy
ve yeniden dağıt:

```sh
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler deploy
```

Mesajlarda kimse etiketlenemez (`allowed_mentions` boş), bağlantı önizlemesi kapalıdır.

## Spam olursa

Sırayla, hafiften ağıra:

1. **Sessize al.** Telegram'da botun sohbetini sessize almak anında etkilidir.
2. **Tavanı düşür.** `wrangler.toml` içinde `DAILY_LIMIT = "20"` yap, `npx wrangler deploy`.
3. **Uç noktayı kapat.** Sırrı silmek alıcıyı susturur; istekler `502` alır, sana hiçbir şey düşmez:
   ```sh
   npx wrangler secret delete TELEGRAM_BOT_TOKEN
   ```
   Tamamen kaldırmak için: `npx wrangler delete`.
4. **Sırrı değiştir.** Token'ın sızdığından şüphelenirsen (Worker'dan sızamaz; ama başka bir yere
   yazdıysan) BotFather'da `/revoke` ile yenisini al ve `npx wrangler secret put TELEGRAM_BOT_TOKEN`
   ile koy. Eski token o anda geçersiz olur.
5. **Adresi değiştir.** `wrangler.toml` içinde `name`'i değiştirip dağıt, eskisini `npx wrangler
   delete --name wordvault-feedback` ile sil, `FEEDBACK_ENDPOINT`'i güncelleyip eklentinin yeni
   sürümünü yayınla. Eski sürümdeki kullanıcılar "gönderilemedi" görür, taslakları kaybolmaz.

Not: adres eklenti paketinde herkese açıktır; gizli tutulamaz. Koruma adresin gizliliğinde değil,
yukarıdaki sınırlardadır.

## Testler

```sh
npm test            # depo kökünde: eklenti + Worker testleri
cd feedback-worker && npm test   # yalnızca Worker
```

Şema doğrulama, kaçış, boyut sınırı, gizli alan, mesaj biçimi, hız sınırı, günlük tavan, Telegram
hatası, Discord ve "hiçbir şey günlüğe yazılmaz" denetimleri (`test/worker.test.js`).
