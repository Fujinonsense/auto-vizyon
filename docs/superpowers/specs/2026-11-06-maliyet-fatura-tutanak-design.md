# Job costs, invoice flag and accident report (design)

Date: 2026-11-06. Status: decided (the owner's son handed the remaining choices to the builder; every choice below that he did not state is marked *builder's call*).

## Why

The father runs a dent repair shop and has kept a paper-style "cari hesap" ledger in Excel since 2003. Every row in it has a cost (Maliyet) and a profit (Kar). The app records jobs but not what a job cost him, so the profit he is used to seeing is missing. He also forgets which jobs he has already invoiced, and for insurance jobs he copies the drivers' details off the accident report (Maddi Hasarlı Trafik Kazası Tespit Tutanağı) by hand.

## Goals

1. **Job costs.** On a job he picks a cost category from a list, types the amount, and can add several items. "Diğer" lets him type what the cost was for. The job shows total cost and profit.
2. **Invoice flag.** One tap marks a job "Fatura kesildi". Folders and job rows show "Fatura kesildi" or "Fatura kesilmedi", the same way they already show the payment badge.
3. **Accident report.** "Kaza tutanağı" becomes a document photo next to Ruhsat, Ehliyet and Kimlik. The AI reads only the two drivers' details and the two plates. The folder shows them in a calm, easy-to-read way with copy buttons.
4. Everything reaches the Google sheet (and from there the father's Excel) without breaking the rows that already exist.

## Non-goals

- The Excel "Defter" redesign and the import of the old ledger (separate task, needs the father's iMac).
- Partial payments, invoice numbers or dates, KDV on costs, cost reports by category.
- Reading anything else from the accident report (insurance, sketch, statements, place).

## Anti-goals

- No extra taps on the everyday path: a job without costs saves exactly as today.
- No new visual language: reuse the existing cards, chips, toggles, badges and icons.
- Existing data must not shift: new Google sheet columns go at the END of each sheet.

## Decisions

### Costs
- Stored on the job as `costs: [{ cat, label, amount }]`, default `[]`.
- Categories (*builder's call*, order as shown): `dis-iscilik` "Dış işçilik", `boya` "Boya", `parca` "Yedek parça", `sarf` "Sarf malzeme", `nakliye` "Çekici / nakliye", `diger` "Diğer".
- `diger` needs a label (what the cost was for, max 40 characters). Other categories keep `label: ''` and display the category name.
- Amount is a positive number in TL, typed like the job amount (Turkish "20.000" style works).
- Total cost = sum of amounts. **Profit = KDV-hariç amount (`net`) − total cost** (*builder's call*; the old ledger used Toplam − Maliyet, but Toplam there had no VAT split). Profit can be negative and is then shown in the due color.
- Shown in the job sheet (list of items, "Masraf ekle", total, profit), as a small "Maliyet …" line on job rows that have costs, and as "Maliyet" and "Kâr" metrics on the Kazanç screen.

### Invoice flag
- Stored on the job as `invoiced: boolean`, default `false`. Jobs saved before this change read as not invoiced.
- A toggle "Fatura kesildi" sits right under the existing "Ödendi" toggle.
- Badge next to the payment badge on folder list rows (latest job) and on job rows: "Fatura kesildi" (quiet, neutral) or "Fatura kesilmedi" (warn color).
- A "Faturasız" filter chip on the folder list (*builder's call*): folders with any job not invoiced.

### Accident report ("Kaza tutanağı")
- Document kind key `tutanak`, label "Kaza tutanağı", stored on the folder as `tutanak: {}` like the other documents (*builder's call*: folder level, same as Ruhsat/Ehliyet/Kimlik; a new photo replaces the old reading).
- Fields, for driver A and B: Ad Soyad, T.C. Kimlik No, Sürücü belge no ve sınıfı (one field, e.g. "106408-B"), Alındığı yer, Adres, Telefon, and the vehicle's Plaka (the plate is the only non-driver field, kept so the father can tell which driver is his customer, *builder's call*).
- The AI prompt tells the model to read only the "Sürücü Bilgileri" boxes and the plates, and to leave unreadable handwriting empty and list it as unclear.
- The folder shows two compact sections, "Tutanak A" and "Tutanak B", each only when it has data, with the same copy rows as the other documents. Empty rows are hidden.
- Not copied from an earlier folder with the same plate (an accident belongs to one visit).
- New icon `app/img/ic-tutanak.webp` in the existing black-and-gold style (made with Higgsfield like the others).

### Google sheet and Excel
- İşler gets three columns at the end: "Maliyet" (money), "Maliyet Kalemleri" (text), "Fatura" ("Kesildi" / "Kesilmedi").
- "Maliyet Kalemleri" text format: items joined by "; ", each "Etiket: tutar" with a plain number (no thousands separator, "." decimals), e.g. `Dış işçilik: 20000; Boya: 10000; Cam filmi: 1500`. Reading it back maps known category names to their key and anything else to `diger` with that label.
- Müşteriler gets 14 columns at the end: "Tutanak A Ad Soyad", "Tutanak A TC", "Tutanak A Ehliyet", "Tutanak A Alındığı Yer", "Tutanak A Adres", "Tutanak A Telefon", "Tutanak A Plaka", then the same seven for B.
- The live sheet gets these header cells added by hand so the deployed Code.gs stores the new fields right away (it writes by header name). The repo's Code.gs is updated to match and deployed later.

## Constraints

- Plain JS, no new dependencies. Tests run with `node --test` (149 passing today) and must stay green; CI runs them before building.
- `JOB_COLUMNS`/`FOLDER_COLUMNS` (app/js/excel/columns.js) and `JOB_HEADERS`/`FOLDER_HEADERS` (google/Code.gs) must stay identical (tests/appsscript.test.mjs).
- New job fields must be in `JOB_FIELDS` (app/js/sync/merge.js) or remote changes are ignored.
- Tap targets ≥ 48px, body text 17px, Turkish UI copy.
- Web files are bundled into the iOS app; the father gets the change only through a new TestFlight build.
