// Photos are stored and sent to the AI at 1600 px on the long edge; list thumbnails are 240 px squares.
const MAX_EDGE = 1600;
const THUMB = 240;

export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function squareCrop(width, height) {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

// Decoding through <img> applies the EXIF rotation on iPhone, which canvas alone may not.
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Fotoğraf açılamadı'));
    };
    img.src = url;
  });
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Fotoğraf kaydedilemedi'))), 'image/jpeg', quality);
  });
}

export async function prepareImage(blob) {
  const img = await loadImage(blob);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_EDGE);
  const big = document.createElement('canvas');
  big.width = width;
  big.height = height;
  big.getContext('2d').drawImage(img, 0, 0, width, height);

  const { sx, sy, side } = squareCrop(img.naturalWidth, img.naturalHeight);
  const small = document.createElement('canvas');
  small.width = THUMB;
  small.height = THUMB;
  small.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, THUMB, THUMB);

  return { blob: await toJpeg(big, 0.82), thumb: await toJpeg(small, 0.72), width, height };
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
