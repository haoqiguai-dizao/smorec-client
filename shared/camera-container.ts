export interface CameraContainer { extension: 'webm' | 'mp4'; mimeType: string }

/** Undefined is the legacy VP8 protocol. Unknown explicit containers are never guessed. */
export function cameraContainer(value?: unknown): CameraContainer {
  if (value === undefined) return { extension: 'webm', mimeType: 'video/webm;codecs=vp8' };
  if (typeof value !== 'string' || value.length > 128) throw new Error('摄像头编码格式无效');
  const normalized = value.toLowerCase().trim();
  if (/^video\/webm\s*;\s*codecs=(?:vp8|"vp8")$/.test(normalized)) return { extension: 'webm', mimeType: normalized };
  if (/^video\/mp4\s*;\s*codecs=(?:avc[13](?:\.[0-9a-f]{6})?|"avc[13](?:\.[0-9a-f]{6})?")$/.test(normalized)) {
    return { extension: 'mp4', mimeType: normalized };
  }
  throw new Error('摄像头编码格式不受支持');
}

/** Check only bounded magic bytes, including a header split across several IPC chunks. */
export function validateCameraChunkHeader(format: CameraContainer, offset: number, chunk: Uint8Array): void {
  const signature = format.extension === 'webm' ? [0x1a, 0x45, 0xdf, 0xa3] : [0x66, 0x74, 0x79, 0x70];
  const start = format.extension === 'webm' ? 0 : 4;
  for (let index = Math.max(0, start - offset); index < Math.min(chunk.length, start + signature.length - offset); index++) {
    if (chunk[index] !== signature[offset + index - start]) throw new Error(`摄像头数据与 ${format.extension.toUpperCase()} 编码格式不匹配`);
  }
}

export function cameraHeaderLength(format: CameraContainer): number { return format.extension === 'webm' ? 4 : 8; }
