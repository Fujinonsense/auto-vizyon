import { round2 } from './format.js';

// mode "haric": amount is before KDV. mode "dahil": amount already includes KDV.
// vat is total - net so the three numbers always add up after rounding.
export function computeVat({ amount, mode = 'haric', rate = 20 }) {
  const a = Number(amount) || 0;
  const r = Number(rate) || 0;
  if (mode === 'dahil') {
    const net = round2(a / (1 + r / 100));
    return { net, vat: round2(a - net), total: round2(a) };
  }
  const net = round2(a);
  const vat = round2((net * r) / 100);
  return { net, vat, total: round2(net + vat) };
}
