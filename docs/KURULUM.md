# Auto Vizyon kurulumu

Toplam süre: yaklaşık 30 dakika. Babanın hiçbir hesap açmasına gerek yok, her şeyi sen yapıyorsun.

## 1. Anthropic API anahtarı (yapay zeka okuması için, 5 dakika)

1. [console.anthropic.com](https://console.anthropic.com) adresinde hesap aç.
2. **Billing** bölümünden 5 dolar kredi yükle. **Auto reload** (otomatik yükleme) kapalı kalsın; kredi bitince uygulama sadece "kredi bitti" der, para çekilmez.
3. **API Keys** → **Create Key** → adını "Auto Vizyon" yap → anahtarı kopyala (`sk-ant-` ile başlar). Bir yere not et, bir daha gösterilmez.

Maliyet: Claude Opus 5.5 ile araç ve ruhsat başına yaklaşık 5 cent. Ayarlardan "En ucuz"u (Haiku 5.5) seçersen araç başına yaklaşık 0,1 cent.

## 2. Google E-Tablo ve Drive (Excel ve fotoğraf yedeği için, 10 dakika)

1. Google Drive'da yeni bir **E-Tablo** aç, adını **Auto Vizyon** koy.
2. **Uzantılar → Apps Script**. Açılan dosyanın içini sil, `google/Code.gs` dosyasının tamamını yapıştır, kaydet.
3. Üstteki listeden **kurulum** fonksiyonunu seç, **Çalıştır**'a bas, Google'ın istediği izinleri ver.
4. Alttaki **Yürütme günlüğü**'nde `Google anahtarı: …` yazar. O anahtarı kopyala.
5. **Dağıt → Yeni dağıtım → Tür: Web uygulaması**. **Çalıştıran: Ben**, **Erişimi olan: Herkes**. **Dağıt**'a bas.
6. Çıkan **Web uygulaması** adresini kopyala (`https://script.google.com/macros/s/…/exec`).

Tablo üç sayfadan oluşur: **İşler**, **Müşteriler**, **Özet**. Tabloda bir şeyi elle düzeltirsen (ör. "Ödenmedi" → "Ödendi") en geç bir dakika içinde telefona da geçer. Fotoğraflar Drive'da **Auto Vizyon** klasöründe, her müşterinin kendi klasöründe durur.

## 3. Kurulum kodu (2 dakika)

1. Uygulamanın adresinin sonuna `kurulum.html` ekleyip aç (ör. `https://…github.io/auto-vizyon/kurulum.html`).
2. API anahtarını, Google adresini ve Google anahtarını yaz, **Kodu üret**'e bas, **Kodu kopyala**.
3. Kodu babana WhatsApp'tan gönder. Bu sayfa hiçbir şeyi internete göndermez; kod sadece senin cihazında üretilir.

## 4. Babanın iPhone'una kurma (5 dakika)

1. Uygulamanın adresini **Safari**'de aç (Chrome'da ana ekrana eklenmez).
2. Alttaki **Paylaş** düğmesi → **Ana Ekrana Ekle** → **Ekle**. Ana ekranda logolu **Auto Vizyon** simgesi çıkar.
3. Simgeden aç. "Hoş geldin ustam" ekranında **Başlayalım**'a bas.
4. WhatsApp'taki kurulum kodunun üstüne basılı tut → **Kopyala**.
5. Uygulamada sağ üstteki dişli (**Ayarlar**) → **Yapıştır**. "Kurulum tamam" yazar.
6. İlk fotoğrafta iPhone kamera izni sorar: **İzin Ver**.

## 5. Bilgisayardaki Excel (5 dakika, Excel 2016 ve sonrası)

1. Telefonda **Ayarlar → Bilgisayar Excel'i için kodu kopyala**. Kodu kendine WhatsApp ya da mail ile gönder, bilgisayarda kopyala.
2. Excel'de boş bir çalışma kitabı aç: **Veri → Veri Al → Diğer Kaynaklardan → Boş Sorgu**.
3. Açılan pencerede **Gelişmiş Düzenleyici**'ye bas, içini silip kodu yapıştır, **Bitti** → **Kapat ve Yükle**.
4. Gelen tabloya sağ tıkla → **Tablo → Dış Veri Özellikleri** (ya da **Sorgular ve Bağlantılar → Özellikler**):
   **Her 1 dakikada bir yenile** ve **Dosyayı açarken verileri yenile** kutularını işaretle.
5. Dosyayı kaydet. Excel açıkken tablo dakikada bir kendini yeniler. Düzeltmeleri telefondan ya da Google tablodan yap; bu Excel ayna gibi çalışır.

## Günlük kullanım

- **Yeni araç**: ortadaki altın düğme → aracı çek (plaka okunur) → göçüğün öncesini çek ya da **Geç** → isim ve telefon → lazımsa Ruhsat / Ehliyet / Kimlik → tutar → **Kaydet**.
- **Klasör**: Ara, WhatsApp ("Aracınız hazır"), her bilginin solundaki kopyala düğmesi, **Tümünü kopyala**, öncesi/sonrası fotoğrafları, işler ve ödeme.
- **Kazanç**: ay ay ciro, KDV, alacaklar ve Excel dosyası (WhatsApp, mail ya da Dosyalar'a gönderilir).

## Sorun olursa

| Ne görüyorsun | Ne yapmalı |
| --- | --- |
| "Yapay zeka anahtarı geçersiz" | Ayarlar → anahtarı kontrol et, **Anahtarı dene**. |
| "Anthropic hesabındaki kredi bitti" | console.anthropic.com → Billing → kredi yükle. |
| Bulut simgesi sarı, "Google adresine ulaşılamadı" | İnterneti kontrol et; Ayarlar → **Bağlantıyı dene**. |
| "Dağıtımda erişim Herkes seçilmemiş" | Apps Script → Dağıt → Dağıtımları yönet → düzenle → Erişimi olan: Herkes. |
| Kamera açılmıyor | iPhone Ayarlar → Safari → Kamera → İzin Ver; ya da kameradaki **Fotoğraf çek** ile telefonun kamerasını kullan. |
