/** Retry only a constructor/start exception that happened before any observable recording event. */
export function startCameraMediaRecorder(stream: MediaStream, options: MediaRecorderOptions,
  bind: (recorder: MediaRecorder) => void): MediaRecorder {
  const candidates = [options];
  const fallback = options.mimeType === 'video/mp4;codecs=avc1' ? 'video/webm;codecs=vp8' : 'video/mp4;codecs=avc1';
  if (MediaRecorder.isTypeSupported(fallback)) {
    candidates.push({ ...options, mimeType: fallback });
  }
  for (let index = 0; index < candidates.length; index++) {
    let recorder: MediaRecorder | undefined, observed = false;
    const mark = () => { observed = true; };
    try {
      recorder = new MediaRecorder(stream, candidates[index]);
      for (const event of ['start', 'dataavailable', 'error']) recorder.addEventListener(event, mark);
      bind(recorder); recorder.start(250); return recorder;
    } catch (error) {
      if (observed || (recorder && recorder.state !== 'inactive') || index === candidates.length - 1) throw error;
    } finally {
      if (recorder) for (const event of ['start', 'dataavailable', 'error']) recorder.removeEventListener(event, mark);
    }
  }
  throw new Error('摄像头启动失败');
}
