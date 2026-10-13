import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseStreamProxies, streamProxyURL } from '../electron/services/streaming/proxy-routing';
import { openStreamTransport } from '../electron/services/streaming/transport-socket';
import { readSocketBytes } from '../electron/services/streaming/proxy-handshake';
import { streamFailure } from '../electron/services/streaming/encoding';
import { listenOwnedServer, ownedStreamProxy } from './stream-proxy-fixture';

test('proxy resolution excludes stream credentials and keeps platform origin and protocol port', () => {
  assert.equal(streamProxyURL('rtmps://user:password@example.test/live/sensitive-key?token=secret'), 'https://example.test:443/');
  assert.equal(streamProxyURL('rtmp://example.test/live'), 'http://example.test:1935/');
  assert.equal(streamProxyURL('rtmp://[::1]:80/live'), 'http://[::1]:80/');
});
test('PAC routes retain order, IPv6, explicit DIRECT and SOCKS variants without assuming a fixed proxy port', () => {
  assert.deepEqual(parseStreamProxies('PROXY 127.0.0.1:8181; SOCKS5 [::1]:8182; DIRECT'), [
    { kind: 'http', host: '127.0.0.1', port: 8181 }, { kind: 'socks5', host: '::1', port: 8182 }, { kind: 'direct' },
  ]);
  assert.equal(parseStreamProxies('HTTPS localhost:443')[0].kind, 'https');
  assert.equal(parseStreamProxies('SOCKS localhost:1080')[0].kind, 'socks4');
  for (const invalid of ['', 'QUIC localhost:443', 'PROXY user:password@localhost:8181', 'PROXY localhost:0', 'PROXY localhost:65536', 'PROXY localhost:8181/path'])
    assert.throws(() => parseStreamProxies(invalid), /system proxy/);
});

for (const kind of ['http', 'socks4', 'socks5'] as const) test(`${kind} sends a platform hostname through a real local proxy and transports bidirectional bytes`, async () => {
  const target = createServer(socket => { socket.on('error', () => {}); socket.write('ready'); socket.pipe(socket); });
  const targetPort = await listenOwnedServer(target), proxy = await ownedStreamProxy(kind, targetPort);
  const cancellation = new AbortController();
  const socket = await openStreamTransport(`rtmp://owned-unresolvable.invalid:${targetPort}/live`, [{ kind, host: '127.0.0.1', port: proxy.port }], cancellation.signal);
  try {
    assert.equal((await readSocketBytes(socket, 5)).toString(), 'ready');
    socket.write('owned-payload'); assert.equal((await readSocketBytes(socket, 13)).toString(), 'owned-payload');
    assert.equal(proxy.requests[0].host, 'owned-unresolvable.invalid'); assert.equal(proxy.requests[0].port, targetPort);
    assert.ok(!proxy.requests[0].header?.includes('/live'), 'CONNECT must not disclose a stream path');
  } finally { socket.destroy(); await proxy.close(); await new Promise<void>(resolve => target.close(() => resolve())); }
});

test('proxy authentication refusal does not silently try DIRECT or reach the platform', async () => {
  let accepted = 0;
  const target = createServer(socket => { accepted++; socket.destroy(); });
  const targetPort = await listenOwnedServer(target), proxy = await ownedStreamProxy('http', targetPort, 407);
  try {
    await assert.rejects(openStreamTransport(`rtmp://127.0.0.1:${targetPort}/live`, [
      { kind: 'http', host: '127.0.0.1', port: proxy.port }, { kind: 'direct' },
    ], new AbortController().signal), /system proxy auth/);
    assert.equal(accepted, 0);
    assert.deepEqual(streamFailure('system proxy auth failed'), { message: '系统代理要求身份验证，请先在代理软件中完成验证', retry: false });
  } finally { await proxy.close(); await new Promise<void>(resolve => target.close(() => resolve())); }
});
test('PAC allows failover to another proxy and direct only when DIRECT is explicit', async () => {
  const target = createServer(socket => { socket.on('error', () => {}); socket.write('ready'); });
  const targetPort = await listenOwnedServer(target), refused = await ownedStreamProxy('http', targetPort, 502), working = await ownedStreamProxy('socks5', targetPort);
  const first = { kind: 'http' as const, host: '127.0.0.1', port: refused.port };
  try {
    await assert.rejects(openStreamTransport(`rtmp://127.0.0.1:${targetPort}`, [first], new AbortController().signal), /system proxy connect/);
    for (const last of [{ kind: 'socks5' as const, host: '127.0.0.1', port: working.port }, { kind: 'direct' as const }]) {
      const socket = await openStreamTransport(`rtmp://127.0.0.1:${targetPort}`, [first, last], new AbortController().signal);
      assert.equal((await readSocketBytes(socket, 5)).toString(), 'ready'); socket.destroy();
    }
  } finally { await refused.close(); await working.close(); await new Promise<void>(resolve => target.close(() => resolve())); }
});
test('cancelling a proxy handshake closes the pending connection promptly', async () => {
  const sockets = new Set<import('node:net').Socket>();
  const proxy = createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); socket.resume(); });
  const proxyPort = await listenOwnedServer(proxy), cancellation = new AbortController();
  const pending = openStreamTransport('rtmp://owned-unresolvable.invalid/live', [{ kind: 'http', host: '127.0.0.1', port: proxyPort }], cancellation.signal);
  try {
    await delay(20); cancellation.abort(); await assert.rejects(pending, /system proxy connect|cancelled/);
    await delay(20); assert.equal(sockets.size, 0);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
});
