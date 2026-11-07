# iPhone uygulaması: TestFlight

Uygulama App Store'da görünmez. Apple'ın deneme sistemi TestFlight ile sadece davet ettiğin kişilere gider. Baban senin App Store Connect ekibinde **dahili testçi**: e-postasına gelen TestFlight davetine dokunur ve uygulamayı kurar. UDID, kablo, Mac ya da Geliştirici Modu gerekmez; yeni sürümler kendiliğinden gelir.

Toplam süre: ilk seferde yaklaşık 45 dakika. Dahili testte Apple'ın beta incelemesi yok. Sonraki her derleme 5-10 dakika sürer, Apple'ın işlemesi 5-15 dakika daha.

## 0. Hazırlık (bir kere)

1. Kodu kalıcı bir klasöre indir ve paketleri kur:
   ```bash
   gh repo clone Fujinonsense/auto-vizyon
   ```
   ```bash
   cd auto-vizyon && npm ci
   ```
2. Depo herkese açık, bu yüzden GitHub derlemesi ücretsiz. Şifre niteliğinde bir şey depoda yok: imza anahtarı, API anahtarı ve profil senin bilgisayarındaki `AutoVizyon-imza` klasöründe ve GitHub'ın gizli değerlerinde durur.

## 1. Apple tarafı (20 dakika, bir kere)

Durum (29 Ekim 2026): bu bölüm yapıldı. Sertifika ve profil 29 Ekim 2027'ye kadar geçerli.

1. Bilgisayarında, `auto-vizyon` klasöründe:
   ```bash
   node tools/ios-imza.mjs hazirla
   ```
   Ev klasöründe `AutoVizyon-imza` açılır: içinde gizli anahtar (`anahtar.pem`, kimseyle paylaşma) ve Apple'a yükleyeceğin `AutoVizyon.certSigningRequest` olur.
2. [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, IDs & Profiles**:
   1. **Certificates → +** → **Apple Distribution** → Continue → `AutoVizyon.certSigningRequest` → Continue → **Download**. İnen `distribution.cer`'i `AutoVizyon-imza` klasörüne taşı.
   2. **Identifiers → +** → **App IDs** → **App** → Description `Auto Vizyon`, Bundle ID **Explicit** `com.autovizyon.app` → Continue → Register.
   3. **Profiles → +** → Distribution altında **App Store Connect** → App ID `com.autovizyon.app` → az önceki sertifika → ad `Auto Vizyon App Store` → Generate → **Download**. İnen `.mobileprovision`'ı da klasöre taşı.
3. [appstoreconnect.apple.com](https://appstoreconnect.apple.com):
   1. **Apps → + → New App**: iOS, ad `Auto Vizyon`, dil Türkçe, Bundle ID `com.autovizyon.app`, SKU `autovizyon-001`, Full Access → Create.
   2. **Users and Access → Integrations → App Store Connect API → Team Keys → +**: ad `Auto Vizyon CI`, rol **App Manager** → Generate → **Download**. Anahtar yalnız bir kez iner. `AuthKey_….p8` dosyasını klasöre taşı; adını değiştirme.
   3. Aynı sayfadaki **Issuer ID**'yi klasörde `issuer-id.txt` adlı dosyaya yaz.

## 2. GitHub'a yükle ve derle (1 dakika, sonra 5-10 dakika bekleme)

```bash
node tools/ios-imza.mjs yukle
```

Sertifikanın anahtarla, profilin sertifikayla eşleştiğini, profilin App Store profili olduğunu ve API anahtarını kontrol eder. Sonra GitHub'a altı gizli değer yazar (`IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`) ve derlemeyi başlatır. Derleme imzalanıp TestFlight'a yüklenir.

```bash
gh run watch --repo Fujinonsense/auto-vizyon
```

Bundan sonra `app/` ya da `ios/` her değiştiğinde yeni derleme kendiliğinden TestFlight'a yüklenir.

## 3. Test edenler (10 dakika, bir kere)

Durum (7 Kasım 2026): bu bölüm yapıldı. Baban `Ben` dahili grubunda; eski `Babam` dış grubu yok.

1. App Store Connect → **Auto Vizyon** → **TestFlight** → **Test Information**: kısa bir açıklama ve geri bildirim e-postası.
2. **Baban ekipte**: dahili testçiler App Store Connect ekibinden olur. **Users and Access → +** ile babanın Apple kimliği e-postasını davet et, **Apps**'te yalnız Auto Vizyon'u seç, rol olarak TestFlight'ta test edebilen bir rol seç (ör. Marketing). Baban e-postadaki ekip davetini kabul eder.
3. **Dahili grup**: **TestFlight → Internal Testing → +** ile `Ben` grubunu aç, **Enable automatic distribution** açık olsun. Kendini ve babanı gruba ekle. Apple her işlenen derlemeyi bu gruba kendiliğinden verir; inceleme yok, sınır yok.

## 4. Babana gönderilecek mesaj

```text
Baba, Auto Vizyon uygulaman hazır:
1. App Store'dan "TestFlight" uygulamasını kur.
2. E-postana Apple'dan Auto Vizyon test daveti geldi. Davetteki "View in TestFlight"a dokun.
3. "Kabul Et", sonra "Yükle".
4. Uygulamayı aç, "Başlayalım"a bas. Az sonra göndereceğim kodu kopyala, uygulamada sağ üstteki dişliye basıp "Yapıştır" de.
```

Kurulum kodu için: [KURULUM.md](KURULUM.md), 3. adım.

## Güncelleme, 90 gün, yıllık yenileme

- **Yeni sürüm**: kod değişince GitHub yeni derlemeyi yükler. Apple işler işlemez `Ben` grubu (baban da içinde) derlemeyi kendiliğinden alır. "Testçilere ulaştır" işi Apple'ın işlemesini bekler, Türkçe "What to Test" notunu yazar ve derlemenin dahili gruba geçtiğini (`IN_BETA_TESTING`) denetler (`tools/testflight.mjs`). Derleme babana gidemeyecekse iş kırmızı biter ve GitHub sana e-posta atar: ör. ihracat uyumluluğu eksik (`MISSING_EXPORT_COMPLIANCE`), Apple işleyemedi (`PROCESSING_EXCEPTION`), ya da otomatik dağıtımı açık ve içinde testçi olan dahili grup yok. Apple'ın işlemesi 90 dakikayı geçerse iş sarı uyarıyla biter; takip işi ertesi gün bakar. Babanın telefonunda TestFlight'ta Auto Vizyon için **Otomatik Güncellemeler** açık olmalı.
- **Dış grup (isteğe bağlı)**: TestFlight'ta `Babam` adlı (ya da `TF_GROUP` ile verilen adla) bir dış grup açarsan eski akış geri gelir: iş derlemeyi o gruba ekler, notu yazar, "testçilere otomatik bildir"i açar (Apple onaylar onaylamaz testçilere gitsin diye) ve gerekiyorsa beta incelemesine gönderir. İnceleme için **Test Information**'da **Beta App Review Information** (adın, telefonun, e-postan) dolu olmalı; onay genelde 1-2 gün sürer. Grup yokken bunların hiçbiri yapılmaz.
- **Takip**: "TestFlight takip" işi her gün 09:41'de en yeni derlemeye bakar: notu yazılmış mı, dahili gruba geçmiş mi (dış grup varsa: grupta mı, testçilere açılıyor mu, incelemeye gitti mi; Apple bir seferde tek derleme inceler, bekletilen derlemeyi öteki inceleme bitince kendisi gönderir). İki durumda kırmızı biter ve günde bir e-posta gelir: babanın kurabildiği en yeni derleme 45 günü geçtiyse (TestFlight derlemesi 90. günde açılmaz), ya da kurabileceği derleme yokken yolda da derleme yoksa (ör. ihracat uyumluluğu eksik ya da Apple reddettiyse).
- **90 gün**: her TestFlight derlemesi 90 gün geçerli. GitHub her ayın 1'inde ve 15'inde yeni derleme yapıp gönderir; biri aksasa da babanın elindeki derlemenin en az iki ayı kalır. Aynı çalışmada ayrı bir iş depoya `.github/son-yenileme.txt` yazar, çünkü GitHub 60 gün hareketsiz kalan açık depolarda zamanlanmış işleri durdurur. Elle göndermek için: github.com'da depo → **Actions → iPhone TestFlight → Run workflow** (derleme numarası girersen yeni derleme yapmadan sadece onu testçilere ulaştırır).
- **Kırmızı biten çalışma**: en son iPhone TestFlight çalışmasıysa aç → **Re-run jobs → Re-run failed jobs** ("Re-run all jobs" da olur; yeni derleme `12.2` gibi bir numara alır). Daha eski bir çalışmayı yeniden çalıştırma; Apple eski numaralı derlemeyi reddeder. Onun yerine **Run workflow**.
- **Zamanlama durduysa** (Actions'ta "This scheduled workflow is disabled"): **Actions → iPhone TestFlight → Enable workflow**, aynısını **TestFlight takip** için de yap.
- **Bir yıl dolmadan** (29 Ekim 2027): Certificates'ta yeni Apple Distribution sertifikası (`hazirla` aynı anahtarla yeni istek yazar), Profiles'ta profili bu sertifikayla yeniden oluştur, ikisini klasöre koy, `node tools/ios-imza.mjs yukle`. API anahtarının süresi dolmaz.
- **Her nisan**: Apple yüklemeler için yeni Xcode şartı koyduysa (Apple Developer → Upcoming Requirements), `ios.yml`'deki `runs-on: macos-15`'i o Xcode'un olduğu Mac imajına çevir.

## Sorun olursa

| Ne görüyorsun | Ne yapmalı |
| --- | --- |
| `yukle`: "Bu bir Ad Hoc profil" | Profiles'ta **App Store Connect** türünde profil oluştur, klasöre koy. |
| `yukle`: "Profil başka bir sertifikayla yapılmış" | Profili düzenle, klasördeki sertifikayı seç, yeniden indir. |
| `yukle`: "Issuer ID eksik" | `issuer-id.txt` dosyasına App Store Connect'teki Issuer ID'yi yaz. |
| Derleme "TestFlight'a yükle" adımında düşüyor | Actions günlüğündeki hatayı Claude'a göster. |
| "… otomatik dağıtımı açık ve içinde testçi olan dahili grup da yok" | TestFlight → Internal Testing'de `Ben` grubunda **Automatic Distribution**'ı aç, babanı gruba ekle (3. adım). Sonra **Run workflow** ile derleme numarasını gir. |
| "TestFlight durumu: MISSING_EXPORT_COMPLIANCE" | App Store Connect → TestFlight → derlemede **Manage** → şifreleme sorusuna "None of the algorithms" de. `Info.plist`'teki `ITSAppUsesNonExemptEncryption` bunu normalde önler; Claude'a göster. |
| Bilgi notu: "Apple başka bir derlemeyi inceliyor" (dış grup) | Bir şey yapma; takip işi inceleme bitince gönderir. |
| "TestFlight takip" kırmızı: "… gün önce yüklendi" | En son kırmızı iPhone TestFlight çalışmasının günlüğünü Claude'a göster. Acilse **Actions → iPhone TestFlight → Run workflow**. |
| "TestFlight takip" kırmızı: "derleme yok ve yolda da yok" | App Store Connect → TestFlight'ta derlemenin durumuna bak (dış grupta App Review'daki Apple notunu oku). Durumu ve günlüğü Claude'a göster. |
| "TestFlight durumu: …" başka bir durum (ör. `PROCESSING_EXCEPTION`, `BETA_REJECTED`) | App Store Connect → TestFlight'ta derlemeye ve Apple'ın notuna bak, Claude'a göster. |
| Sarı uyarı: "… dakikada hazır olmadı" | Bir şey yapma; Apple işlemeyi bitirince derleme gruba geçer, takip işi bakar. |
| TestFlight'ta "Bu derlemenin süresi doldu" | 90 gün dolmuş: yukarıdaki "90 gün" maddesi. |
