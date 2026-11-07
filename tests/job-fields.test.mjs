import 'fake-indexeddb/auto';
import { test, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type, byText, settle } from './helpers/fake-dom.mjs';

const dom = installDom();
const repo = await import('../app/js/data/repo.js');
const { clearAll } = await import('../app/js/data/db.js');
const { jobFields } = await import('../app/js/ui/job-fields.js');
const { openJobSheet } = await import('../app/js/ui/job-edit.js');

after(() => dom.uninstall());
beforeEach(async () => {
  await clearAll();
  mock.timers.enable({ apis: ['setTimeout'] }); // toasts and sheets wait seconds before they go
});
afterEach(() => {
  mock.timers.reset();
  dom.document.body.querySelectorAll('.sheet-wrap, .toast').forEach((n) => n.remove());
});

// The "Maliyet" part of a job: "Masraf ekle" and its small form.
function costs(root) {
  const box = root.querySelector('.cost-box');
  const form = box.querySelector('.cost-form');
  return {
    form,
    open: () => byText(box, 'button', 'Masraf ekle').click(),
    pick: (key) => form.querySelector(`.chip[data-key="${key}"]`).click(),
    firstChip: form.querySelector('.cost-cats .chip'),
    amount: form.querySelector('input.amount'),
    whatFor: form.querySelector('input[type="text"]'),
    hint: () => form.querySelector('.cost-hint'),
    cancel: () => byText(form, 'button', 'Vazgeç').click(),
  };
}
const fields = () => jobFields({}, { vatRate: 20, vatMode: 'haric' });
const active = () => dom.document.activeElement;
const toastText = () => dom.document.getElementById('toast')?.textContent ?? '';

test('a job without costs: nothing to fix, nothing invented', () => {
  const ui = fields();
  assert.equal(ui.costDraftProblem(), '');
  assert.deepEqual(ui.read().costs, []);
});

test('"Masraf ekle" opened and left empty never stops saving', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  assert.equal(ui.costDraftProblem(), '');
  c.pick('boya');
  assert.equal(ui.costDraftProblem(), '', 'a category alone is nothing typed');
  assert.deepEqual(ui.read().costs, []);
  assert.equal(c.hint().hidden, true);
});

test('a complete cost not added with "Ekle" is saved, not lost', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  c.pick('boya');
  type(c.amount, '20.000');
  assert.equal(ui.costDraftProblem(), '');
  assert.deepEqual(ui.read().costs, [{ cat: 'boya', label: '', amount: 20000 }]);
});

test('an amount typed before a category is picked: says so under the chips and goes to them', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  type(c.amount, '5000');
  assert.equal(ui.costDraftProblem(), 'Masrafın türünü seç');
  assert.equal(c.hint().hidden, false);
  assert.equal(c.hint().textContent, 'Masrafın türünü seç');
  const parts = c.form.children;
  assert.equal(parts[parts.indexOf(c.hint()) - 1], c.form.querySelector('.cost-cats'), 'the line is right under the chips');
  assert.equal(active(), c.firstChip);
  assert.deepEqual(ui.read().costs, [], 'nothing made up');
});

test('Kaydet keeps the line in sight above the toast: the chips go up with it under them, a field to fill to the middle', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  type(c.amount, '5000');
  ui.costDraftProblem();
  assert.equal(c.form.querySelector('.cost-cats').scrolledIntoView, 1, 'the chips, the line right under them');
  assert.equal(c.firstChip.scrolledIntoView, 0, 'not the first chip alone, which leaves the line low on a small phone');
  assert.equal(active(), c.firstChip);
  c.pick('diger');
  ui.costDraftProblem();
  assert.equal(c.whatFor.scrolledIntoView, 1, 'the field to fill, the line just above it');
});

test('"Diğer" with an amount but no "Ne için?": says so and goes to it', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  c.pick('diger');
  type(c.amount, '1500');
  assert.equal(ui.costDraftProblem(), 'Masrafın ne için olduğunu yaz');
  assert.equal(active(), c.whatFor);
  type(c.whatFor, '  ;  ');
  assert.equal(ui.costDraftProblem(), 'Masrafın ne için olduğunu yaz', 'only signs that cannot be kept');
});

test('a category and "Ne için?" but no usable amount: says so and goes to the amount', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  c.pick('diger');
  type(c.whatFor, 'Cam filmi');
  assert.equal(ui.costDraftProblem(), 'Masrafın tutarını yaz');
  assert.equal(active(), c.amount);
  c.pick('boya');
  type(c.amount, '0');
  assert.equal(ui.costDraftProblem(), 'Masrafın tutarını yaz');
  type(c.amount, '-500');
  assert.equal(ui.costDraftProblem(), 'Masrafın tutarını yaz');
});

test('the line under the chips follows the fix and goes with "Vazgeç"', () => {
  const ui = fields();
  const c = costs(ui.el);
  c.open();
  type(c.amount, '1500');
  ui.costDraftProblem();
  c.pick('diger');
  assert.equal(c.hint().textContent, 'Masrafın ne için olduğunu yaz', 'the next thing to fix');
  type(c.whatFor, 'Cam filmi');
  assert.equal(c.hint().hidden, true, 'complete now');
  assert.deepEqual(ui.read().costs, [{ cat: 'diger', label: 'Cam filmi', amount: 1500 }]);
  type(c.whatFor, '');
  ui.costDraftProblem();
  assert.equal(c.hint().hidden, false);
  c.cancel();
  assert.equal(c.hint().hidden, true);
  assert.equal(ui.costDraftProblem(), '');
});

async function jobSheet(folderId, job) {
  await openJobSheet(folderId, job);
  await settle();
  return dom.document.body.querySelectorAll('.sheet-wrap').at(-1);
}
const save = (sheet) => Promise.all(byText(sheet, 'button', 'Kaydet').click());

test('job sheet: Kaydet with a half-typed cost saves nothing and says why; once fixed it saves the cost', async () => {
  const f = await repo.saveFolder({ name: 'Ali Veli' });
  const sheet = await jobSheet(f.id);
  type(sheet.querySelector('input.amount[aria-label="Tutar"]'), '30000');
  const c = costs(sheet);
  c.open();
  type(c.amount, '20000');
  await save(sheet);
  await settle();
  assert.deepEqual(await repo.jobsForFolder(f.id), [], 'not saved');
  assert.equal(toastText(), 'Masrafın türünü seç');
  assert.ok(dom.document.getElementById('toast').classList.contains('err'));
  assert.ok(sheet.classList.contains('open'), 'the sheet stays open');
  c.pick('dis-iscilik');
  await save(sheet);
  await settle();
  const [job] = await repo.jobsForFolder(f.id);
  assert.deepEqual(job.costs, [{ cat: 'dis-iscilik', label: '', amount: 20000 }]);
  assert.equal(job.amount, 30000);
  assert.equal(toastText(), 'Kaydedildi');
  assert.equal(sheet.classList.contains('open'), false, 'closed after saving');
});

test('job sheet: a job without costs saves exactly as before', async () => {
  const f = await repo.saveFolder({ name: 'Ali Veli' });
  const sheet = await jobSheet(f.id);
  type(sheet.querySelector('input.amount[aria-label="Tutar"]'), '5000');
  await save(sheet);
  await settle();
  const [job] = await repo.jobsForFolder(f.id);
  assert.equal(job.total, 6000);
  assert.deepEqual(job.costs, []);
  assert.equal(job.invoiced, false);
  assert.equal(toastText(), 'Kaydedildi');
});
