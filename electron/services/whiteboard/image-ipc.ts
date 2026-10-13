import { clipboard, nativeImage, type IpcMainInvokeEvent } from 'electron';
import { BOARD_WORLD_LIMIT, type BoardPoint } from '../../../shared/whiteboard/types';
import type { WhiteboardJournal } from './journal';

interface Ports {
  handle(name: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
  check(event: IpcMainInvokeEvent, session: unknown): void;
  journal: WhiteboardJournal;
}
function point(value: unknown): BoardPoint {
  if (!value || typeof value !== 'object') throw new Error('图片放置位置无效');
  const point = value as BoardPoint;
  if (![point.x, point.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= BOARD_WORLD_LIMIT))
    throw new Error('图片放置位置无效');
  return point;
}
async function picture() {
  for (const item of await clipboard.read()) {
    for (const type of ['image/png', 'image/jpeg', 'image/tiff', 'image/webp']) {
      if (!item.types.includes(type)) continue;
      const blob = await item.getType(type);
      if (!(blob instanceof Blob)) continue;
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (!image.isEmpty()) return image;
    }
  }
}
/** Clipboard import owns its byte/size constraints, separate from window lifetime. */
export function installWhiteboardImageIpc(ports: Ports) {
  ports.handle('import-image', (event, session, bytes, location) => {
    ports.check(event, session);
    return ports.journal.importImage(bytes as Uint8Array, point(location));
  });
  ports.handle('paste-image', async (event, session, location) => {
    ports.check(event, session);
    const placement = point(location), image = await picture();
    ports.check(event, session);
    if (!image) return undefined;
    const dimensions = image.getSize();
    if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192
      || dimensions.height > 8192 || dimensions.width * dimensions.height > 16_000_000) throw new Error('剪贴板图片分辨率过大');
    const ratio = Math.min(1, 1600 / Math.max(dimensions.width, dimensions.height));
    const normalized = ratio < 1 ? image.resize({ width: Math.round(dimensions.width * ratio) }) : image;
    return ports.journal.importImage(normalized.toPNG(), placement);
  });
}
