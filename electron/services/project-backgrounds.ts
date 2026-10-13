import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BackgroundAsset } from '../../shared/types';
import { MAX_BACKGROUND_PNG_BYTES, MAX_BACKGROUND_SOURCE_BYTES, normalizeBackgroundImage, normalizedPngSize } from './background-image';
import { backgroundIdPattern } from './background-asset-validation';
export { backgroundView, parseBackgroundAssets, MAX_PROJECT_BACKGROUNDS } from './background-asset-validation';

export async function backgroundFile(directory: string, asset: BackgroundAsset): Promise<string> {
  if (!backgroundIdPattern.test(asset.id) || asset.src !== `background-${asset.id}.png`) throw new Error('背景图片文件名无效');
  const filename = path.join(directory, asset.src);
  const [root, stat, real] = await Promise.all([fs.realpath(directory), fs.lstat(filename), fs.realpath(filename)]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BACKGROUND_PNG_BYTES
    || path.dirname(real).toLowerCase() !== root.toLowerCase()) throw new Error('背景图片必须是工程内的独立文件');
  const handle = await fs.open(real, 'r');
  try {
    const header = Buffer.alloc(33);
    if ((await handle.read(header, 0, 33, 0)).bytesRead !== 33) throw new Error('背景图片文件无效');
    normalizedPngSize(header);
  } finally { await handle.close(); }
  return real;
}

export async function validateBackgroundFiles(directory: string, assets: readonly BackgroundAsset[] = []): Promise<void> {
  for (const asset of assets) await backgroundFile(directory, asset);
}

export async function importBackgroundFile(directory: string, source: string): Promise<BackgroundAsset> {
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(source).toLowerCase())) throw new Error('背景图片类型无效');
  const handle = await fs.open(source, 'r');
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BACKGROUND_SOURCE_BYTES) throw new Error('请选择不超过 20 MB 的背景图片');
    bytes = Buffer.alloc(stat.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const chunk = await handle.read(bytes, read, bytes.length - read, null);
      if (!chunk.bytesRead) break;
      read += chunk.bytesRead;
    }
    if (read > stat.size) throw new Error('背景图片在读取时发生变化');
    bytes = bytes.subarray(0, read);
  } finally { await handle.close(); }
  const png = await normalizeBackgroundImage(bytes);
  const id = randomUUID(), src = `background-${id}.png`;
  const name = [...path.basename(source, path.extname(source))].filter(character => character.charCodeAt(0) >= 32)
    .join('').trim().slice(0, 120) || '背景图片';
  await fs.writeFile(path.join(directory, src), png, { flag: 'wx' });
  return { id, name, src };
}
