# Job costs, invoice flag and accident report: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the father record cost items and an invoice flag per job, and read the two drivers from an accident report photo, all synced to the Google sheet.

**Architecture:** Pure helpers for costs live in a new `app/js/lib/costs.js`; job and folder records gain `costs`, `invoiced` and `tutanak` with defaults so old records keep working; columns are appended at the end of both sheets in `columns.js` and `Code.gs` together; UI reuses the existing chips, toggles, badges and section/copy-row patterns.

**Tech Stack:** Plain ES modules in `app/`, Google Apps Script in `google/Code.gs`, tests with `node --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-06-maliyet-fatura-tutanak-design.md`

## Global Constraints

- No new dependencies. `npm test` green after every task (149 tests pass before this work).
- `JOB_COLUMNS` ≡ `JOB_HEADERS` and `FOLDER_COLUMNS` ≡ `FOLDER_HEADERS` (tests/appsscript.test.mjs). New columns only at the END of each list.
- Every new job field goes into `JOB_FIELDS` in `app/js/sync/merge.js`; every document kind into `DOCS` there.
- Exact UI copy (Turkish): "Maliyet", "Masraf ekle", "Ne için?", "Ekle", "Kaldır", "Toplam maliyet", "Kâr (KDV hariç)", "Fatura kesildi", "Fatura kesilmedi", "Faturasız", "Kaza tutanağı", "Tutanak A", "Tutanak B".
- Cost categories in this order: `dis-iscilik` "Dış işçilik", `boya` "Boya", `parca` "Yedek parça", `sarf` "Sarf malzeme", `nakliye` "Çekici / nakliye", `diger` "Diğer".
- Sheet headers, exact: İşler append `Maliyet`, `Maliyet Kalemleri`, `Fatura`. Müşteriler append `Tutanak A Ad Soyad`, `Tutanak A TC`, `Tutanak A Ehliyet`, `Tutanak A Alındığı Yer`, `Tutanak A Adres`, `Tutanak A Telefon`, `Tutanak A Plaka`, then the same seven with `B`.
- Tap targets ≥ 48px; reuse CSS tokens in `app/css/app.css` (light and dark); icons from `app/js/ui/icons.js` (Tabler) only.
- Commit after each task on branch `feat/maliyet-fatura-tutanak` with a Turkish one-line message and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. Jobs and folders saved before this change (no `costs`, `invoiced`, `tutanak` keys) must open, render, export and sync without errors and without inventing values (invoiced reads as false).
2. A pulled Google row with an empty "Maliyet Kalemleri" or "Fatura" cell must map to `[]` / `false` consistently, and an unchanged row must not trigger a local write (merge skip).
3. Turkish amounts typed with a thousands dot ("20.000") or a decimal comma ("1.250,50") parse the same way the job amount does.
4. Costs bigger than the job (negative profit) display clearly, with no NaN anywhere when the job amount is empty.
5. Hand-typed tutanak fields are never overwritten by a later AI reading (same rule as the other documents).

---

### Task 1: Cost helpers

**Files:**
- Create: `app/js/lib/costs.js`
- Test: `tests/costs.test.mjs`

**Interfaces:**
- Produces: `COST_CATS: Array<{key: string, label: string}>`, `costLabel(item) -> string`, `normalizeCosts(list) -> Array<{cat, label, amount}>`, `costTotal(costs) -> number`, `profit(job) -> number`, `costsToText(costs) -> string`, `costsFromText(text) -> Array<{cat, label, amount}>`.

- [ ] **Step 1: Write the failing tests** in `tests/costs.test.mjs`:
  - `costTotal([{cat:'boya',label:'',amount:10000},{cat:'dis-iscilik',label:'',amount:20000}])` → `30000`; `costTotal([])` and `costTotal(undefined)` → `0`.
  - `costsToText` of that list → `'Boya: 10000; Dış işçilik: 20000'`; decimals keep a dot: `[{cat:'sarf',label:'',amount:1250.5}]` → `'Sarf malzeme: 1250.5'`.
  - `costsFromText('Dış işçilik: 20000; Boya: 10000; Cam filmi: 1500')` deep-equals `[{cat:'dis-iscilik',label:'',amount:20000},{cat:'boya',label:'',amount:10000},{cat:'diger',label:'Cam filmi',amount:1500}]`.
  - `costsFromText('')`, `costsFromText(null)`, `costsFromText('  ;  ')` → `[]`; a category name in other case (`'dış işçilik: 5'`) still maps to `dis-iscilik`.
  - `normalizeCosts` drops items with amount `0`, negative, `NaN` or non-numeric; drops `diger` with an empty label; removes `;` and `:` from labels; trims labels to 40 characters; rounds amounts to 2 decimals; unknown `cat` becomes `diger` with the item's label.
  - `profit({net:30000, costs:[{cat:'boya',label:'',amount:10000}]})` → `20000`; `profit({net:5000})` → `5000`; `profit({costs:[{cat:'boya',label:'',amount:100}]})` → `-100`.
  - `costLabel({cat:'diger',label:'Cam filmi'})` → `'Cam filmi'`; `costLabel({cat:'boya',label:''})` → `'Boya'`.
- [ ] **Step 2: Run** `node --test tests/costs.test.mjs` — expected FAIL (module missing).
- [ ] **Step 3: Implement `app/js/lib/costs.js`.** Match category names with the app's existing Turkish case-folding helper if one exists (search `app/js/lib` first); otherwise a local `toLocaleLowerCase('tr')` compare.
- [ ] **Step 4: Run** `npm test` — expected all PASS.
- [ ] **Step 5: Commit** `Maliyet kalemleri için yardımcılar`.

### Task 2: Job and folder record fields, sync merge

**Files:**
- Modify: `app/js/data/repo.js` (saveJob defaults ~115-117, saveFolder defaults ~44, applyRemote ~255 and ~264)
- Modify: `app/js/sync/merge.js` (`JOB_FIELDS` line 3, `DOCS` line 4)
- Test: `tests/repo.test.mjs`, `tests/merge.test.mjs`

**Interfaces:**
- Consumes: `normalizeCosts` (Task 1).
- Produces: job records always have `costs` (normalized array) and `invoiced` (boolean); folder records always have `tutanak` (object).

- [ ] **Step 1: Failing tests:** `saveJob({folderId})` returns `costs: []`, `invoiced: false`; `saveJob` with `costs:[{cat:'boya',label:'',amount:'0'},{cat:'boya',label:'',amount:900}]` stores only the 900 item; `saveFolder({})` has `tutanak: {}`; `applyRemote` of a job row without the new keys yields `costs: []`, `invoiced: false`. In merge tests: a remote job whose only change is `invoiced: true` updates the local job; a remote job with an equal `costs` array (same items, new array instance) is skipped; a remote folder with `tutanak.aAdSoyad` merges like `ruhsat`.
- [ ] **Step 2: Run** the two test files — expected FAIL.
- [ ] **Step 3: Implement.** Array fields compare by value the same way `parts` does today.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `İşe maliyet ve fatura, klasöre tutanak alanı`.

### Task 3: Google sheet and Excel columns

**Files:**
- Modify: `app/js/excel/columns.js` (JOB_COLUMNS 13-35, FOLDER_COLUMNS 37-48, `toCell` ~75-87, `fromCell` ~120-131)
- Modify: `google/Code.gs` (JOB_HEADERS 31-33, FOLDER_HEADERS 34-37, KIND map ~40, money formats in `prepareSheet_` ~340-345)
- Test: `tests/excel.test.mjs`, `tests/appsscript.test.mjs`

**Interfaces:**
- Consumes: `costTotal`, `costsToText`, `costsFromText` (Task 1); record fields (Task 2).
- Produces: column types `costSum` (write-only money: `costTotal(job.costs)`), `costs` (text round trip), `invoice` (`true` → `'Kesildi'`, else `'Kesilmedi'`; reading `'Kesildi'` → `true`, anything else → `false`). Folder columns map to `tutanak.aAdSoyad`, `tutanak.aTc`, `tutanak.aEhliyet`, `tutanak.aAlindigiYer`, `tutanak.aAdres`, `tutanak.aTel`, `tutanak.aPlaka`, and the same `b…` keys.

- [ ] **Step 1: Failing tests:** a job with two costs and `invoiced:true` round-trips through `jobToRow`/the row reader with equal `costs` and `invoiced`, and its row has `Maliyet` = 30000 and `Fatura` = `'Kesildi'`; reading a row whose `Maliyet Kalemleri` is empty gives `costs: []`; a folder with all 14 tutanak fields round-trips; the header lists end with `'Fatura'` and `'Tutanak B Plaka'`; the app-built workbook formats `Maliyet` as money. Update the existing "last folder column is Klasör No" assertion to the new last header.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in both files; add `tutanak: 'Tutanak'` to the Code.gs KIND map; give `Maliyet` the same money format as the other money columns in `prepareSheet_`.
- [ ] **Step 4: Run** `npm test` — PASS (header equality included).
- [ ] **Step 5: Commit** `Tabloya Maliyet, Maliyet Kalemleri, Fatura ve tutanak sütunları`.

### Task 4: Job sheet: costs and invoice toggle

**Files:**
- Modify: `app/js/ui/job-fields.js` (state 20-23, layout 63-73, `read()` 74)
- Modify: `app/css/app.css` (only if a small layout class is needed; reuse `.chips.wrap`, `.field`, `.btn.small`, `.money`)

**Interfaces:**
- Consumes: `COST_CATS`, `costLabel`, `normalizeCosts`, `costTotal` (Task 1); `computeVat` from `app/js/lib/vat.js` for the live profit.
- Produces: `read()` returns `{ ...state, parts, costs, invoiced }`.

- [ ] **Step 1:** Add `toggle('Fatura kesildi', state.invoiced, …)` directly after the `Ödendi` toggle.
- [ ] **Step 2:** Add a "Maliyet" block after the toggles: one row per item (label, amount with `formatMoney`, a 48px remove button labelled "Kaldır"); a "Masraf ekle" button that opens an inline form with single-select category chips in `COST_CATS` order, an amount input parsed exactly like the job amount, a "Ne için?" text input shown only for `diger`, and an "Ekle" button that stays disabled until the item is valid (`normalizeCosts([item]).length === 1`).
- [ ] **Step 3:** Under the items show "Toplam maliyet" and "Kâr (KDV hariç)" only when there is at least one item; profit = current net (from the amount and KDV inputs) − total, updated on every input change, using the due color when negative.
- [ ] **Step 4:** Run `npm test` — PASS. Open the app in a browser (`npx serve app` or the project's usual static server) and check: adding, removing, Diğer label, live profit, saving and reopening a job keeps costs and the invoice flag.
- [ ] **Step 5: Commit** `İş ekranında maliyet kalemleri ve Fatura kesildi`.

### Task 5: Badges, job rows, list filter, earnings

**Files:**
- Modify: `app/js/ui/parts.js` (next to `statusBadge` 10-14), `app/js/ui/screens/list.js` (row 14-24, FILTERS ~10), `app/js/lib/search.js` (~35), `app/js/ui/screens/folder-view.js` (job rows 98-110), `app/js/lib/stats.js` (monthlySummary 10-26), `app/js/ui/screens/earnings.js` (metrics 78-83), `app/css/app.css` (badges 380-383, tokens 16-67)
- Test: `tests/search.test.mjs`, `tests/stats.test.mjs`

**Interfaces:**
- Consumes: `costTotal`, `profit` (Task 1).
- Produces: `invoiceBadge(job) -> HTMLElement` (`span.badge.inv-ok` "Fatura kesildi" or `span.badge.inv` "Fatura kesilmedi"); search filter key `fatura`; `monthlySummary` entries gain `cost` and `profit`.

- [ ] **Step 1: Failing tests:** filter `fatura` keeps a folder with one non-invoiced job and drops a folder whose jobs are all invoiced; `monthlySummary` of jobs `{net:30000,costs:[20000 item]}` and `{net:10000}` in the same month gives `cost: 20000`, `profit: 20000`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `.badge.inv` uses the `--warn`/`--warn-soft` pair; `.badge.inv-ok` is quiet (`--fill` background, `--steel` text) in light and dark. Folder rows show `invoiceBadge(last)` after `statusBadge(last)`; job rows show `invoiceBadge(j)` and, when `costTotal(j.costs) > 0`, a small "Maliyet <amount>" line in the existing muted meta style. Add `['fatura', 'Faturasız']` to FILTERS. Earnings metrics add "Maliyet" and "Kâr" (due color if negative).
- [ ] **Step 4: Run** `npm test` — PASS; check list, folder and Kazanç screens in the browser at 390px width (badges wrap without overflow).
- [ ] **Step 5: Commit** `Fatura rozetleri, Faturasız süzgeci, Kazanç'ta maliyet ve kâr`.

### Task 6: Accident report document kind

**Files:**
- Modify: `app/js/ai/schemas.js` (KINDS 28-81), `app/js/ai/claude.js` (`normalize` 50-79), `app/js/ai/mock.js`, `app/js/lib/merge-ai.js` (AI_PATHS 4-19), `app/js/ui/docs.js` (draft 13, frame 48), `app/js/lib/share.js` (SECTIONS 5-23), `app/js/ui/screens/folder-view.js` (GROUPS 15, document buttons 114-122), `app/js/ui/photo-viewer.js` (KIND_LABEL 8), `app/js/ui/screens/folder-edit.js` (DOCS 16, COPY_FROM_EXISTING 17, form sections 248-263)
- Use: `app/img/ic-tutanak.webp` (provided, 192×192, same style as `ic-ruhsat.webp`)
- Test: `tests/claude.test.mjs`, `tests/merge-ai.test.mjs`, `tests/share.test.mjs`

**Interfaces:**
- Produces: `KINDS.tutanak` with label "Kaza tutanağı" and fields `aAdSoyad, aTc, aEhliyet, aAlindigiYer, aAdres, aTel, aPlaka, bAdSoyad, bTc, bEhliyet, bAlindigiYer, bAdres, bTel, bPlaka`; `AI_PATHS.tutanak` mapping each key to `tutanak.<key>`; share sections `tutanakA` "Tutanak A" and `tutanakB` "Tutanak B" (rows Plaka, Ad Soyad, T.C. Kimlik No, Ehliyet, Telefon, Adres, Alındığı yer).

- [ ] **Step 1: Failing tests:** the generic "every schema requires all its fields plus belirsiz" test now covers `tutanak`; `normalize('tutanak', …)` cleans `aTc`/`bTc` like `tc`, `aPlaka`/`bPlaka` like `plaka`, `aAdSoyad`/`bAdSoyad` like `adSoyad`, and keeps unreadable values empty in `belirsiz`; `mergeAi` writes `tutanak.aAdSoyad` into an empty folder and leaves a hand-typed `tutanak.aTel` untouched; `folderSections` returns the B section only when a B field is filled, and its copy text lists the rows in the order above.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Prompt (Turkish) for the kind: read only the "Sürücü Bilgileri" boxes of A and B and the two plates from "Araç Bilgileri"; driving licence number and class as one value like "106408-B"; ignore place, time, insurance, sketch, statements and signatures; leave unclear handwriting empty and list it in `belirsiz`. Camera frame `page` (an upright A4 page, hint "Tutanağın tamamını çerçeveye al", informal like the other camera hints). Add `tutanak` to every hard-coded document list (`docs.js` draft, merge-ai, share, folder-view GROUPS "Belgeler" and the "Belge ekle" buttons, photo-viewer label, folder-edit DOCS and a manual-edit form section for both drivers). Keep `tutanak` out of COPY_FROM_EXISTING. The "Belge ekle" button for the kind appears when the folder has no tutanak data.
- [ ] **Step 4: Run** `npm test` — PASS; in the browser with the mock AI, take a tutanak photo in a folder and check both driver sections, copy buttons and the photo label.
- [ ] **Step 5: Commit** `Belge türü: Kaza tutanağı (sadece sürücü bilgileri)`.

### Task 7: Docs

**Files:**
- Modify: `docs/KURULUM.md` (Code.gs update note near line 40; "Günlük kullanım" bullets)

- [ ] **Step 1:** Add one line under Günlük kullanım for costs, the invoice toggle and the tutanak document; note that the Google sheet has the new columns at the end and that Code.gs must be pasted and redeployed for tutanak photo file names.
- [ ] **Step 2: Run** `npm test` — PASS.
- [ ] **Step 3: Commit** `Kurulum notu: maliyet, fatura, tutanak`.
