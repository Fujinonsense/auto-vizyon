# Auto Vizyon kurulumu

Toplam süre: ilk seferde yaklaşık 1 saat, bir kere yapılır. Her şeyi sen kuruyorsun; baban sadece iPhone'unu ve iMac'ini kullanır.

## Neyin aboneliği lazım, neyin değil

| Ne | Ne işe yarar | Ücret |
| --- | --- | --- |
| Apple Developer (sende var) | Uygulamayı babanın iPhone'una kurmak | Yıllık üyelik |
| Anthropic API kredisi | Plakayı, ruhsatı, ehliyeti, kimliği okumak | Önceden yüklenen kredi, 5 dolar uzun süre yeter |
| Google hesabı | Tablo, fotoğraf yedeği ve iMac'teki Excel'in kaynağı | Ücretsiz |
| Microsoft 365 | iMac'te Excel | Abonelik |
| GitHub | iPhone uygulamasını (IPA) derlemek | Ücretsiz (depo herkese açık) |

**Claude aboneliği (Pro, Max) gerekmez ve işe yaramaz.** Uygulama Claude'a API anahtarıyla bağlanır; API kredisi abonelikten ayrı, console.anthropic.com'dan alınır.

**Excel'le konuşma şöyle olur:** telefon her kaydı Google tablosuna yazar → Google, Drive'daki **Auto Vizyon Excel.xlsx** dosyasını hemen yeniler → iMac'teki Google Drive uygulaması dosyayı indirir → Excel dakikada bir yeniler. Tabloda elle yaptığın düzeltme (ör. "Ödenmedi" → "Ödendi") de en geç bir dakikada telefona döner.

## 1. Anthropic API anahtarı (5 dakika)

1. [console.anthropic.com](https://console.anthropic.com) adresinde hesap aç.
2. **Billing** bölümünden 5 dolar kredi yükle. **Auto reload** (otomatik yükleme) kapalı kalsın; kredi bitince uygulama sadece "kredi bitti" der, para çekilmez.
3. **API Keys** → **Create Key** → adını "Auto Vizyon" yap → anahtarı kopyala (`sk-ant-` ile başlar). Bir yere not et, bir daha gösterilmez.

Maliyet: Claude Opus 5.5 ile araç ve ruhsat başına yaklaşık 5 cent. Ayarlardan "En ucuz"u (Haiku 5.5) seçersen araç başına yaklaşık 0,1 cent.

## 2. Google E-Tablo ve Drive (10 dakika)

iMac'te hangi Google hesabıyla gireceksen (5. adım) bu adımı o hesapla yap.

1. Google Drive'da yeni bir **E-Tablo** aç, adını **Auto Vizyon** koy.
2. **Uzantılar → Apps Script**. Açılan dosyanın içini sil, `google/Code.gs` dosyasının tamamını yapıştır, kaydet.
3. Üstteki listeden **kurulum** fonksiyonunu seç, **Çalıştır**'a bas, Google'ın istediği izinleri ver ("Gelişmiş → Güvenli olmayan sayfaya git" çıkarsa sorun değil, kod senin).
4. Alttaki **Yürütme günlüğü**'nde `Google anahtarı: …` yazar. O anahtarı kopyala.
5. **Dağıt → Yeni dağıtım → Tür: Web uygulaması**. **Çalıştıran: Ben**, **Erişimi olan: Herkes**. **Dağıt**'a bas.
6. Çıkan **Web uygulaması** adresini kopyala (`https://script.google.com/macros/s/…/exec`).

Kurulum şunları da yapar: Drive'da **Auto Vizyon** klasörü, içinde **Auto Vizyon Excel.xlsx** ve 5 dakikada bir tabloya bakan bir zamanlayıcı. Tablo üç sayfadır: **İşler**, **Müşteriler**, **Özet**. Fotoğraflar her müşterinin kendi klasörüne gider.

`Code.gs` sonradan değişirse: yenisini yapıştır, **kurulum**'u bir kez çalıştır, **Dağıt → Dağıtımları yönet → düzenle → Sürüm: Yeni sürüm → Dağıt**. Adres aynı kalır.

## 3. Kurulum kodu (2 dakika)

`auto-vizyon` klasöründe:

```bash
node tools/kurulum-kodu.mjs
```

API anahtarını, Google adresini ve Google anahtarını sorar, tek bir `AV1-…` kodu yazar. Kodu babana WhatsApp'tan gönder. Komut hiçbir şeyi internete göndermez.

## 4. Babanın iPhone'una kurma

1. Uygulamayı [IPA.md](IPA.md) ile kur.
2. Uygulamayı aç. "Hoş geldin ustam" ekranında **Başlayalım**'a bas.
3. WhatsApp'taki kurulum kodunun üstüne basılı tut → **Kopyala**.
4. Uygulamada sağ üstteki dişli (**Ayarlar**) → **Yapıştır**. "Kurulum tamam" yazar.
5. İlk fotoğrafta iPhone kamera izni sorar: **İzin Ver**.

## 5. iMac'te Excel (Microsoft 365, 10 dakika)

1. iMac'te [google.com/drive/download](https://www.google.com/drive/download/) adresinden **Google Drive** (masaüstü) uygulamasını kur, 2. adımdaki Google hesabıyla gir.
2. Finder → solda **Google Drive → Drive'ım → Auto Vizyon**. **Auto Vizyon Excel.xlsx** oradadır. Üstüne sağ tık → **Çevrimdışı kullanılabilir yap** (her zaman iMac'te dursun).
3. Excel'de yeni boş çalışma kitabı aç → **Veri → Veri Al (Power Query) → Excel çalışma kitabı** → **Gözat** → bu dosyayı seç. Excel dosyaya erişim izni isterse ver.
4. Açılan pencerede **İşler**'i seç (istersen **Özet** ve **Müşteriler**'i de) → **Yükle**.
5. **Veri → Sorgular ve Bağlantılar** → sorguya sağ tık → **Özellikler**: **Her 1 dakikada bir yenile** ve **Dosyayı açarken verileri yenile** kutularını işaretle → **Tamam**.
6. Çalışma kitabını **Belgeler**'e "Auto Vizyon Defter" adıyla kaydet, Dock'a sabitle. Baban her gün bunu açar.

Telefondan kaydedilen iş 1-2 dakika içinde bu tabloda görünür. Excel'deki bu tablo ayna gibidir: düzeltmeyi telefondan ya da Google tablosundan yap (Excel'de elle değiştirilen hücre bir sonraki yenilemede eski haline döner). Yanına kendi sayfalarını, formüllerini, grafiklerini ekleyebilirsin; onlar silinmez.

**Windows bilgisayar** (iMac yerine): telefonda **Ayarlar → Windows Excel'i için kodu kopyala** → Excel'de **Veri → Veri Al → Diğer Kaynaklardan → Boş Sorgu → Gelişmiş Düzenleyici** → kodu yapıştır → **Kapat ve Yükle** → yukarıdaki 5. madde.

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
| Kamera açılmıyor | iPhone Ayarlar → Auto Vizyon → Kamera açık mı; ya da kameradaki **Fotoğraf çek** ile telefonun kamerasını kullan. |
| Uygulama açılmıyor, "Geliştirici Modu gerekli" | iPhone Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu → Aç. |
| Uygulama bir yıl sonra açılmıyor | İmza doldu: [IPA.md](IPA.md) → "Bir yıl dolmadan". |
| iMac'teki Excel yenilenmiyor | Menü çubuğundaki Google Drive simgesi eşitleniyor mu bak; Excel'de **Veri → Tümünü Yenile**. |
