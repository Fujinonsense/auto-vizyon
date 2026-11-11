// Which rows from the Google sheet overwrite the phone's copy. Rows the phone hasn't sent yet win;
// rows that say the same thing are skipped, so the phone keeps how an amount was typed (KDV dahil).
const JOB_FIELDS = ['folderId', 'date', 'description', 'parts', 'net', 'vat', 'total', 'vatRate', 'paid', 'payer', 'insurer', 'claimNo', 'note', 'costs', 'invoiced'];
const DOCS = ['ruhsat', 'ehliyet', 'kimlik'];
// A job saved before costs and the invoice flag existed says the same as "no costs, not invoiced".
const JOB_DEFAULTS = { costs: [], invoiced: false };
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const sameJobField = (k, a, b) => same(a ?? JOB_DEFAULTS[k], b ?? JOB_DEFAULTS[k]);

export function mergeRemote(local, remote, pendingIds) {
  const jobs = [];
  for (const r of remote.jobs || []) {
    if (!r.id || pendingIds.has(r.id)) continue;
    // A job of a folder deleted on the phone, while that deletion is still on its way to the sheet.
    if (pendingIds.has(r.folderId) && !local.folders.has(r.folderId)) continue;
    const { remoteStamp, plate, name, phone, ...fields } = r;
    const mine = local.jobs.get(r.id);
    if (mine && JOB_FIELDS.every((k) => !(k in fields) || sameJobField(k, fields[k], mine[k]))) continue;
    jobs.push({ ...fields, updatedAt: remoteStamp || Date.now() });
  }

  const folders = [];
  for (const r of remote.folders || []) {
    if (!r.id || pendingIds.has(r.id)) continue;
    const { remoteStamp, ...fields } = r;
    const mine = local.folders.get(r.id);
    const merged = { ...fields };
    for (const d of DOCS) if (fields[d]) merged[d] = { ...mine?.[d], ...fields[d] };
    if (mine && Object.keys(merged).every((k) => same(merged[k], mine[k]))) continue;
    folders.push({ ...merged, updatedAt: remoteStamp || Date.now() });
  }
  return { folders, jobs };
}
