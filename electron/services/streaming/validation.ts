import type { StreamProfileDraft } from '../../../shared/streaming';

export function profileID(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error('推流配置不存在');
  return value;
}
export function streamDestination(server: string, key: string): string {
  let url: URL;
  try { url = new URL(server); } catch { throw new Error('请输入完整的 RTMP 或 RTMPS 地址'); }
  if (!['rtmp:', 'rtmps:'].includes(url.protocol) || !url.hostname || url.hash
    || /\s/.test(server + key) || [...server + key].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('推流地址或密钥格式无效');
  if (key && url.search) throw new Error('地址包含参数时，请填写完整推流 URL，并留空流密钥');
  return key ? server.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, '') : server;
}
export function parseStreamProfile(value: unknown): StreamProfileDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('推流配置无效');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['id', 'name', 'server', 'key', 'resolution', 'fps', 'bitrate', 'keyframeSeconds'].includes(key)))
    throw new Error('推流配置包含无效字段');
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
    || typeof item.server !== 'string' || item.server.length > 4096 || typeof item.key !== 'string' || item.key.length > 2048
    || !['720p', '1080p'].includes(String(item.resolution)) || ![30, 60].includes(Number(item.fps))
    || !Number.isSafeInteger(item.fps) || !Number.isSafeInteger(item.bitrate) || Number(item.bitrate) < 500 || Number(item.bitrate) > 20000
    || !Number.isSafeInteger(item.keyframeSeconds) || Number(item.keyframeSeconds) < 1 || Number(item.keyframeSeconds) > 10)
    throw new Error('请检查名称、地址、画质和码率（500–20000 kbps）');
  const server = item.server.trim().replace(/^rtmps?:/i, protocol => protocol.toLowerCase()), key = item.key.trim();
  streamDestination(server, key);
  return { ...(item.id === undefined ? {} : { id: profileID(item.id) }), name: item.name.trim(), server, key,
    resolution: item.resolution as '720p' | '1080p', fps: item.fps as 30 | 60,
    bitrate: Number(item.bitrate), keyframeSeconds: Number(item.keyframeSeconds) };
}
