import type { WhiteboardApi } from '../shared/whiteboard/types';

/** Native audio/recognition alone is synthetic; the shipping gesture, speech hook and bubble run unchanged. */
export function speechFixture() {
  const listeners = new Set<Parameters<WhiteboardApi['onSpeechLevel']>[0]>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = async () => { clearInterval(timer); timer = undefined; };
  const mode = new URLSearchParams(location.search).get('speech');
  return {
    onSpeechLevel: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    speechReady: async () => true, speechInstall: async () => {},
    speechStart: async (session: string) => {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (mode === 'error') throw new Error('验收用麦克风断开，请重试');
      const id = crypto.randomUUID(); let sample = 0;
      timer = setInterval(() => listeners.forEach(callback => callback({ session, id, level: .2 + .7 * Math.abs(Math.sin(sample++ / 7)) })), 75);
      return id;
    },
    speechStop: async () => { await stop(); await new Promise(resolve => setTimeout(resolve, 1200)); return '切换模式时保留本次内容'; },
    speechCancel: stop,
  } satisfies Pick<WhiteboardApi, 'onSpeechLevel' | 'speechReady' | 'speechInstall' | 'speechStart' | 'speechStop' | 'speechCancel'>;
}
