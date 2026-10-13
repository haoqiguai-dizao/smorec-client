import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LiveFrameClient } from '../electron/services/live/frame-client';
import { liveFrameAddress } from '../electron/services/platform/live-address';

const supported = process.platform === 'win32' || process.platform === 'darwin';
async function channel(withAudio: boolean, reply: (socket: Socket) => void) {
  const name = 'xiaolu-live-' + randomUUID(), address = liveFrameAddress(name);
  if (process.platform === 'darwin') await fs.mkdir(path.dirname(address), { recursive: true, mode: 0o700 });
  const sockets = new Set<Socket>(), server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('data', () => reply(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
  const client = new LiveFrameClient(2, 2, withAudio); await client.connect(name);
  return { client, close: async () => { client.close(); for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (process.platform === 'darwin') await fs.rm(address, { force: true }); } };
}
function packet(audioLength?: number, audioTime = .9): Buffer {
  const header = Buffer.alloc(24); header.writeUInt32LE(0x584c4652); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(2, 8); header.writeUInt32LE(16, 12); header.writeDoubleLE(1, 16);
  const pixels = Buffer.alloc(16, 42);
  if (audioLength === undefined) return Buffer.concat([header, pixels]);
  const audio = Buffer.alloc(16); audio.writeUInt32LE(0x584c4155); audio.writeUInt32LE(audioLength, 4); audio.writeDoubleLE(audioTime, 8);
  return Buffer.concat([header, pixels, audio, Buffer.alloc(Math.min(audioLength, 32))]);
}
test('live PCM framing handles fragmented headers, bodies and empty packets across repeated pulls', { skip: !supported }, async () => {
  let count = 0;
  const fixture = await channel(true, socket => {
    const bytes = packet(count++ === 0 ? 32 : 0);
    for (let offset = 0; offset < bytes.length; offset += 7) socket.write(bytes.subarray(offset, offset + 7));
  });
  try {
    const first = fixture.client.pull(); await assert.rejects(fixture.client.pull(), /上一帧/);
    assert.equal(await first, 1); assert.equal(fixture.client.audioTime, .9); assert.equal(fixture.client.audio?.length, 32);
    assert.ok(fixture.client.pixels.equals(Buffer.alloc(16, 42)));
    assert.equal(await fixture.client.pull(), 1); assert.equal(fixture.client.audio?.length, 0);
  } finally { await fixture.close(); }
});
test('legacy virtual-camera frames remain compatible without PCM', { skip: !supported }, async () => {
  const fixture = await channel(false, socket => socket.write(packet()));
  try { assert.equal(await fixture.client.pull(), 1); assert.equal(fixture.client.audio, undefined); }
  finally { await fixture.close(); }
});
test('live PCM rejects excessive packet allocation and inconsistent clocks', { skip: !supported }, async () => {
  for (const [length, time] of [[48000 * 8, .9], [8, 2], [7, .9], [8, NaN]]) {
    const fixture = await channel(true, socket => socket.write(packet(length, time)));
    try { await assert.rejects(fixture.client.pull(), /直播声音格式无效/); }
    finally { await fixture.close(); }
  }
});
