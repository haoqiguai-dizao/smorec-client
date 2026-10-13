import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Classic worker: MediaPipe's WASM bootstrap uses importScripts. Everything stays offline.
let detector: Promise<FaceLandmarker> | undefined;
let mode: 'IMAGE' | 'VIDEO' = 'IMAGE';
let generation: number | undefined;
let timestamp = -Infinity;
self.onmessage = async (event: MessageEvent<{ id: number; bitmap: ImageBitmap; base: string;
  video?: { timestamp: number; generation: number } }>) => {
  const { id, bitmap, base, video } = event.data;
  try {
    // A new source/seek must not inherit the video graph's tracking history.
    if (detector && video && (generation !== video.generation || video.timestamp <= timestamp)) {
      (await detector).close(); detector = undefined;
    }
    const nextMode = video ? 'VIDEO' : 'IMAGE';
    if (!detector) {
      mode = nextMode;
      detector = (async () => FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(base + 'runtime'), {
        baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate: 'CPU' },
        runningMode: nextMode, numFaces: 1, minFaceDetectionConfidence: 0.65, minFacePresenceConfidence: 0.65,
        minTrackingConfidence: 0.5,
      }))();
    }
    const task = await detector;
    // setOptions also covers reuse between preview and exact-frame export preparation.
    if (mode !== nextMode) await task.setOptions({ runningMode: nextMode });
    mode = nextMode; generation = video?.generation; timestamp = video?.timestamp ?? -Infinity;
    const result = video ? task.detectForVideo(bitmap, video.timestamp) : task.detect(bitmap);
    self.postMessage({ id, points: result.faceLandmarks[0] ?? [] });
  } catch (error) {
    detector = undefined;
    self.postMessage({ id, error: error instanceof Error ? error.message : '人脸模型加载失败' });
  } finally { bitmap.close(); }
};
