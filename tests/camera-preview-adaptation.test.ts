import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraPreviewQuality, PREVIEW_RECOVERY_LIMIT, PREVIEW_STRAIN_LIMIT, cameraPreviewSample } from '../src/services/camera-preview-quality';
import { CAMERA_PREVIEW_TIERS, MAX_CAMERA_PREVIEW_TIER, cameraPreviewEncoding, normalizeCameraPreviewTier } from '../shared/camera-preview';

const viewport = { width: 960, height: 540, density: 2, visible: true, revision: 1 };
const source = { width: 1920, height: 1080, frameRate: 30 };
const steady = { framesPerSecond: 30, qualityLimitationReason: 'none' };
const choppy = { framesPerSecond: 9, qualityLimitationReason: 'none' };

test('a preview that keeps its frame cadence stays at full display detail', () => {
  const quality = new CameraPreviewQuality(30);
  for (let sample = 0; sample < PREVIEW_RECOVERY_LIMIT * 3; sample++) {
    const verdict = quality.observe(steady);
    assert.equal(verdict.changed, false);
    assert.equal(verdict.strained, false);
    assert.equal(quality.tier, 0);
  }
});

test('encoder cpu limits step detail down before frames are dropped', () => {
  const quality = new CameraPreviewQuality(30);
  assert.equal(quality.observe({ framesPerSecond: 30, qualityLimitationReason: 'cpu' }).changed, false);
  const verdict = quality.observe({ framesPerSecond: 30, qualityLimitationReason: 'cpu' });
  assert.equal(verdict.changed, true);
  assert.equal(verdict.reason, 'cpu');
  assert.equal(verdict.tier, 1);
  assert.equal(verdict.previous, 0);
});

test('a picture well under target cadence is strain even when the reason is unknown', () => {
  const quality = new CameraPreviewQuality(30);
  for (let sample = 0; sample < PREVIEW_STRAIN_LIMIT; sample++) {
    const verdict = quality.observe(choppy);
    assert.equal(verdict.strained, true);
    assert.equal(verdict.reason, 'framerate');
  }
  assert.equal(quality.tier, 1);
});

test('recovery needs a sustained healthy run, not a single good sample', () => {
  const quality = new CameraPreviewQuality(30);
  for (let sample = 0; sample < PREVIEW_STRAIN_LIMIT; sample++) quality.observe(choppy);
  assert.equal(quality.tier, 1);
  for (let sample = 0; sample < PREVIEW_RECOVERY_LIMIT - 1; sample++) {
    assert.equal(quality.observe(steady).changed, false);
  }
  assert.equal(quality.observe(steady).tier, 0);
});

test('degradation stops at the lowest tier instead of starving the preview', () => {
  const quality = new CameraPreviewQuality(30);
  for (let sample = 0; sample < PREVIEW_STRAIN_LIMIT * (MAX_CAMERA_PREVIEW_TIER + 4); sample++) quality.observe(choppy);
  assert.equal(quality.tier, MAX_CAMERA_PREVIEW_TIER);
});

test('load tiers reduce bounded preview pixels before lowering cadence', () => {
  let previous = cameraPreviewEncoding(source, viewport, 0);
  assert.ok(Math.abs(previous.scaleResolutionDownBy - 1.5) < 1e-6);
  assert.equal(previous.maxBitrate, 3_594_240);
  for (const tier of [1, 2, 3] as const) {
    const encoded = cameraPreviewEncoding(source, viewport, tier);
    assert.ok(encoded.scaleResolutionDownBy > previous.scaleResolutionDownBy);
    assert.ok(encoded.maxBitrate < previous.maxBitrate);
    assert.ok(encoded.maxFramerate <= previous.maxFramerate);
    assert.ok(encoded.active);
    previous = encoded;
  }
});

test('the lowest tier recovers on its own capped cadence, rather than requiring impossible FPS', () => {
  const quality = new CameraPreviewQuality(30);
  for (let i = 0; i < 6; i++) quality.observe(choppy);
  assert.equal(quality.tier, 3);
  for (const tier of [3, 2, 1] as const) {
    const fps = cameraPreviewEncoding(source, viewport, tier).maxFramerate;
    for (let i = 0; i < PREVIEW_RECOVERY_LIMIT; i++) quality.observe({ framesPerSecond: fps, qualityLimitationReason: 'none' });
    assert.equal(quality.tier, tier - 1);
  }
});

test('missing, inactive and bandwidth-limited reports never manufacture recovery', () => {
  const quality = new CameraPreviewQuality();
  for (let i = 0; i < 2; i++) quality.observe(choppy);
  for (const sample of [{}, { framesPerSecond: NaN }, { framesPerSecond: 0, sourceFrameRate: 0 },
    { framesPerSecond: 24, qualityLimitationReason: 'bandwidth' }]) {
    for (let i = 0; i < PREVIEW_RECOVERY_LIMIT; i++) quality.observe(sample);
    assert.equal(quality.tier, 1);
  }
  for (let i = 0; i < PREVIEW_RECOVERY_LIMIT - 1; i++) quality.observe(steady);
  quality.pause();
  quality.observe(steady);
  assert.equal(quality.tier, 1, 'Hidden time must not count toward recovery');
});

test('a low-rate source does not trigger an encoder overload feedback loop', () => {
  const quality = new CameraPreviewQuality();
  for (let i = 0; i < 12; i++) quality.observe({ framesPerSecond: 12, sourceFrameRate: 12, qualityLimitationReason: 'none' });
  assert.equal(quality.tier, 0);
});

test('encoded frame deltas use real stats time and cannot cross encoder restarts', () => {
  const report = (frames: number, timestamp: number, id = 'v') => new Map([
    ['v', { id, type: 'outbound-rtp', kind: 'video', framesEncoded: frames, timestamp, mediaSourceId: 'source' }],
    ['source', { type: 'media-source', framesPerSecond: 30 }],
  ]) as unknown as RTCStatsReport;
  const first = cameraPreviewSample(report(30, 1000));
  assert.equal(cameraPreviewSample(report(75, 2500), first).framesPerSecond, 30);
  assert.equal(cameraPreviewSample(report(75, 1000), first).framesPerSecond, undefined);
  assert.equal(cameraPreviewSample(report(2, 2500), first).framesPerSecond, undefined);
  assert.equal(cameraPreviewSample(report(75, 2500, 'new'), first).framesPerSecond, undefined);
  assert.equal(first.sourceFrameRate, 30);
});

test('unknown tiers fall back to full detail rather than an unusable budget', () => {
  for (const value of [undefined, -1, 9, '2', Number.NaN]) {
    assert.equal(normalizeCameraPreviewTier(value), 0);
  }
  assert.deepEqual(cameraPreviewEncoding(source, viewport, 0), cameraPreviewEncoding(source, viewport));
  assert.equal(CAMERA_PREVIEW_TIERS[0].scale, 1);
});

test('outbound-rtp is read defensively and audio never masks the video verdict', () => {
  const report = new Map<string, unknown>([
    ['audio', { type: 'outbound-rtp', kind: 'audio', framesPerSecond: 1, qualityLimitationReason: 'cpu' }],
    ['video', { type: 'outbound-rtp', kind: 'video', framesPerSecond: 24, qualityLimitationReason: 'bandwidth' }],
  ]) as unknown as RTCStatsReport;
  const sample = cameraPreviewSample(report);
  assert.equal(sample.framesPerSecond, 24);
  assert.equal(sample.qualityLimitationReason, 'bandwidth');
  assert.deepEqual(cameraPreviewSample(new Map() as unknown as RTCStatsReport), {});
});
