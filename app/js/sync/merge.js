// Which rows from the Google sheet overwrite the phone's copy. Rows the phone hasn't sent yet win;
// rows that say the same thing are skipped, so the phone keeps how an amount was typed (KDV dahil).
const JOB_FIELDS = ['folderId', 'date', 'description', 'parts', 'net', 'vat', 'total', 'vatRate', 'paid', 'payer', 'insurer', 'claimNo', 'note'];
const DOCS = ['ruhsat', 'ehliyet', 'kimlik'];
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

export function mergeRemote(local, remote, pendingIds) {
  const jobs = [];
  for (const r of remote.jobs || []) {
    if (!r.id || pendingIds.has(r.id)) continue;
    const { remoteStamp, plate, name, phone, ...fields } = r;
    const mine = local.jobs.get(r.id);
    if (mine && JOB_FIELDS.every((k) => !(k in fields) || same(fields[k], mine[k]))) continue;
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
