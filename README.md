# Auto Vizyon

Boyasız göçük onarım ustası için iPhone uygulaması. Capacitor ile iOS'a sarılır, TestFlight ile sadece davet edilen kişilere dağıtılır; App Store'da görünmez.

- Uygulama içi kamera: araç, hasar öncesi/sonrası, ruhsat, ehliyet, kimlik.
- Claude (Anthropic) plakayı ve belgeleri okur; her bilginin yanında kopyala düğmesi.
- İşler, KDV, ödeme takibi, aylık kazanç, Excel'e aktarma ve Excel'den alma.
- Google E-Tablo ve Drive ile eşitleme; iMac'teki Excel, Drive'daki kendini yenileyen Auto Vizyon Excel.xlsx'i okur.

Kurulum: [docs/KURULUM.md](docs/KURULUM.md) · iPhone'a gönderme: [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md)

## Geliştirme

```bash
npm install
npm test                       # birim ve eşitleme testleri
node tools/build-vendor.mjs    # Anthropic SDK ve SheetJS paketleri → app/vendor
node tools/build-assets.mjs    # ikonlar ve plaka yazı tipi
python -m http.server 5173 --directory app
npx cap sync ios               # app/ → ios/ (Xcode projesi)
```

`app/` iPhone uygulamasının içine kopyalanır; uygulama `.github/workflows/ios.yml` ile GitHub'ın macOS makinesinde derlenip TestFlight'a yüklenir.
İmza: `tools/ios-imza.mjs`. Kurulum kodu: `tools/kurulum-kodu.mjs`. `google/Code.gs` Google Apps Script tarafıdır.
Görseller Higgsfield ile üretildi (GPT Image 2.5, Seedance 2.5); ikon seti Tabler Icons (MIT), plaka yazı tipi Barlow Condensed (OFL).
