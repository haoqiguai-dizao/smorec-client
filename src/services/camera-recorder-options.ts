import { cameraVideoBitrate } from './camera-quality';

// Both containers are verified with complete decode, stream-copy remux and interrupted-file recovery.
// isTypeSupported selects a usable format; it does not prove a hardware encoder on every machine.
//
// H.264/MP4 is preferred on every platform, external Mac cameras included. Only the platform
// hardware encoder keeps up with a high-resolution camera while the screen is also being captured;
// VP8 is software-only on every desktop platform and measurably backlogs. A same-camera A/B on this
// machine measured VP8 at 15.92 FPS against H.264 at 29.98 FPS, and a 3840x2160 external camera on
// the software path stopped emitting frames after 7.6 s of a 17 s recording. VP8 therefore stays
// only as the fallback for a camera whose driver does not offer MP4/avc1 at all.
const CAMERA_CONTAINER_PREFERENCE = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8'] as const;

export function cameraRecorderOptions(settings: Pick<MediaTrackSettings, 'width' | 'height' | 'frameRate'>,
  supported: (mimeType: string) => boolean = type => MediaRecorder.isTypeSupported(type)):
  MediaRecorderOptions & { videoKeyFrameIntervalDuration: number } {
  const mimeType = CAMERA_CONTAINER_PREFERENCE.find(supported);
  if (!mimeType) throw new Error('当前系统不支持摄像头视频编码');
  // The W3C key-frame hint bounds MP4 fragment latency; a timeslice alone does not force a key frame.
  return { mimeType, videoBitsPerSecond: cameraVideoBitrate(settings), videoKeyFrameIntervalDuration: 1000 };
}
