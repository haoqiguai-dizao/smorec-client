import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPreviewEncoding, validCameraPreviewViewport } from '../shared/camera-preview';
import { parsePreviewSignal } from '../electron/services/recording-overlay/validation';
import { CameraPreviewSender } from '../src/services/camera-preview-sender';
import type { CameraPreviewMessage, CameraRecordingApi } from '../shared/types';

const viewport = { width: 256, height: 256, density: 1.5, visible: true, revision: 1 };
const source = { width: 1920, height: 1080, frameRate: 30 };
const sessionId = 'c6e224bc-551e-4b04-93d8-6b0c755d504e';

test('RTC cover demand stays within the preview budget independently of the archive', () => {
  const small = cameraPreviewEncoding(source, viewport);
  assert.ok(1920 / small.scaleResolutionDownBy >= 683);
  assert.ok(1080 / small.scaleResolutionDownBy >= 384);
  assert.ok(1920 / small.scaleResolutionDownBy < 683 + 32, 'Both even dimensions require one 32×18 aspect unit');
  assert.ok(small.maxBitrate < 1_100_000);
  const presenter = cameraPreviewEncoding(source, { ...viewport, width: 960, height: 540, density: 2 });
  assert.ok(Math.abs(presenter.scaleResolutionDownBy - 1.5) < 1e-6);
  assert.equal(presenter.maxBitrate, 3_594_240);
  assert.equal(cameraPreviewEncoding(source, { ...viewport, visible: false }).active, false);
  assert.equal(cameraPreviewEncoding(source, { ...viewport, width: 0 }).active, false);
  assert.deepEqual(source, { width: 1920, height: 1080, frameRate: 30 });
});

test('viewport messages are bounded, normalized, directional and session bound', () => {
  const message = { sessionId, signal: { type: 'viewport', viewport: { ...viewport, extra: 'discarded' } } };
  assert.deepEqual(parsePreviewSignal(message, sessionId, 'camera').signal.viewport, viewport);
  assert.throws(() => parsePreviewSignal(message, sessionId, 'host'), /方向/);
  assert.throws(() => parsePreviewSignal(message, 'c6e224bc-551e-4b04-93d8-6b0c755d504f', 'camera'), /过期/);
  for (const patch of [{ width: NaN }, { width: 8193 }, { width: -1 }, { height: Infinity },
    { density: 0 }, { density: 9 }, { visible: 1 }, { revision: 0 }, { revision: 1.5 }, { revision: 0x80000000 }]) {
    assert.equal(validCameraPreviewViewport({ ...viewport, ...patch }), false);
    assert.throws(() => parsePreviewSignal({ sessionId, signal: { type: 'viewport', viewport: { ...viewport, ...patch } } }, sessionId, 'camera'));
  }
});

test('a viewport replay after offer recovers early delivery; ordered updates reject stale session and revision', async () => {
  let requested!: (id: string) => void, incoming!: (value: CameraPreviewMessage) => void;
  let unblock: (() => void) | undefined;
  const peers: FakePeer[] = [];
  class FakePeer {
    closed = false;
    applied: RTCRtpSendParameters[] = [];
    initial?: RTCRtpTransceiverInit;
    parameters = { encodings: [{}] } as RTCRtpSendParameters;
    constructor() { peers.push(this); }
    addTransceiver(_track: MediaStreamTrack, init: RTCRtpTransceiverInit) {
      this.initial = init;
      return { sender: { getParameters: () => structuredClone(this.parameters), setParameters: async (value: RTCRtpSendParameters) => {
        if (unblock) throw new Error('Concurrent setParameters');
        if (value.encodings[0].active && this.applied.length === 0) await new Promise<void>(resolve => { unblock = resolve; });
        this.parameters = structuredClone(value); this.applied.push(structuredClone(value));
      } } };
    }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async addIceCandidate() {}
    close() { this.closed = true; }
  }
  const original = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection;
  const track = { getSettings: () => source, stop: () => assert.fail('Source track must never stop') };
  const api = { onCameraPreviewRequest: (callback: typeof requested) => { requested = callback; return () => {}; },
    onCameraPreviewSignal: (callback: typeof incoming) => { incoming = callback; return () => {}; }, cameraPreviewSignal: async () => {} } as unknown as CameraRecordingApi;
  const sender = new CameraPreviewSender(api, { getVideoTracks: () => [track] } as unknown as MediaStream);
  const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  const send = (id: string, revision: number, visible: boolean) => incoming({ sessionId: id,
    signal: { type: 'viewport', viewport: { ...viewport, revision, visible } } });
  try {
    send('first', 1, true); // It can arrive before the main process's deferred preview request.
    requested('first'); await flush();
    assert.equal(peers[0].initial?.sendEncodings?.[0].active, false);
    assert.equal(peers[0].applied.length, 0, 'An early viewport must not invent a peer or change its initial state');
    send('first', 2, true); await flush(); // Receiver replays after answering the offer, with no resize.
    assert.ok(unblock, 'First parameter update must still be pending');
    send('first', 3, false); send('first', 2, true);
    const release = unblock!; unblock = undefined; release(); await flush();
    assert.equal(peers[0].parameters.encodings[0].active, false);
    requested('second'); await flush();
    assert.equal(peers[0].closed, false, 'Whiteboard and floating preview share the source without replacing each other');
    incoming({ sessionId: 'first', signal: { type: 'close' } }); await flush();
    send('first', 99, true); send('second', 1, false); await flush();
    assert.equal(peers[0].closed, true);
    assert.equal(peers[1].parameters.encodings[0].active, false);
    send('second', 2, true); await flush();
    assert.equal(peers[1].parameters.encodings[0].active, true);
    assert.equal(peers[1].applied.length, 2);
  } finally { sender.dispose(); globalThis.RTCPeerConnection = original; }
});
