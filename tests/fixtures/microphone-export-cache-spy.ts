import { resolveProjectAudio as resolve } from '../../electron/services/project-audio';
export const exportCachePaths: string[] = [];
export async function resolveProjectAudio(...parameters: Parameters<typeof resolve>) {
  const audio = await resolve(...parameters); if (audio) exportCachePaths.push(audio.path); return audio;
}
