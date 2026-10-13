/** WebP is decoded by Chromium before IPC; Electron's native decoder guarantees PNG/JPEG only. */
export async function whiteboardImageBytes(file: File): Promise<Uint8Array> {
  const type = file.type || (/\.webp$/i.test(file.name) ? 'image/webp'
    : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片文件须小于 12 MB');
  if (type !== 'image/webp') return new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16_000_000)
      throw new Error('图片分辨率过大');
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理这张图片');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('图片处理后文件过大');
    return bytes;
  } finally { bitmap.close(); }
}
