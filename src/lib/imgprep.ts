const MAX_SIDE = 2048;
const KEEP_BYTES = 3 * 1024 * 1024;

export async function prepImage(file: File): Promise<{ blob: Blob; w: number; h: number; name: string }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Формат картинки не поддерживается (нужны PNG, JPEG, WebP или GIF)');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const small = scale === 1 && file.size <= KEEP_BYTES;
  if (small && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    const r = { blob: file as Blob, w: bmp.width, h: bmp.height, name: file.name };
    bmp.close();
    return r;
  }
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Не удалось пережать картинку'))), 'image/jpeg', 0.88));
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return { blob, w, h, name: `${base}.jpg` };
}
