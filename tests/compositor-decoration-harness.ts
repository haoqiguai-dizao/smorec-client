import { renderFrame } from '../src/services/compositor';
import { disposeCompositionDecoration } from '../src/services/compositor-decoration';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';

/** Compare real canvas pixels against the pre-cache compositor, repeatedly reusing the current context. */
export function decorationAudit(baseline: typeof renderFrame) {
  const canvas = () => { const result = document.createElement('canvas'); result.width = 640; result.height = 360; return result; };
  const screen = canvas(), image = canvas(), otherImage = canvas(), previous = canvas(), current = canvas();
  screen.getContext('2d')!.fillStyle = '#2563eb'; screen.getContext('2d')!.fillRect(0, 0, 640, 360);
  image.getContext('2d')!.fillStyle = '#c02b8a'; image.getContext('2d')!.fillRect(0, 0, 640, 360);
  otherImage.getContext('2d')!.fillStyle = '#20bf66'; otherImage.getContext('2d')!.fillRect(0, 0, 640, 360);
  const before = previous.getContext('2d', { alpha: false })!, after = current.getContext('2d', { alpha: false })!;
  const project: Project = { id: 'decoration-pixels', name: 'Decoration', createdAt: '', duration: 4, width: 640, height: 360,
    fps: 30, clips: [{ id: 'whole', start: 0, end: 4 }], media: { screen: '' }, zooms: [], cursor: [],
    audio: { system: 0, microphone: 0 }, style: { ...DEFAULT_STYLE, padding: 60, radius: 24, shadow: 50 } };
  const cases: { name: string; update?: () => void; image?: CanvasImageSource }[] = [
    { name: 'initial' }, { name: 'cached' },
    { name: 'style', update: () => { project.style = { ...project.style, padding: 90, radius: 70, shadow: 80, background: 'ink' }; } },
    { name: 'source-aspect', update: () => { project.width = 360; project.height = 640; } },
    { name: 'resize', update: () => { previous.width = current.width = 480; previous.height = current.height = 270; } },
    { name: 'hidden', update: () => { project.compositions = [{ id: 'local', start: 0, end: 4, screen: 'hidden' }]; } },
    { name: 'missing-image', update: () => { project.compositions = [{ id: 'local', start: 0, end: 4, screen: 'background', background: 'asset:missing' }]; } },
    { name: 'loaded-image', image }, { name: 'cached-image', image }, { name: 'changed-image', image: otherImage },
    { name: 'preset', update: () => { project.compositions = [{ id: 'local', start: 0, end: 4, screen: 'background', background: 'ink' }]; } },
    { name: 'restored-screen', update: () => { project.compositions = []; } },
    { name: 'disposed', update: () => disposeCompositionDecoration(after) },
  ];
  try {
    return cases.map(item => {
      item.update?.();
      baseline(before, screen, project, 0, previous.width, previous.height, undefined, 'preview', item.image);
      renderFrame(after, screen, project, 0, current.width, current.height, undefined, 'preview', item.image);
      const a = before.getImageData(0, 0, previous.width, previous.height).data;
      const b = after.getImageData(0, 0, current.width, current.height).data;
      let maxDelta = 0, total = 0;
      for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); total += delta; maxDelta = Math.max(maxDelta, delta); }
      return { name: item.name, maxDelta, meanDelta: total / a.length };
    });
  } finally { disposeCompositionDecoration(after); }
}
