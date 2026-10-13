import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, session } from 'electron';
import type { TLSSocket } from 'node:tls';
import { createServer } from 'node:net';
import { resolveSystemStreamProxy } from '../electron/services/streaming/system-proxy';
import { openStreamTransport } from '../electron/services/streaming/transport-socket';
import { readSocketBytes } from '../electron/services/streaming/proxy-handshake';
import { listenOwnedServer, ownedStreamProxy } from './stream-proxy-fixture';

const directory = process.env.XIAOLU_STREAM_PROXY_VERIFICATION!;
app.setPath('userData', path.join(directory, 'profile'));
void app.whenReady().then(async () => {
  const results: Record<string, unknown>[] = [];
  try {
    if (process.env.XIAOLU_VERIFY_EXISTING_X_PROXY === '1') {
      const server = 'rtmps://ca.pscp.tv:443/x';
      const routes = await resolveSystemStreamProxy(server);
      assert.ok(routes.some(route => route.kind !== 'direct'), 'Existing system proxy must be discovered');
      const socket = await openStreamTransport(server, routes, new AbortController().signal) as TLSSocket;
      assert.equal(socket.authorized, true); socket.destroy();
      results.push({ case: 'existing-system-proxy-to-X', routeKinds: routes.map(route => route.kind), certificateVerified: true,
        streamCredentialsRead: false, audioVideoSent: false });
    } else {
      const target = createServer(socket => { socket.on('error', () => {}); socket.write('ready'); });
      const targetPort = await listenOwnedServer(target), http = await ownedStreamProxy('http', targetPort), socks = await ownedStreamProxy('socks5', targetPort);
      try {
        for (const [kind, port] of [['http', http.port], ['socks5', socks.port]] as const) {
          await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `${kind}://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
          const routes = await resolveSystemStreamProxy(`rtmp://owned-unresolvable.invalid:${targetPort}/secret?token=owned`);
          assert.equal(routes[0].kind, kind);
          const socket = await openStreamTransport(`rtmp://owned-unresolvable.invalid:${targetPort}`, routes, new AbortController().signal);
          assert.equal((await readSocketBytes(socket, 5)).toString(), 'ready'); socket.destroy();
          results.push({ case: kind, hostnameDelegatedToProxy: true, routeKinds: routes.map(route => route.kind) });
        }
        await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${http.port}`, proxyBypassRules: 'bypass-owned.invalid' });
        assert.deepEqual(await resolveSystemStreamProxy('rtmp://bypass-owned.invalid/live'), [{ kind: 'direct' }]);
        await session.defaultSession.setProxy({ mode: 'direct' });
        assert.deepEqual(await resolveSystemStreamProxy('rtmps://owned-unresolvable.invalid/live'), [{ kind: 'direct' }]);
        results.push({ case: 'proxy-switch-and-bypass', result: 'PASS' });
      } finally {
        await http.close(); await socks.close(); await new Promise<void>(resolve => target.close(() => resolve()));
      }
    }
    const report = { result: 'PASS', electron: process.versions.electron, node: process.versions.node, windowsCreated: 0, results };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); app.exit(0);
  } catch (error) {
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ result: 'FAIL', error: String(error), results }, null, 2));
    console.error(error); app.exit(1);
  }
});
