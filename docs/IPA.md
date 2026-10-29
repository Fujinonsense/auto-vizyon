# iPhone uygulamasını kurma (IPA, Ad Hoc)

Uygulama App Store'a çıkmaz. Senin Apple Developer hesabınla imzalanır ve sadece kayıtlı iPhone'a, yani babanınkine kurulur. İmza 1 yıl geçerlidir; yıl dolmadan aynı adımlarla yenilersin.

Toplam süre: ilk seferde yaklaşık 40 dakika (10 dakikası derlemeyi beklemek).

## 0. Hazırlık (bir kere)

1. Kodu kalıcı bir klasöre indir ve paketleri kur:
   ```bash
   gh repo clone Fujinonsense/auto-vizyon
   ```
   ```bash
   cd auto-vizyon && npm ci
   ```
2. Depo herkese açık, bu yüzden GitHub derlemeyi ücretsiz yapar; ödeme ayarı gerekmez. Herkes kodu ve derlenen IPA'yı görebilir. Şifre niteliğinde bir şey yok: API anahtarı ve Google adresi sadece kurulum kodunda, imza anahtarı senin bilgisayarında ve GitHub'ın gizli değerlerinde durur. İmzalı IPA'da Apple takım numaran ve babanın iPhone'unun UDID'si yazar; bunlarla uygulama başka telefona kurulamaz.

## 1. Babanın iPhone'unun UDID'si (2 dakika)

- **iMac'te**: iPhone'u kabloyla tak → Finder → soldan iPhone → adın altındaki gri yazıya (model, kapasite) birkaç kez tıkla, **UDID** görünür → sağ tık → **UDID'yi Kopyala**.
- **Windows'ta**: **Apple Aygıtlar** (Apple Devices) uygulaması → iPhone → seri numarasına tıkla, UDID görünür.

## 2. Apple tarafı (10 dakika)

1. Bilgisayarında, `auto-vizyon` klasöründe:
   ```bash
   node tools/ios-imza.mjs hazirla
   ```
   Ev klasöründe `AutoVizyon-imza` açılır: içinde gizli anahtar (`anahtar.pem`, kimseyle paylaşma) ve Apple'a yükleyeceğin `AutoVizyon.certSigningRequest` olur.
2. [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, IDs & Profiles**:
   1. **Certificates → +** → **Apple Distribution** → Continue → `AutoVizyon.certSigningRequest` dosyasını seç → Continue → **Download**. İnen `.cer` dosyasını `AutoVizyon-imza` klasörüne taşı.
   2. **Identifiers → +** → **App IDs** → **App** → Description: `Auto Vizyon`, Bundle ID: **Explicit** `com.autovizyon.app` → Continue → Register.
   3. **Devices → +** → Platform iOS, Device Name `Babamın iPhone'u`, Device ID: UDID → Continue → Register.
   4. **Profiles → +** → Distribution altında **Ad Hoc** → App ID `com.autovizyon.app` → az önce yaptığın sertifika → babanın iPhone'u → Profile Name `Auto Vizyon Ad Hoc` → Generate → **Download**. İnen `.mobileprovision` dosyasını da `AutoVizyon-imza` klasörüne taşı.
3. Sonra:
   ```bash
   node tools/ios-imza.mjs yukle
   ```
   Sertifikanın anahtarla, profilin sertifikayla eşleştiğini kontrol eder, GitHub'a üç gizli değer yazar (`IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`, `IOS_PROFILE_BASE64`) ve imzalı derlemeyi başlatır.

## 3. IPA'yı indir (8-12 dakika bekleme)

```bash
gh run watch --repo Fujinonsense/auto-vizyon
```
```bash
gh run download --repo Fujinonsense/auto-vizyon --dir ipa
```

`ipa` klasöründe `AutoVizyon-<numara>.ipa` olur. Aynı dosya github.com'da depo → **Actions** → son derleme → **Artifacts** altında da durur (30 gün).

## 4. iPhone'a kur (iMac'te, 5 dakika)

1. IPA'yı iMac'e at (AirDrop, mail ya da USB bellek).
2. iPhone'u kabloyla iMac'e tak. iPhone "Bu bilgisayara güvenilsin mi?" derse **Güven**.
3. Finder → soldan iPhone'u seç, sağda iPhone'un bilgi sayfası açılsın. IPA dosyasını başka bir Finder penceresinden bu sayfanın üstüne sürükle; yeşil **+** çıkınca bırak.
   Olmazsa: Mac App Store'dan ücretsiz **Apple Configurator** → iPhone'a çift tıkla → **Ekle → Uygulamalar → Mac'imden Seç** → IPA.
4. iPhone'da **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu → Aç**. iPhone yeniden başlar, açılınca **Aç**'a bas ve şifreyi gir. (iOS 16 ve sonrası Ad Hoc uygulamalar için bunu ister; seçenek, uygulama kurulduktan sonra görünür.)
5. Ana ekranda logolu **Auto Vizyon** simgesi. Aç, ilk fotoğrafta kamera izni sorar: **İzin Ver**.

## Güncelleme, yenileme, yeni telefon

- **Güncelleme**: kod değişip GitHub'a gönderildiğinde yeni IPA kendiliğinden derlenir. 3. ve 4. adımla üstüne kur; telefondaki kayıtlar silinmez. Uygulamayı silip yeniden kurma: telefondaki kayıtlar gider (Google'daki kopyası kalır).
- **Bir yıl dolmadan**: Apple'da profili aç → **Edit → Generate** → indir → `AutoVizyon-imza` klasörüne koy → `node tools/ios-imza.mjs yukle` → yeni IPA'yı kur. Sertifika da dolduysa önce 2. adımın 1. maddesi.
- **Yeni iPhone**: Devices'a ekle → profili düzenleyip yeni cihazı işaretle → indir → `yukle` → yeni IPA.

## B planı: GitHub olmadan, iMac'te Xcode ile

GitHub derlemesi açılmazsa, aynı uygulamayı babanın iMac'inden doğrudan kurabilirsin. Xcode imzayı ve cihaz kaydını kendisi yapar, yukarıdaki 2. adıma gerek kalmaz.

1. iMac'te App Store'dan **Xcode**'u (büyük indirme) ve [nodejs.org](https://nodejs.org)'dan **Node.js LTS**'i kur.
2. github.com'da depoya gir → **Code → Download ZIP** → aç. Terminal'de o klasörde:
   ```bash
   npm ci && npx cap sync ios && open ios/App/App.xcodeproj
   ```
3. Xcode → **Settings → Accounts** → Apple ID'ni ekle. Soldan **App** → **Signing & Capabilities** → **Team**: kendi takımın.
4. iPhone'u kabloyla tak, Geliştirici Modu'nu aç (4. adımın 4. maddesi; seçenek iPhone Xcode'a bağlanınca görünür).
5. Xcode'un üstünde hedef olarak babanın iPhone'unu seç → **▶**. Uygulama kurulur.
