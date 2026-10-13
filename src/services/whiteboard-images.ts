import type { BoardImage, BoardRecording } from '../../shared/whiteboard/types';

const cache = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();
const url = (scope: string, asset: string) => `frameflow://board/${scope}/${asset}`;

export function boardImage(scope: string, asset: string): HTMLImageElement | undefined {
  return loaded.get(url(scope, asset));
}

export function loadBoardImage(scope: string, asset: string): Promise<HTMLImageElement> {
  const key = url(scope, asset);
  const previous = cache.get(key);
  if (previous) return previous;
  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { if (cache.get(key) === request) loaded.set(key, image); resolve(image); };
    image.onerror = () => reject(new Error('白板图片无法读取，请重新打开工程'));
    image.src = key;
  }).catch(error => { if (cache.get(key) === request) cache.delete(key); throw error; });
  cache.set(key, request);
  return request;
}

/** Live scopes are temporary; late image responses must not repopulate a retired session. */
export function releaseBoardImages(scope: string): void {
  if (!scope) return;
  const prefix = `frameflow://board/${scope}/`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
  for (const key of loaded.keys()) if (key.startsWith(prefix)) loaded.delete(key);
}

export function prepareBoardImages(scope: string, recording?: BoardRecording): Promise<void> {
  const assets = new Set<string>();
  for (const event of recording?.events ?? []) {
    const action = event.action;
    if (action.kind === 'image') assets.add(action.asset);
    if (action.kind === 'replace' && action.element.kind === 'image') assets.add(action.element.asset);
  }
  return Promise.all([...assets].map(asset => loadBoardImage(scope, asset))).then(() => undefined);
}

export function prepareSceneImages(scope: string, images: BoardImage[]): Promise<void> {
  return Promise.all(images.map(image => loadBoardImage(scope, image.asset))).then(() => undefined);
}
