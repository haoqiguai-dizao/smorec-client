import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CameraPreviewMessage, RecordingOverlayApi } from '../../shared/types';
import type { CameraPreviewDisplay } from '../../shared/camera-preview';
import { useCameraPreviewViewport } from './useCameraPreviewViewport';
import { preferCameraPreviewCodec } from '../services/camera-preview-codecs';

export function useCameraPreviewReceiver(enabled: boolean, sourceId: string | undefined,
  target: RefObject<HTMLElement | null>, visible: boolean,
  receiver?: Pick<RecordingOverlayApi, 'previewReady' | 'sendPreviewSignal' | 'onPreviewSignal'>, preparing = false) {
  const [received, setReceived] = useState<{ stream: MediaStream; owner: object } | null>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const owner = useMemo(() => ({ enabled, sourceId, attempt }), [enabled, sourceId, attempt]);
  const reconnect = useCallback(() => setAttempt(value => value + 1), []);
  const publishViewport = useRef<(value: CameraPreviewDisplay) => void>(() => {});
  const viewportChanged = useCallback((value: CameraPreviewDisplay) => publishViewport.current(value), []);
  const viewport = useCameraPreviewViewport(target, visible, viewportChanged, preparing);
  useEffect(() => {
    const api = receiver ?? window.recordingOverlay;
    setReceived(null); setError(undefined);
    if (!enabled || !api) return;
    let closed = false, sessionId: string | undefined, revision = 0;
    const publish = (value: CameraPreviewDisplay) => {
      if (!closed && sessionId) void api.sendPreviewSignal({ sessionId,
        signal: { type: 'viewport', viewport: { ...value, revision: ++revision } } }).catch(() => {});
    };
    publishViewport.current = publish;
    let pending: CameraPreviewMessage[] = [], candidates: RTCIceCandidateInit[] = [];
    let receivedTrack = false, queue = Promise.resolve();
    const peer = new RTCPeerConnection({ iceServers: [] });
    const fail = () => { if (!closed) setError('预览已断开'); };
    const timeout = window.setTimeout(() => { if (!receivedTrack) fail(); }, 12000);
    let disconnectTimer: number | undefined;
    peer.ontrack = event => {
      if (closed) return;
      receivedTrack = true; window.clearTimeout(timeout); setError(undefined);
      setReceived({ stream: event.streams[0] ?? new MediaStream([event.track]), owner });
      event.track.onended = fail;
    };
    peer.onicecandidate = event => {
      if (event.candidate && sessionId && !closed) {
        void api.sendPreviewSignal({ sessionId, signal: { type: 'candidate', candidate: event.candidate.toJSON() } }).catch(fail);
      }
    };
    peer.onconnectionstatechange = () => {
      window.clearTimeout(disconnectTimer);
      if (peer.connectionState === 'failed') fail();
      else if (peer.connectionState === 'disconnected') disconnectTimer = window.setTimeout(fail, 2000);
      else if (peer.connectionState === 'connected') setError(undefined);
    };
    const receive = async (message: CameraPreviewMessage) => {
      if (closed || message.sessionId !== sessionId) return;
      const signal = message.signal;
      if (signal.type === 'candidate' && signal.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else candidates.push(signal.candidate);
      } else if (signal.type === 'offer' && signal.sdp) {
        await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        if (closed) return;
        for (const candidate of candidates) await peer.addIceCandidate(candidate);
        candidates = [];
        for (const transceiver of peer.getTransceivers()) preferCameraPreviewCodec(transceiver);
        await peer.setLocalDescription(await peer.createAnswer());
        if (!closed && sessionId) {
          await api.sendPreviewSignal({ sessionId, signal: { type: 'answer', sdp: peer.localDescription?.sdp } });
          // The initial viewport may beat the host's request across renderer processes.
          // An offer proves that sender exists; replay current demand without waiting for a resize.
          publish(viewport.current);
        }
      }
    };
    const schedule = (message: CameraPreviewMessage) => { queue = queue.then(() => receive(message)).catch(fail); };
    const unsubscribe = api.onPreviewSignal(message => {
      if (closed) return;
      if (!sessionId) { if (pending.length < 100) pending.push(message); }
      else schedule(message);
    });
    void api.previewReady().then(session => {
      if (closed) return;
      sessionId = session.sessionId;
      publish(viewport.current);
      for (const message of pending) schedule(message);
      pending = [];
    }).catch(fail);
    return () => {
      if (sessionId) void api.sendPreviewSignal({ sessionId, signal: { type: 'close' } }).catch(() => {});
      if (publishViewport.current === publish) publishViewport.current = () => {};
      closed = true; unsubscribe(); window.clearTimeout(timeout); window.clearTimeout(disconnectTimer);
      peer.ontrack = null; peer.onicecandidate = null; peer.onconnectionstatechange = null;
      peer.close();
    };
  }, [enabled, sourceId, attempt, owner, viewport, receiver]);
  return { stream: enabled && received?.owner === owner ? received.stream : null, error, reconnect };
}
