# Auto Vizyon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, this session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone web app (PWA) for a PDR shop: in-app camera capture, Claude reads plate / ruhsat / ehliyet / kimlik, customer folders with copy buttons, jobs with KDV, Google Sheet + Drive sync, PC Excel via Power Query, local .xlsx export/import.

**Architecture:** Static, no-build ES-module PWA in `app/`, data in IndexedDB. Claude through the official `@anthropic-ai/sdk` bundled with esbuild into `app/vendor/anthropic.js` and used in the browser (`dangerouslyAllowBrowser`). SheetJS for xlsx. Google Apps Script (`google/Code.gs`) is the cloud hub (Sheet + Drive); the PC's Excel reads its CSV endpoint through Power Query. Pure logic lives in `app/js/lib`, `app/js/excel`, `app/js/sync` and is tested with `node --test`; UI is checked in the browser pane at 390×844.

**Tech Stack:** HTML/CSS/vanilla JS modules, IndexedDB, Service Worker, `@anthropic-ai/sdk@0.134.0`, SheetJS CE 0.20.3, Google Apps Script, Node 24 test runner, `fake-indexeddb`, `@tabler/icons` (build-time only), Python PIL (icons).

**Spec:** `docs/2026-10-29-tasarim.md`

## Global Constraints

- All UI copy Turkish. Money: `Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY', minimumFractionDigits:0, maximumFractionDigits:2})` → `5.000 ₺`, `5.000,5 ₺` is wrong, use `5.000,50 ₺` (2 decimals when not whole).
- Touch targets ≥ 48 px, base font 17 px, inputs ≥ 16 px (no iOS zoom), safe-area insets respected.
- Models: `claude-opus-5-5` (default), `claude-haiku-5-5` (setting). `output_config.effort: "low"`, `output_config.format: {type:"json_schema", schema}`. Opus: `client.beta.messages.create` with `betas:["server-side-fallback-2026-07-01"]`, `fallbacks:"default"`. Haiku: `client.messages.create`, no fallbacks. `max_tokens: 8000`. Always check `stop_reason === "refusal"` first.
- Images: long edge 1600 px JPEG q 0.82 (stored and sent to AI); thumbnails 200 px q 0.7.
- KDV: default rate 20, default mode `haric`.
- Plate canonical `34 NMA 887`: city 01–81; 1 letter → 4–5 digits, 2 letters → 3–4, 3 letters → 2–3.
- VIN: 17 chars `[A-HJ-NPR-Z0-9]`. TC kimlik: 11 digits, official checksum.
- No secrets in the repo. API key, script URL and token live only in the phone's settings.
- Brand: black `#0B0B0C`, gold `#C9A24A` (accent text on dark `#E2C27A`), white. Logo from `img/logo.png`.

## Review Focus

1. No internet or no API key while capturing → photos and folder still save; document shows "Tekrar oku". Test: `readDocument` throws `AiError('no-key')` / `AiError('offline')` (Task 6) and the flow saves without AI (Task 7 browser check).
2. AI refuses or returns non-JSON → no crash, fields left empty. Test: `parseResponse` → `AiError('refusal')`, `AiError('parse')` (Task 6).
3. Same plate typed differently (`34nma887`, `34 nma 887`) → existing folder found. Test: `plateKey` + `findFolderByPlate` (Tasks 1, 2).
4. Turkish money input (`5.000`, `5000,50`, `5.000,50 ₺`, `5,000`) → right number. Test: `parseMoney` (Task 1).
5. Hand-edited Excel (missing IDs, header case/diacritics changed, extra columns) → known rows update, new rows create, unknown columns ignored. Test: `rowToJob`/`headerKey` + workbook round trip (Task 9).

---

### Task 1: Scaffold and pure helpers

**Files:** Create `package.json` (`"type":"module"`, `"test":"node --test tests/"`), `.gitignore`, `app/js/lib/format.js`, `app/js/lib/validate.js`, `app/js/lib/vat.js`, `app/js/lib/uuid.js`, `tests/lib.test.mjs`.

**Interfaces — Produces:**
- `format.js`: `formatMoney(n:number):string`, `parseMoney(s:string):number|null`, `formatDate(isoDate:string):string` (`2026-10-29` → `29.10.2026`), `todayIso():string`, `normalizePhone(s):string` (digits, `0` prefix → `05324182790`), `formatPhone(s):string` (`0532 418 27 90`), `waNumber(s):string` (`905324182790`), `trTitle(s):string`, `folderTitle(folder):string`.
- `validate.js`: `plateKey(s):string` (`34NMA887`), `normalizePlate(s):string`, `isValidPlate(s):boolean`, `normalizeVin(s):string`, `isValidVin(s):boolean`, `isValidTc(s):boolean`.
- `vat.js`: `computeVat({amount, mode, rate}) → {net, vat, total}` rounded to 2 decimals.
- `uuid.js`: `newId():string`.

- [ ] Step 1: tests — `formatMoney(5000)==="5.000 ₺"`, `formatMoney(5000.5)==="5.000,50 ₺"`; `parseMoney` for `"5.000"`→5000, `"5000,50"`→5000.5, `"5.000,50 ₺"`→5000.5, `"5,000"`→5000? no: `"5,000"`→5 (Turkish comma is decimal) , `""`→null; `formatPhone("05324182790")==="0532 418 27 90"`; `waNumber("0532 418 27 90")==="905324182790"`; `trTitle("SİYAH")==="Siyah"`, `trTitle("MERCEDES-BENZ")==="Mercedes-Benz"`, `trTitle("BMW")==="BMW"`; `folderTitle({name:"Uğurcan Kaya",color:"Siyah",brand:"Audi",model:"A7",plate:"34 NMA 887"})==="Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)"`, without vehicle → `"Uğurcan Kaya (34 NMA 887)"`, without name → `"Siyah Audi A7 (34 NMA 887)"`, empty → `"İsimsiz kayıt"`; `normalizePlate("34nma887")==="34 NMA 887"`, `isValidPlate("34 A 1234")`, `!isValidPlate("99 AB 123")`, `!isValidPlate("34 ABC 1234")`; `isValidVin("WAUZZZ4G7JN012345")`, `!isValidVin("WAUZZZ4G7JN01234O")`; `isValidTc("10000000146")`, `!isValidTc("12345678901")`; `computeVat({amount:5000,mode:"haric",rate:20})` → `{net:5000,vat:1000,total:6000}`, `dahil` 6000 → `{net:5000,vat:1000,total:6000}`.
- [ ] Step 2: `npm test` → fails (modules missing).
- [ ] Step 3: implement. `trTitle`: lower with `tr` locale, capitalize each word and each hyphen part; keep all-caps tokens of ≤3 letters listed in `KEEP_UPPER = ["BMW","VW","MG","DS","GMC","KIA"?]` — KIA becomes `Kia`; list: `BMW, VW, MG, DS, GMC, BYD, TOGG`→`Togg`? keep `TOGG` as `Togg`. `parseMoney`: strip `₺`/spaces, if both `.` and `,` → `.` thousands `,` decimal; only `,` → decimal; only `.` with 3 digits after → thousands, else decimal.
- [ ] Step 4: `npm test` → pass.
- [ ] Step 5: `git init`, commit.

### Task 2: Data layer

**Files:** Create `app/js/data/db.js`, `app/js/data/repo.js`, `tests/repo.test.mjs` (imports `fake-indexeddb/auto`).

**Interfaces — Consumes:** Task 1 helpers. **Produces:**
- `db.js`: `openDb()`, `get(store,key)`, `put(store,obj)`, `del(store,key)`, `all(store)`, `byIndex(store,index,value)`, `tx(stores, mode, fn)`. DB `autovizyon` v1: `folders{id}`, `jobs{id, idx folderId}`, `photos{id, idx folderId}`, `settings{key}`, `outbox{seq auto}`.
- `repo.js`: `saveFolder(partial):Promise<Folder>`, `getFolder(id)`, `listFolders():Promise<Summary[]>` (`{folder, jobs, cover}` sorted by last activity desc), `findFolderByPlate(plate)`, `deleteFolder(id)`, `saveJob(partial):Promise<Job>`, `deleteJob(id)`, `jobsForFolder(id)`, `addPhoto({folderId, kind, blob, thumb, jobId}):Promise<Photo>`, `listPhotos(folderId)`, `getPhoto(id)`, `deletePhoto(id)`, `setCover(folderId, photoId)`, `getSettings():Promise<Settings>`, `setSetting(key,value)`, `peekOutbox(limit)`, `ackOutbox(seqs)`, `applyRemote({folders, jobs})`, `onChange(cb):unsubscribe`.
- Shapes exactly as spec "Veri" section; `Folder.plateKey` derived; every save sets `updatedAt = Date.now()` and enqueues `{kind:'folder'|'job'|'photo'|'delFolder'|'delJob', id}`; first photo becomes cover.
- Settings defaults: `{apiKey:"", model:"claude-opus-5-5", vatRate:20, vatMode:"haric", scriptUrl:"", token:"", waTemplate:"Merhaba {ad}, {plaka} plakalı aracınızın işlemi tamamlandı. Auto Vizyon Boyasız Hasar Onarım", lastPull:0}`.

- [ ] Step 1: tests — save+get folder; `findFolderByPlate("34nma887")` finds `"34 NMA 887"`; `saveJob` fills net/vat/total; `listFolders` newest activity first and cover is first photo; `deleteFolder` removes jobs and photos; outbox has entries in order; `applyRemote` does not enqueue.
- [ ] Step 2: run → fail. Step 3: implement. Step 4: run → pass. Step 5: commit.

### Task 3: App shell, design system, icons

**Files:** Create `app/index.html`, `app/css/app.css`, `app/js/main.js`, `app/js/ui/dom.js`, `app/js/ui/icons.js` (generated), `tools/build-icons.mjs`, `tools/make-icons.py`, `app/img/{logo.png, mark.png, icon-192.png, icon-512.png, apple-touch-icon.png}`, `app/manifest.webmanifest`, `app/sw.js`, `.claude/launch.json`.

**Produces:**
- Router in `main.js`: `registerScreen(name, render)`, `go(path)`, `back()`; hash routes `#/`, `#/yeni`, `#/klasor/:id`, `#/klasor/:id/duzenle`, `#/kazanc`, `#/ayarlar`.
- `dom.js`: `h(tag, attrs, ...children)`, `icon(name, size)`, `toast(text, type)`, `confirmSheet({title, message, okText, danger}):Promise<boolean>`, `sheet(contentEl, {title}):{close}`, `copyRow(label, value):HTMLElement` (copy button on the left; toast "Kopyalandı").
- SW: cache-first app shell `av-v1`, versioned; network-only for `api.anthropic.com` and `script.google.com`.

- [ ] Step 1: generate icons (PIL: crop AV mark from logo, transparent mark, 192/512/180 icons on white).
- [ ] Step 2: build shell; verify in browser pane at 390×844: header logo, bottom nav (Klasörler, Kazanç, Ayarlar) + big "Yeni araç" button, empty state, no console errors, manifest + SW registered. Step 3: commit.

### Task 4: List screen and search

**Files:** Create `app/js/lib/search.js`, `app/js/ui/screens/list.js`, `tests/search.test.mjs`.

**Produces:** `matchesQuery(summary, query):boolean`, `filterSummaries(list, {query, filter:'tum'|'borc'|'sigorta'|'buay'}, now:Date)`, `foldTr(s)` (lowercase tr, strip diacritics).

- [ ] Step 1: tests — `"34nma"` matches `34 NMA 887`; `"ugurcan"` matches `Uğurcan`; `"4182790"` matches phone; VIN part matches; claim no matches; `borc` keeps folders with an unpaid job; `sigorta` keeps payer sigorta; `buay` keeps jobs dated in `now`'s month.
- [ ] Step 2–4: fail, implement, pass. List rows: 56 px square thumb (cover) left, title, phone, last job total + badge (Ödendi / Borç / Sigorta). Filter chips. Step 5: browser check with seeded demo data, commit.

### Task 5: Image and camera

**Files:** Create `app/js/media/image.js`, `app/js/media/camera.js`.

**Produces:** `prepareImage(blob):Promise<{blob, thumb, width, height}>`, `blobToBase64(blob):Promise<string>`; `openCamera({title, hint, multi, skipText, doneText}):Promise<{photos:Blob[], skipped:boolean}|null>` returning an object with `setStatus(node)` via `onOpen(api)` callback option. Live `getUserMedia({video:{facingMode:{ideal:"environment"}, width:{ideal:1920}, height:{ideal:1080}}})`; shutter grabs full video frame; multi mode shows thumbnail strip with delete; "Galeri" (`input[type=file][multiple]`); on error/denied falls back to `input[capture=environment]` with a clear message; stops tracks on close.

- [ ] Step 1: implement; Step 2: browser check (no camera in pane → fallback UI, gallery input works with injected file); Step 3: commit.

### Task 6: AI reading

**Files:** Create `tools/build-vendor.mjs` (esbuild → `app/vendor/anthropic.js`, copy SheetJS → `app/vendor/xlsx.mjs`), `app/js/ai/schemas.js`, `app/js/ai/claude.js`, `app/js/ai/mock.js`, `tests/claude.test.mjs`.

**Produces:**
- `schemas.js`: `KINDS = {arac, ruhsat, ehliyet, kimlik}` each `{label, prompt, schema, fields:[{key,label}]}`. Fields: arac `plaka, renk, marka, model`; ruhsat `plaka, marka, model, ticariAdi, tipi, modelYili, renk, saseNo, motorNo, sahibiAdSoyad, tcVkn, belgeSeriNo, tescilTarihi`; ehliyet `adSoyad, tc, ehliyetNo, sinif, verilisTarihi, dogumTarihi`; kimlik `adSoyad, tc, dogumTarihi, seriNo, gecerlilik`. Every schema also has `belirsiz: string[]` (keys the model is unsure of). All strings, `""` when not visible, dates `GG.AA.YYYY`, `additionalProperties:false`, all keys required.
- `claude.js`: `class AiError extends Error {code}`; `buildRequest(kind, images:{base64, mediaType}[], model)`; `parseResponse(kind, response) → {fields, unclear}`; `readDocument(kind, blobs, {apiKey, model}) → {fields, unclear}`; `testKey(apiKey, model)`.
- `mock.js`: `mockRead(kind)` canned Uğurcan Kaya / Audi A7 data; used when `localStorage.avMockAI === "1"`.

- [ ] Step 1: tests — opus request uses `betas:["server-side-fallback-2026-07-01"]`, `fallbacks:"default"`, `output_config.effort==="low"`, `output_config.format.type==="json_schema"`, images before text; haiku request has no `betas`/`fallbacks`; `parseResponse` takes the last text block, `"34nma887"`→`"34 NMA 887"`, invalid VIN and bad TC are added to `unclear`, `trTitle` applied to renk/marka; `stop_reason:"refusal"` → `AiError` code `refusal`; non-JSON → `parse`; missing key → `no-key`; `navigator.onLine===false` → `offline`; SDK `AuthenticationError` → `auth`, `RateLimitError` → `rate`.
- [ ] Step 2–4: fail, implement (client: `new Anthropic({apiKey, dangerouslyAllowBrowser:true})`, injectable for tests), pass. Step 5: commit.

### Task 7: New-car flow and folder edit

**Files:** Create `app/js/ui/docs.js`, `app/js/ui/screens/capture.js`, `app/js/ui/screens/folder-edit.js`.

**Consumes:** `openCamera`, `prepareImage`, `readDocument`, repo. **Produces:** `captureDocument(kind, draft):Promise<void>` (camera → AI → merge into draft), `mergeAi(draft, kind, fields, unclear)` (fills empty or AI-filled fields only; never overwrites manual edits; name fallback order ruhsat sahibi → kimlik → ehliyet).

Flow: car photo (single) → AI `arac` in background → "Hasar fotoğrafları (öncesi)" multi camera with `Geç` / `Devam` and status chip (plate, or "Bu plaka kayıtlı: …") → edit screen. Edit screen: name, phone, plate (unclear fields amber outline), Ruhsat / Ehliyet / Kimlik buttons (done state ✓ + "Tekrar oku"), vehicle details collapsible, optional first job (description, part chips, amount, KDV mode, payer). Existing plate banner: "Eski klasöre ekle" / "Yeni klasör". Save → folder + photos + job → `#/klasor/:id`.

- [ ] Step 1: implement; Step 2: browser check with mock AI: full flow ends with list title `Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)`, 1 car + 2 damage photos stored, ruhsat fields filled; flow with AI throwing `no-key` still saves; Step 3: commit.

### Task 8: Folder view, job sheet, photos

**Files:** Create `app/js/ui/screens/folder-view.js`, `app/js/ui/screens/job-edit.js`, `app/js/ui/photo-viewer.js`.

**Produces:** `sectionCopyText(title, rows):string` (`"Plaka: 34 NMA 887\nŞase No: …"`), `waLink(folder, template):string` (`https://wa.me/905324182790?text=…`, `{ad}`, `{plaka}` replaced), `openJobSheet(folderId, jobId?)`, `openPhotoViewer(photos, index)`.

View: cover + title + phone; actions Ara (`tel:`), WhatsApp, Düzenle, Sil (confirm); sections Müşteri, Araç, Ruhsat, Ehliyet, Kimlik — each value row has the copy button on the left, each section "Tümünü kopyala"; missing documents show "+ Ruhsat ekle" etc.; jobs list (paid toggle, tap to edit) + "Yeni iş"; photos grouped Araç / Öncesi / Sonrası / Belgeler + "Sonrası fotoğrafı ekle". Job sheet: date, description, part chips (Kaput, Tavan, Bagaj, Ön tampon, Arka tampon, Sol ön çamurluk, Sağ ön çamurluk, Sol ön kapı, Sağ ön kapı, Sol arka kapı, Sağ arka kapı, Sol arka çamurluk, Sağ arka çamurluk), amount (`inputmode=decimal`), KDV hariç/dahil, live net/KDV/toplam, paid toggle, payer müşteri/sigorta + insurer + claim no, note. Viewer: swipe, share (`navigator.share({files})`), make cover, delete.

- [ ] Step 1: unit test `sectionCopyText`, `waLink` in `tests/folder.test.mjs`; Step 2: implement; Step 3: browser check (clipboard text via JS, VAT live numbers); Step 4: commit.

### Task 9: Earnings and Excel export/import

**Files:** Create `app/js/excel/columns.js`, `app/js/excel/xlsx.js`, `app/js/ui/screens/earnings.js`, `tests/excel.test.mjs`.

**Produces:** `JOB_COLUMNS`, `FOLDER_COLUMNS` (`{key, header, width, type}` in spec order), `headerKey(h)`, `jobToRow(job, folder)`, `folderToRow(folder)`, `rowToJob(row)`, `rowToFolder(row)`, `monthlySummary(jobs) → [{month, count, net, vat, total, paid, unpaid}]`, `buildWorkbook({folders, jobs, month?}):Promise<Blob>` (sheets İşler, Müşteriler, Özet; currency format `#,##0.00 "₺"`), `readWorkbook(blob):Promise<{folders, jobs}>`, `importRecords({folders, jobs})` (upsert by id; job without folder id matched by plate; new ids for rows without id), `shareOrDownload(blob, filename)`.

- [ ] Step 1: tests — header normalization (`"KDV ORANI"`, `"kdv orani"` → same key), job row round trip, unknown columns ignored, rows without id get new ids, `monthlySummary` sums and paid/unpaid split, build→read round trip through SheetJS in Node.
- [ ] Step 2–4: fail, implement, pass. Earnings screen: month switcher, 4 metric cards (Araç, Net, KDV, Toplam) + Tahsil edilen / Bekleyen, unpaid list, buttons "Bu ayı Excel'e aktar", "Tümünü Excel'e aktar". Step 5: browser check, commit.

### Task 10: Settings and setup code

**Files:** Create `app/js/lib/setupcode.js`, `app/js/ui/screens/settings.js`, `app/kurulum.html`, `tests/setupcode.test.mjs`.

**Produces:** `encodeSetup({apiKey, model, scriptUrl, token}):string` (`"AV1-" + base64url(JSON)`), `decodeSetup(code):object` (throws on bad prefix/JSON).

Settings: Kurulum kodunu yapıştır (clipboard read + textarea), API key (masked, Test), model (Opus 5.5 "En doğru" / Haiku 5.5 "Ucuz"), KDV rate + default mode, WhatsApp template, Google section (URL, token, Test, Şimdi eşitle, last sync, status), Excel import, data backup JSON download/restore, version. `kurulum.html`: standalone page that builds the code locally (no network).

- [ ] Step 1: tests round trip + garbage rejected; Step 2–4: fail, implement, pass; Step 5: browser check, commit.

### Task 11: Google sync

**Files:** Create `google/Code.gs`, `app/js/sync/merge.js`, `app/js/sync/google.js`, `tests/merge.test.mjs`, `tests/appsscript.test.mjs`.

**Protocol:** POST (text/plain JSON) `{token, ops:[{op:"upsertFolder", row}, {op:"upsertJob", row}, {op:"deleteFolder", id}, {op:"deleteJob", id}, {op:"photo", folderId, folderTitle, kind, photoId, base64}]}` → `{ok, results:[{ok, driveFileId?, driveUrl?, error?}], serverTime}`. GET `?token&action=ping|pull&since=ms|csv&sheet=isler|musteriler|photo&id=`. Rows use the `columns.js` headers (Code.gs embeds the same header lists; test asserts equality).

**Produces:** `mergeRemote({folders, jobs}, remote, pendingIds:Set) → {folders:[], jobs:[]}` to write; `syncNow():Promise<SyncStatus>`, `startAutoSync()`, `syncStatus` (`{state:'off'|'ok'|'pending'|'error', lastSync, error}`), `testConnection(url, token)`.

Code.gs: `kurulum()` creates sheets İşler / Müşteriler / Özet (formulas by month), headers, frozen bold header, Drive folder "Auto Vizyon", random token in Script Properties, logs URL+token; `doGet`, `doPost` (LockService), `onEdit` (stamps Güncellendi; recomputes KDV/Toplam when Tutar, KDV Oranı or KDV Durumu edited), photo → per-folder Drive folder named by folder title (renamed when title changes).

- [ ] Step 1: tests — Code.gs in `vm` with fake SpreadsheetApp/DriveApp/PropertiesService/LockService/ContentService/Utilities: wrong token rejected; upsert inserts then updates same row; pull returns rows newer than `since`; onEdit recompute; photo goes into the folder's Drive folder; header lists equal `columns.js`. merge: remote newer wins, pending local wins, local-only untouched.
- [ ] Step 2–4: fail, implement, pass. Status icon in header; auto sync on change (3 s debounce), on visibility, every 60 s. Step 5: commit.

### Task 12: Setup guide, deploy, final check

**Files:** Create `docs/KURULUM.md`, `.github/workflows/pages.yml` (deploy `app/`), `README.md`.

- [ ] Step 1: KURULUM.md (Turkish, numbered): GitHub Pages address; Anthropic Console account, $5 credit, auto-reload off, API key; Google Sheet → Uzantılar → Apps Script → paste Code.gs → run `kurulum` → deploy web app (Execute as me, Anyone) → URL + token; kurulum.html → code → WhatsApp → iPhone Ayarlar → Yapıştır; iPhone Safari → Paylaş → Ana Ekrana Ekle; PC Excel: Veri → Web'den → CSV URL → Yükle → Sorgu Özellikleri: her 1 dakikada ve açılışta yenile.
- [ ] Step 2: ask the user before creating the public repo and enabling Pages; deploy.
- [ ] Step 3: `npm test` all green; browser pass at 390×844 over every screen; commit.
