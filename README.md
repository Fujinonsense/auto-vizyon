# Auto Vizyon

Boyasız göçük onarım ustası için iPhone uygulaması (web uygulaması, ana ekrana eklenir).

- Uygulama içi kamera: araç, hasar öncesi/sonrası, ruhsat, ehliyet, kimlik.
- Claude (Anthropic) plakayı ve belgeleri okur; her bilginin yanında kopyala düğmesi.
- İşler, KDV, ödeme takibi, aylık kazanç, Excel'e aktarma ve Excel'den alma.
- Google E-Tablo ve Drive ile eşitleme; bilgisayardaki Excel Power Query ile kendini yeniler.

Kurulum: [docs/KURULUM.md](docs/KURULUM.md)

## Geliştirme

```bash
npm install
npm test                       # birim ve eşitleme testleri
node tools/build-vendor.mjs    # Anthropic SDK ve SheetJS paketleri → app/vendor
node tools/build-assets.mjs    # ikonlar ve plaka yazı tipi
python -m http.server 5173 --directory app
```

`app/` klasörü olduğu gibi yayınlanır (GitHub Pages). `google/Code.gs` Google Apps Script tarafıdır.
Görseller Higgsfield ile üretildi (GPT Image 2.5, Seedance 2.5); ikon seti Tabler Icons (MIT), plaka yazı tipi Barlow Condensed (OFL).
