import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COST_CATS, costLabel, normalizeCosts, costTotal, profit, costsToText, costsFromText,
} from '../app/js/lib/costs.js';

const item = (cat, amount, label = '') => ({ cat, label, amount });
const boya = (amount) => item('boya', amount);

test('cost categories come in the agreed order and cannot be changed by accident', () => {
  assert.deepEqual(COST_CATS.map((c) => [c.key, c.label]), [
    ['dis-iscilik', 'Dış işçilik'], ['boya', 'Boya'], ['parca', 'Yedek parça'],
    ['sarf', 'Sarf malzeme'], ['nakliye', 'Çekici / nakliye'], ['diger', 'Diğer'],
  ]);
  assert.ok(Object.isFrozen(COST_CATS));
  assert.ok(COST_CATS.every((c) => Object.isFrozen(c)));
});

test('costLabel: the category name, or what a "Diğer" cost was for', () => {
  assert.equal(costLabel({ cat: 'diger', label: 'Cam filmi' }), 'Cam filmi');
  assert.equal(costLabel({ cat: 'boya', label: '' }), 'Boya');
  assert.equal(costLabel({ cat: 'nakliye' }), 'Çekici / nakliye');
  assert.equal(costLabel({ cat: 'diger', label: '  ' }), 'Diğer');
  assert.equal(costLabel({ cat: 'bilinmeyen', label: 'Lastik' }), 'Lastik');
});

test('costTotal adds the amounts; no costs is zero', () => {
  assert.equal(costTotal([boya(10000), item('dis-iscilik', 20000)]), 30000);
  assert.equal(costTotal([]), 0);
  assert.equal(costTotal(undefined), 0);
  assert.equal(costTotal(null), 0);
  assert.equal(costTotal([item('sarf', 0.1), item('sarf', 0.2)]), 0.3);
  assert.equal(costTotal([boya('abc'), boya(-50), boya(250)]), 250);
});

test('profit is the amount without KDV minus the costs, and can be negative', () => {
  assert.equal(profit({ net: 30000, costs: [boya(10000)] }), 20000);
  assert.equal(profit({ net: 5000 }), 5000);
  assert.equal(profit({ costs: [boya(100)] }), -100);
  assert.equal(profit({ net: '', costs: [] }), 0);
  assert.equal(profit({}), 0);
  assert.equal(profit(undefined), 0);
  assert.ok(Number.isFinite(profit({ net: 'abc', costs: 'x' })));
});

test('costsToText: "Etiket: tutar" items joined by "; ", plain numbers with a dot', () => {
  assert.equal(costsToText([boya(10000), item('dis-iscilik', 20000)]), 'Boya: 10000; Dış işçilik: 20000');
  assert.equal(costsToText([item('sarf', 1250.5)]), 'Sarf malzeme: 1250.5');
  assert.equal(costsToText([item('diger', 1500, 'Cam filmi')]), 'Cam filmi: 1500');
  assert.equal(costsToText([item('parca', 1234567.89)]), 'Yedek parça: 1234567.89');
  assert.equal(costsToText([]), '');
  assert.equal(costsToText(undefined), '');
});

test('costsFromText reads the sheet text back', () => {
  assert.deepEqual(costsFromText('Dış işçilik: 20000; Boya: 10000; Cam filmi: 1500'), [
    item('dis-iscilik', 20000), item('boya', 10000), item('diger', 1500, 'Cam filmi'),
  ]);
  assert.deepEqual(costsFromText(''), []);
  assert.deepEqual(costsFromText(null), []);
  assert.deepEqual(costsFromText(undefined), []);
  assert.deepEqual(costsFromText('  ;  '), []);
  assert.deepEqual(costsFromText('dış işçilik: 5'), [item('dis-iscilik', 5)]);
});

test('costsFromText forgives hand typing: case, Turkish amounts, ₺, new lines', () => {
  assert.deepEqual(costsFromText('BOYA: 10.000 ₺; sarf malzeme: 1.250,50\nÇEKİCİ / NAKLİYE: 750 TL;DIS ISCILIK:300'), [
    item('boya', 10000), item('sarf', 1250.5), item('nakliye', 750), item('dis-iscilik', 300),
  ]);
  assert.deepEqual(costsFromText('Far: sağ: 400'), [item('diger', 400, 'Far sağ')]);
  // No amount, no label, or a cost that cannot be read is left out.
  assert.deepEqual(costsFromText('Boya; Cam filmi: ; : 500; Lastik: -20; Kaput: yok; Diğer: 300'), [item('diger', 300, 'Diğer')]);
  assert.deepEqual(costsFromText(5000), []);
});

test('normalizeCosts keeps only real costs, cleans labels and rounds amounts', () => {
  const input = [
    boya(0), boya(-5), boya(NaN), boya(Infinity), boya('abc'), boya(null), boya(undefined), boya(true), boya(0.004),
    item('diger', 100, '   '),
    item('diger', 100, 'Cam; filmi: ön'),
    item('diger', 1, 'x'.repeat(50)),
    item('diger', 2, `  Cam\n\tfilmi  `),
    item('parca', 99.999, 'kapı kolu'),
    item('xyz', 10, 'Lastik'),
    item('xyz', 10, ''),
    { label: 'Yıkama', amount: 150 },
    null, 'Boya: 5', 7,
  ];
  const before = JSON.stringify(input);
  assert.deepEqual(normalizeCosts(input), [
    item('diger', 100, 'Cam filmi ön'),
    item('diger', 1, 'x'.repeat(40)),
    item('diger', 2, 'Cam filmi'),
    item('parca', 100),
    item('diger', 10, 'Lastik'),
    item('diger', 150, 'Yıkama'),
  ]);
  assert.equal(JSON.stringify(input), before, 'the input is not changed');
  assert.deepEqual(normalizeCosts(undefined), []);
  assert.deepEqual(normalizeCosts('Boya: 5'), []);
  const kept = item('boya', 5);
  assert.notEqual(normalizeCosts([kept])[0], kept, 'items are copies');
});

test('normalizeCosts reads amounts typed the Turkish way, like the job amount', () => {
  assert.deepEqual(
    normalizeCosts([boya('20.000'), boya('1.250,50'), boya('900'), boya('5,5'), boya('2.500 TL'), boya('750 ₺'), boya('0'), boya('-300'), boya('')]),
    [boya(20000), boya(1250.5), boya(900), boya(5.5), boya(2500), boya(750)],
  );
});

test('a label longer than 40 characters is cut at 40, never in the middle of a character', () => {
  const long = `${'ş'.repeat(39)}😀😀`;
  const [c] = normalizeCosts([item('diger', 1, long)]);
  assert.equal([...c.label].length, 40);
  assert.equal(c.label, `${'ş'.repeat(39)}😀`);
});

test('a "Diğer" cost named like a category becomes that category, so the sheet text reads back the same', () => {
  assert.deepEqual(normalizeCosts([item('diger', 5, 'boya')]), [boya(5)]);
  assert.deepEqual(normalizeCosts([item('diger', 5, 'Yedek Parça')]), [item('parca', 5)]);
  assert.deepEqual(normalizeCosts([item('diger', 5, 'Diğer')]), [item('diger', 5, 'Diğer')]);
});

test('text round trip: what the phone writes to the sheet reads back unchanged', () => {
  const lists = [
    [],
    [boya(10000), item('dis-iscilik', 20000), item('diger', 1500, 'Cam filmi')],
    [item('sarf', 1250.5), item('parca', 0.07), item('nakliye', 1234567.89), item('diger', 12.3, 'Far 2')],
    normalizeCosts([item('diger', 99.999, 'Cam; filmi:'), item('diger', 1, 'DIŞ İŞÇİLİK'), item('diger', 3, 'Diğer')]),
  ];
  for (const list of lists) {
    assert.deepEqual(costsFromText(costsToText(list)), normalizeCosts(list), costsToText(list));
  }
});
