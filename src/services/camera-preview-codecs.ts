/** Prefer the hardware-friendly format without deleting browser fallback/RTX/FEC capabilities. */
export function preferCameraPreviewCodec(transceiver: RTCRtpTransceiver): void {
  if (!transceiver.setCodecPreferences || typeof RTCRtpReceiver === 'undefined') return;
  const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs;
  if (!codecs?.some(codec => codec.mimeType.toLowerCase() === 'video/h264')) return;
  const rank = (codec: RTCRtpCodec) => codec.mimeType.toLowerCase() === 'video/h264' ? 0 : 1;
  try { transceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b))); }
  catch { /* Codec preference is optional; retain the browser's interoperable default. */ }
}
