// Files out of the app. In the iPhone app (Capacitor) they go through the native share sheet
// (Dosyalar'a kaydet, WhatsApp, Mail, AirDrop); in a browser, Web Share or a plain download.

const bridge = () => (globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor : null);

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// files: [{ name, blob }]
export async function shareFiles(files, title) {
  const cap = bridge();
  if (cap) {
    const uris = [];
    for (const f of files) {
      const { uri } = await cap.nativePromise('Filesystem', 'writeFile', { path: f.name, data: await toBase64(f.blob), directory: 'CACHE' });
      uris.push(uri);
    }
    try {
      await cap.nativePromise('Share', 'share', { title, files: uris });
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) throw e;
    }
    return;
  }

  const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  for (const f of list) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
