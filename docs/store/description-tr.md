# Chrome Web Store description: Turkish

Paste into the dashboard under Store listing → **Add language → Türkçe**. Plain text: the store shows
line breaks but no Markdown. Keep it true to the code and to `PRIVACY.md`. AMO's
Turkish description accepts the same text.

## Kısa açıklama (en çok 132 karakter)

The store takes the short description from the package (`src/_locales/tr/messages.json`,
`extDescription`); it cannot be typed into the dashboard. Current text in the package (105):

```
Web sayfalarındaki ve video altyazılarındaki kelimeleri çevir, kasana kaydet ve kısa quizlerle tekrar et.
```

Proposed, if the package text is to be updated (116):

```
Sayfalarda ve YouTube altyazılarında kelimeleri anında çevir, kendi kasana kaydet, kısa flashcard quizleriyle öğren.
```

## Ayrıntılı açıklama

```
Okurken bilmediğin bir kelimeye mi takıldın? Çift tıkla, çevirisini hemen gör, okumaya devam et. Wordvault kelimeyi senin için saklar ve kısa quizlerle, yerine oturana kadar karşına çıkarır.

Wordvault, kelime öğrenmek için tasarlanmış bir çeviri eklentisi. Sözlüğe bakıp unutmak yerine kelimeleri okurken toplar, birkaç tanesini tekrar ederek kalıcı hâle getirirsin.

SAYFADAN AYRILMADAN ÇEVİR
• Herhangi bir kelimeye çift tıkla: çevirisi hemen yanında açılır, telaffuzunu dinleyebilirsin.
• Bir cümleyi ya da paragrafı seç; sağ tık menüsünden, seçimin yanındaki küçük "Çevir" düğmesinden ya da klavye kısayoluyla çevir.
• YouTube'da altyazıdaki kelimenin üzerine gel; videoyu bırakıp arama yapmana gerek kalmaz.
• Seçilemeyen yazılar için: videoyu durdur ya da resmi aç, yazının üzerine bir alan çiz; kelimeler tıklanabilir hâle gelir. Yazı kendi cihazında okunur (İngilizce ve Türkçe metin).
• Çeviriler varsayılan olarak ücretsiz çeviri servisi MyMemory'den gelir. DeepL API anahtarın varsa onu da kullanabilirsin.

KENDİ KELİME KASANI OLUŞTUR
• "Kasaya ekle"ye bir kez basman yeter: kelime, geçtiği cümleyle birlikte, Wiktionary'den tanımları ve örnek cümleleriyle kaydedilir.
• Kasanda ara, dile göre süz; deyim ve kalıpları tek kelimelerden ayrı tut.
• Kasanı istediğin zaman dosyaya aktar, başka bir tarayıcıda içe al.

FLASHCARD QUİZLERİYLE TEKRAR ET
• Wordvault ara sıra kaydettiğin birkaç kelimeyi sorar: sayfada küçük bir kart olarak, araç çubuğu penceresinde ya da ayrı bir pencerede. Ne sıklıkla sorulacağını ve hangi saatlerde susacağını sen seçersin.
• Dört çalışma biçimi: dört şıktan anlamı seç, kelimeyi yaz, dinleyip seç ya da dinleyip yaz.
• Aralıklı tekrar: bilemediğin kelimeler daha erken, iyi bildiklerin giderek daha seyrek gelir.
• Bir kelime ancak farklı günlerde art arda doğru cevaplanınca "öğrenildi" sayılır; ilerlemen gerçekten bir şey ifade eder.
• Günlük hedef, seri ve Rookie'den Legend'a uzanan rütbeler ne kadar yol aldığını gösterir. İstersen akşam hatırlatıcısı, günün quizini yapmadıysan seni bir kez uyarır.

İSTEĞE BAĞLI YAPAY ZEKÂ ÖZELLİKLERİ (sağlayıcı bağlayana kadar kapalı)
Bunlar için kendi yapay zekâ sağlayıcın gerekir: Google Gemini, Anthropic'in Claude'u, NVIDIA ya da OpenAI uyumlu herhangi bir servisten alacağın bir API anahtarı veya kendi bilgisayarında çalışan Ollama (anahtar gerekmez). Wordvault bu şirketlerin hiçbiriyle bağlantılı değildir; olası ücretler senin ile seçtiğin sağlayıcı arasındadır, Wordvault bunun için hiçbir ücret almaz.
• "Yapay zekâ ile açıkla": bir kelimenin, cümlenin ya da paragrafın bağlam içindeki anlamı.
• "Görsel hakkında sor": ekranın bir bölümü hakkında soru sor.
• "Sayfayı özetle" ve "Sayfayı yapay zekâ ile çevir". Bir şey gönderilmeden önce kart, ne kadar metnin nereye gideceğini gösterir; çevrilen sayfa her zaman eski hâline döner.
• "Yapay zekâ ile sınav oluştur": kasandaki kelimelerden, cevap anahtarıyla birlikte yazdırılabilir A4 alıştırma sınavı (boşluk doldurma, doğru/yanlış). Ekranda kontrol et ya da yazdır.
API anahtarın tarayıcında kalır ve yalnızca ait olduğu sağlayıcıya gider. Banka, e-posta ya da sağlık sitesi gibi görünen sitelerde yapay zekâ özellikleri kapalıdır.

İSTEĞE BAĞLI CİHAZLAR ARASI EŞİTLEME
Kasanı birden çok bilgisayarda güncel tut: tarayıcının kendi senkronuyla, kendi Google Drive'ınla ya da kendi WebDAV sunucunla. Google Drive için kendi Google hesabın gerekir; dosya yalnızca Wordvault'un görebildiği gizli bir klasöre kaydedilir ve istersen kendi belirlediğin bir parolayla şifrelenir. Eşitleme sen açana kadar kapalıdır.

GİZLİLİK
Hesap yok, reklam yok, analitik yok, izleme yok. Kasan tarayıcında durur; Wordvault'un kelimelerini ya da gezdiğin sayfaları alan bir sunucusu yoktur. Çeviri servisine yalnızca çevirmesini istediğin metin gider. Ekran taramasındaki görüntü cihazında okunur ve saklanmaz. Geri bildirim formu tam olarak neyi göndereceğini gösterir ve yalnızca "Gönder"e bastığında gönderir. Ayrıntılar: https://phobby.github.io/wordvault-privacy/

Arayüz Türkçe ve İngilizce kullanılabilir.

Wordvault ücretsizdir, ücretli bir sürümü yoktur. İşine yarıyorsa ayarlarda isteğe bağlı bir "Projeyi destekle" bağlantısı var.
```
