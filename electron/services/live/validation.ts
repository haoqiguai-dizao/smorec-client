import type { LiveOptions } from '../../../shared/live-types';
import path from 'node:path';
import { isMacApplicationID } from '../../../shared/application-identity';
import { profileID } from '../streaming/validation';

/** Detach and validate renderer options before any asynchronous preparation changes the UI. */
export function parseLiveOptions(value: unknown, platform = process.platform): LiveOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some(key => !['sourceId', 'crop', 'portrait', 'excludedApplications', 'output', 'streamProfileId', 'systemAudio', 'microphone', 'microphoneDeviceId', 'preview', 'inputRecording'].includes(String(key)))) throw new Error('直播设置无效');
  const item = value as Record<string, unknown>;
  if (typeof item.sourceId !== 'string' || !item.sourceId || item.sourceId.length > 4096
    || item.portrait !== undefined && typeof item.portrait !== 'boolean') throw new Error('直播来源无效');
  const result: LiveOptions = { sourceId: item.sourceId,
    ...(item.portrait === undefined ? {} : { portrait: item.portrait }) };
  if (item.output !== undefined && item.output !== 'camera' && item.output !== 'stream') throw new Error('直播输出方式无效');
  if (item.output !== undefined) result.output = item.output;
  if (item.preview !== undefined && typeof item.preview !== 'boolean') throw new Error('直播预览设置无效');
  if (item.preview !== undefined) result.preview = item.preview;
  if (item.inputRecording !== undefined && typeof item.inputRecording !== 'boolean') throw new Error('直播操作记录设置无效');
  if (item.inputRecording !== undefined) result.inputRecording = item.inputRecording;
  if (item.output === 'stream') {
    result.streamProfileId = profileID(item.streamProfileId);
    for (const key of ['systemAudio', 'microphone'] as const) {
      if (item[key] !== undefined && typeof item[key] !== 'boolean') throw new Error('直播声音设置无效');
      result[key] = item[key] === true;
    }
    if (item.microphoneDeviceId !== undefined) {
      if (typeof item.microphoneDeviceId !== 'string' || item.microphoneDeviceId.length > 4096
        || [...item.microphoneDeviceId].some(character => character.charCodeAt(0) < 32)) throw new Error('直播麦克风无效');
      result.microphoneDeviceId = item.microphoneDeviceId;
    }
  }
  if (item.excludedApplications !== undefined) {
    result.excludedApplications = parseExcludedApplications(item.excludedApplications, platform);
  }
  if (item.crop !== undefined) {
    const crop = item.crop;
    if (!crop || typeof crop !== 'object' || Array.isArray(crop)
      || Reflect.ownKeys(crop).some(key => !['x', 'y', 'width', 'height'].includes(String(key)))) throw new Error('直播区域无效');
    const rectangle = crop as Record<string, unknown>;
    if (!['x', 'y', 'width', 'height'].every(key => typeof rectangle[key] === 'number' && Number.isSafeInteger(rectangle[key]))
      || Number(rectangle.x) < 0 || Number(rectangle.y) < 0 || Number(rectangle.width) < 32 || Number(rectangle.height) < 32) throw new Error('直播区域无效');
    result.crop = { x: Number(rectangle.x), y: Number(rectangle.y), width: Number(rectangle.width), height: Number(rectangle.height) };
  }
  return result;
}

export function parseExcludedApplications(value: unknown, platform = process.platform): string[] {
  const ids = value;
  if (platform === 'darwin') {
    if (!Array.isArray(ids) || ids.length > 32 || ids.some(id => typeof id !== 'string' || !isMacApplicationID(id))) {
      throw new Error('排除应用列表无效');
    }
    return [...new Set(ids as string[])];
  }
  if (!Array.isArray(ids) || ids.length > 32 || ids.some(id => typeof id !== 'string' || id.length > 1024
      || [...id].some(character => character.charCodeAt(0) < 32)
      || !/^[a-z]:[\\/][^<>:"|?*]+\.exe$/i.test(id))) throw new Error('排除应用列表无效');
  return [...new Map(ids.map(id => {
    const normalized = path.win32.normalize(id as string);
    return [normalized.toLowerCase(), normalized];
  })).values()];
}
