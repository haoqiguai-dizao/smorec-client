import assert from 'node:assert/strict';
import test from 'node:test';
import { FaceContinuity } from '../src/services/camera-effects/face/continuity';

const points = [{ x: .5, y: .5 }];
test('short missed/late detections preserve whitening; sustained loss fades and expires', () => {
  const face = new FaceContinuity();
  face.frame('camera', 1); face.accept(points, 1, face.generation, 0); face.read(0);
  const strengths: number[] = [];
  for (let ms = 33; ms <= 550; ms += 33) {
    face.frame('camera', 1 + ms / 1000);
    face.accept([], 1 + ms / 1000, face.generation, ms);
    face.read(ms); strengths.push(face.strength);
  }
  assert.equal(strengths[3], 1, 'A brief detection miss must not switch whitening off');
  assert.equal(strengths.at(-1), 0, 'Do not keep a stale face indefinitely');
  assert.ok(strengths.some(value => value > 0 && value < 1));
  for (let i = 1; i < strengths.length; i++) assert.ok(strengths[i - 1] - strengths[i] < .26);
  face.frame('camera', 1.57); face.accept(points, 1.57, face.generation, 570); face.read(570);
  assert.ok(face.strength > 0 && face.strength < .5, 'Reacquisition fades in instead of flashing to full strength');
  face.frame('camera', 1.65); face.accept(points, 1.65, face.generation, 650); face.read(650);
  face.frame('camera', 1.7); face.accept(points, 1.7, face.generation, 700); face.read(700);
  assert.equal(face.strength, 1);
});

test('normal inference latency and one missed reply do not pulse color; old warps still expire', () => {
  const face = new FaceContinuity();
  face.frame('camera', 1.12); face.accept(points, 1, face.generation, 120);
  assert.deepEqual(face.read(120), points);
  face.frame('camera', 1.35); face.read(350);
  assert.equal(face.strength, 1, 'Inference age must not consume the color continuity lease');
  assert.ok(face.geometryStrength < .1, 'Stale geometry fades earlier than color');
  face.frame('camera', 1.4); face.read(400);
  assert.equal(face.geometryStrength, 0);
  face.frame('camera', 1.61); assert.deepEqual(face.read(610), []);
});

test('seek, source replacement and long discontinuities discard late in-flight geometry', () => {
  for (const [token, time] of [['other', 1.03], ['camera', .9], ['camera', 2]] as const) {
    const face = new FaceContinuity();
    face.frame('camera', 1); const old = face.generation;
    face.accept(points, 1, old, 0); face.read(0);
    face.frame(token, time); face.accept(points, 1, old, 40);
    assert.deepEqual(face.read(40), []);
    assert.equal(face.strength, 0);
  }
});

test('exact paused frames stay stable while advancing wall-clock stale frames expire', () => {
  const face = new FaceContinuity();
  face.frame('camera', 1); face.accept(points, 1, face.generation, 0);
  assert.deepEqual(face.read(6000), points);
  face.frame('camera', 1.01);
  assert.deepEqual(face.read(6033), []);
});
