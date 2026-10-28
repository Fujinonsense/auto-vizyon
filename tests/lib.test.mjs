import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney, parseMoney, formatDate, normalizePhone, formatPhone, waNumber,
  trTitle, latinTitle, folderTitle,
} from '../app/js/lib/format.js';
import { plateKey, normalizePlate, isValidPlate, normalizeVin, isValidVin, isValidTc } from '../app/js/lib/validate.js';
import { computeVat } from '../app/js/lib/vat.js';
import { newId } from '../app/js/lib/uuid.js';

test('formatMoney: whole amounts have no decimals and ₺ comes after the number', () => {
  assert.equal(formatMoney(5000), '5.000 ₺');
  assert.equal(formatMoney(0), '0 ₺');
  assert.equal(formatMoney(1234567), '1.234.567 ₺');
});

test('formatMoney: fractional amounts get two decimals', () => {
  assert.equal(formatMoney(5000.5), '5.000,50 ₺');
  assert.equal(formatMoney(833.333), '833,33 ₺');
});

test('parseMoney: Turkish and English separators', () => {
  assert.equal(parseMoney('5000'), 5000);
  assert.equal(parseMoney('5.000'), 5000);
  assert.equal(parseMoney('5000,50'), 5000.5);
  assert.equal(parseMoney('5.000,50 ₺'), 5000.5);
  assert.equal(parseMoney('5,000'), 5000);
  assert.equal(parseMoney('5,5'), 5.5);
  assert.equal(parseMoney('1.234.567'), 1234567);
  assert.equal(parseMoney('5,000.50'), 5000.5);
  assert.equal(parseMoney('2.500 TL'), 2500);
});

test('parseMoney: empty or garbage gives null', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney(null), null);
});

test('formatDate: ISO date to GG.AA.YYYY', () => {
  assert.equal(formatDate('2026-10-29'), '29.10.2026');
  assert.equal(formatDate(''), '');
});

test('phone helpers', () => {
  assert.equal(normalizePhone('0532 418 27 90'), '05324182790');
  assert.equal(normalizePhone('+90 532 418 27 90'), '05324182790');
  assert.equal(normalizePhone('5324182790'), '05324182790');
  assert.equal(formatPhone('05324182790'), '0532 418 27 90');
  assert.equal(formatPhone('0212 555 1234'), '0212 555 12 34');
  assert.equal(formatPhone(''), '');
  assert.equal(waNumber('0532 418 27 90'), '905324182790');
});

test('trTitle: Turkish words use Turkish casing', () => {
  assert.equal(trTitle('SİYAH'), 'Siyah');
  assert.equal(trTitle('KIRMIZI'), 'Kırmızı');
  assert.equal(trTitle('UĞURCAN KAYA'), 'Uğurcan Kaya');
  assert.equal(trTitle('İSMAİL IŞIK'), 'İsmail Işık');
  assert.equal(trTitle('Beyaz'), 'Beyaz');
});

test('latinTitle: brands and models use Latin casing', () => {
  assert.equal(latinTitle('FIAT'), 'Fiat');
  assert.equal(latinTitle('MERCEDES-BENZ'), 'Mercedes-Benz');
  assert.equal(latinTitle('LAND ROVER'), 'Land Rover');
  assert.equal(latinTitle('BMW'), 'BMW');
  assert.equal(latinTitle('A7'), 'A7');
  assert.equal(latinTitle('EGEA'), 'Egea');
});

test('folderTitle: name - color brand model (plate)', () => {
  const f = { name: 'Uğurcan Kaya', color: 'Siyah', brand: 'Audi', model: 'A7', plate: '34 NMA 887' };
  assert.equal(folderTitle(f), 'Uğurcan Kaya - Siyah Audi A7 (34 NMA 887)');
  assert.equal(folderTitle({ name: 'Uğurcan Kaya', plate: '34 NMA 887' }), 'Uğurcan Kaya (34 NMA 887)');
  assert.equal(folderTitle({ color: 'Siyah', brand: 'Audi', model: 'A7', plate: '34 NMA 887' }), 'Siyah Audi A7 (34 NMA 887)');
  assert.equal(folderTitle({ name: 'Uğurcan Kaya', brand: 'Audi' }), 'Uğurcan Kaya - Audi');
  assert.equal(folderTitle({}), 'İsimsiz kayıt');
});

test('normalizePlate and plateKey ignore spacing and case', () => {
  assert.equal(normalizePlate('34nma887'), '34 NMA 887');
  assert.equal(normalizePlate(' 34 nma 887 '), '34 NMA 887');
  assert.equal(normalizePlate('06BHK412'), '06 BHK 412');
  assert.equal(normalizePlate('35kr7781'), '35 KR 7781');
  assert.equal(normalizePlate('34 NMİ 887'), '34 NMI 887');
  assert.equal(normalizePlate('xyz'), 'XYZ');
  assert.equal(plateKey('34 nma 887'), '34NMA887');
});

test('isValidPlate: city 01-81 and letter/digit counts', () => {
  for (const ok of ['34 A 1234', '34 A 12345', '34 AB 123', '34 AB 1234', '34 ABC 12', '34 NMA 887', '01 AB 123', '81 AB 123']) {
    assert.ok(isValidPlate(ok), ok);
  }
  for (const bad of ['99 AB 123', '00 AB 123', '34 ABC 1234', '34 A 123', '', 'ABC']) {
    assert.ok(!isValidPlate(bad), bad);
  }
});

test('VIN: 17 chars without I, O, Q', () => {
  assert.equal(normalizeVin(' wauzzz4g7jn012345 '), 'WAUZZZ4G7JN012345');
  assert.ok(isValidVin('WAUZZZ4G7JN012345'));
  assert.ok(!isValidVin('WAUZZZ4G7JN01234O'));
  assert.ok(!isValidVin('WAUZZZ4G7JN0123'));
});

test('isValidTc: official checksum', () => {
  assert.ok(isValidTc('10000000146'));
  assert.ok(isValidTc('19090909018'));
  assert.ok(!isValidTc('12345678901'));
  assert.ok(!isValidTc('01234567890'));
  assert.ok(!isValidTc('1000000014'));
});

test('computeVat: amount without KDV', () => {
  assert.deepEqual(computeVat({ amount: 5000, mode: 'haric', rate: 20 }), { net: 5000, vat: 1000, total: 6000 });
});

test('computeVat: amount with KDV included', () => {
  assert.deepEqual(computeVat({ amount: 6000, mode: 'dahil', rate: 20 }), { net: 5000, vat: 1000, total: 6000 });
  assert.deepEqual(computeVat({ amount: 1000, mode: 'dahil', rate: 20 }), { net: 833.33, vat: 166.67, total: 1000 });
});

test('computeVat: empty amount is zero', () => {
  assert.deepEqual(computeVat({ amount: 0, mode: 'haric', rate: 20 }), { net: 0, vat: 0, total: 0 });
  assert.deepEqual(computeVat({ amount: null, mode: 'haric', rate: 20 }), { net: 0, vat: 0, total: 0 });
});

test('newId: unique strings', () => {
  const a = newId();
  const b = newId();
  assert.equal(typeof a, 'string');
  assert.notEqual(a, b);
  assert.ok(a.length >= 16);
});
