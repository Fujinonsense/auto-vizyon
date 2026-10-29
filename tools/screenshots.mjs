// Phone-size screenshots of every screen with sample customers (iPhone 3x).
// Needs the dev server on :5173, the sample photos in app/demo and a fake camera feed:
//   node tools/screenshots.mjs .superpowers/dl/fakecam.mjpeg
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = 'docs/ekranlar';
const camFeed = resolve(process.argv[2]);
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${camFeed}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Long shots: bottom bars move to the end of the page instead of covering the middle.
const shot = async (name, fullPage = false) => {
  if (fullPage) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const s = document.createElement('style');
      s.id = 'shot-style';
      s.textContent = '.tabbar,.actionbar{position:static!important}';
      document.head.append(s);
    });
  }
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86, fullPage });
  await page.evaluate(() => document.getElementById('shot-style')?.remove());
};
const go = async (hash, ms = 900) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await wait(ms);
};

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const { clearAll } = await import('/js/data/db.js');
  const repo = await import('/js/data/repo.js');
  const { prepareImage } = await import('/js/media/image.js');
  await clearAll();
  const pic = async (n) => prepareImage(await (await fetch(`/demo/${n}`)).blob());
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const seed = [
    { f: { name: 'Mehmet Yıldız', phone: '05449021136', plate: '06 BHK 412', brand: 'BMW', model: '520i', color: 'Siyah', modelYear: '2020' },
      photos: [['arac', 'car3.jpg']], job: { amount: 3500, description: 'Sol ön çamurluk', parts: ['Sol ön çamurluk'], paid: true, date: day(6) } },
    { f: { name: 'Ayşe Kara', phone: '05053776420', plate: '35 KR 7781', brand: 'Mercedes-Benz', model: 'C200', color: 'Siyah', modelYear: '2021' },
      photos: [['arac', 'car2.jpg']], job: { amount: 7500, description: 'Dolu hasarı, kaput ve tavan', parts: ['Dolu hasarı', 'Kaput', 'Tavan'], payer: 'sigorta', insurer: 'Anadolu Sigorta', claimNo: 'HSR-2026-4411', date: day(3) } },
    { f: { name: 'Uğurcan Kaya', phone: '05324182790', plate: '34 NMA 887', brand: 'Audi', model: 'A7', color: 'Siyah', modelYear: '2019', vin: 'WAUZZZ4G7JN012345', engineNo: 'CDU 104522', modelFull: 'A7 SPORTBACK 3.0 TDI QUATTRO', ruhsat: { sahibi: 'Uğurcan Kaya', tcVkn: '10000000146', belgeSeriNo: 'FA 482913', tescilTarihi: '14.06.2021', tipi: '4G' } },
      photos: [['arac', 'car1.jpg'], ['once', 'dent.jpg'], ['ruhsat', 'ruhsat.jpg']], job: { amount: 5000, description: 'Sağ arka kapıda 3 göçük', parts: ['Sağ arka kapı'], date: day(0) } },
  ];
  for (const s of seed) {
    const f = await repo.saveFolder(s.f);
    const j = await repo.saveJob({ folderId: f.id, ...s.job });
    for (const [kind, file] of s.photos) {
      const p = await pic(file);
      await repo.addPhoto({ folderId: f.id, kind, blob: p.blob, thumb: p.thumb, jobId: j.id });
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  localStorage.removeItem('avWelcomeSeen');
  localStorage.setItem('avMockAI', '1');
});
await page.reload({ waitUntil: 'networkidle0' });

await wait(1800);
await shot('01-karsilama');
await page.click('.welcome .btn');
await wait(6800);
await shot('02-ana-ekran');
await shot('03-ana-ekran-tum', true);

// New car: in-app camera fed with the sample car, plate read in the background
await go('#/yeni', 1800);
await shot('04-kamera-arac');
await page.click('.cam-shutter');
await wait(2200);
await page.click('.cam-shutter');
await wait(500);
await page.click('.cam-shutter');
await wait(700);
await shot('05-kamera-hasar');
await page.click('.cam-right button');
await wait(1200);
const [ruhsatBtn] = await page.$$('.doc-row button');
await ruhsatBtn.click();
await wait(1200);
await page.click('.cam-shutter');
await wait(500);
await page.click('.cam-right button');
await wait(2200);
await shot('06-musteri-formu', true);

const id = await page.evaluate(async () => {
  const repo = await import('/js/data/repo.js');
  return (await repo.listFolders()).find((s) => s.folder.name === 'Uğurcan Kaya').folder.id;
});
await go('#/', 600);
await go(`#/klasor/${id}`, 1200);
await shot('07-klasor', true);
await go('#/kazanc', 1200);
await shot('08-kazanc', true);
await go('#/ayarlar', 1000);
await shot('09-ayarlar');

await browser.close();
console.log('screenshots saved to', OUT);
