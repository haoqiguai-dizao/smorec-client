import type { BackgroundAsset } from '../../shared/types';

export const MAX_PROJECT_BACKGROUNDS = 32;
export const BACKGROUND_UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const backgroundIdPattern = new RegExp(`^${BACKGROUND_UUID}$`);

export function parseBackgroundAssets(value: unknown): BackgroundAsset[] {
  if (!Array.isArray(value) || value.length > MAX_PROJECT_BACKGROUNDS) throw new Error('背景图片列表无效');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('背景图片无效');
    const asset = item as Record<string, unknown>;
    if (typeof asset.id !== 'string' || !backgroundIdPattern.test(asset.id) || ids.has(asset.id)
      || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 120
      || [...asset.name].some(character => character.charCodeAt(0) < 32)
      || typeof asset.src !== 'string') throw new Error('背景图片信息无效');
    const id = asset.id;
    if (asset.src !== `background-${id}.png` && !new RegExp(`^frameflow://background/${BACKGROUND_UUID}/${id}$`).test(asset.src))
      throw new Error('背景图片来源必须是工程注册资源');
    ids.add(id);
    return { id, name: asset.name.trim(), src: asset.src };
  });
}

export function backgroundView(projectId: string, asset: BackgroundAsset): BackgroundAsset {
  return { ...asset, src: `frameflow://background/${projectId}/${asset.id}` };
}
