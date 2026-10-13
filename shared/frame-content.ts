import { webcamStyleAt } from './camera-layout';
import { cameraModeAt } from './camera-modes';
import { compositionAt } from './composition';
import type { Project } from './types';
import { demoCapturedAt, demoCameraEmbeddedAt } from './demo';
import { boardCoversRecordedCamera } from './whiteboard/camera';

/** Shared render/edit visibility; an optional composition evaluates an uncommitted local layout. */
export function frameContentAt(project: Project, time: number, composition = compositionAt(project.compositions, time)) {
  const embeddedInterface = demoCapturedAt(project.demoCapture, time);
  const presenter = !embeddedInterface && !composition && cameraModeAt(project.camera, time) === 'presenter';
  const camera = project.camera;
  const screen = !presenter && (!composition || composition.screen === 'recording');
  const independentCamera = !demoCameraEmbeddedAt(project.demoCapture, time) || !screen || boardCoversRecordedCamera(project, time);
  const recordedCameraVisible = !independentCamera && camera && webcamStyleAt({ ...camera, enabled: true, useRecordedLayout: true }, time).enabled;
  return {
    composition,
    presenter,
    embeddedInterface,
    cameraEmbedded: !independentCamera,
    // Old pixels cannot be separated: keep the full screen until the original person is covered.
    screenZoomLocked: !independentCamera && !!recordedCameraVisible,
    screen,
    // Presenter ignores recorded PiP visibility; local compositions can override the master switch.
    camera: independentCamera && !!camera && (presenter ? camera.enabled
      : composition?.camera?.visible ?? webcamStyleAt(camera, time).enabled),
  };
}
