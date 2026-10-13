import { createServer, connect, type Server, type Socket } from 'node:net';
import { readSocketBytes } from '../electron/services/streaming/proxy-handshake';

export interface ProxyRequest { host: string; port: number; header?: string }
export async function listenOwnedServer(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return (server.address() as { port: number }).port;
}

export async function ownedStreamProxy(kind: 'http' | 'socks4' | 'socks5', targetPort: number, reject?: number) {
  const sockets = new Set<Socket>(), requests: ProxyRequest[] = [];
  const pairs = new Set<{ local: Socket; upstream: Socket }>();
  const server = createServer(local => {
    sockets.add(local); local.on('close', () => sockets.delete(local)); local.on('error', () => {});
    void (async () => {
      if (kind === 'http') {
        let header = '';
        while (!header.endsWith('\r\n\r\n') && header.length < 8192) header += (await readSocketBytes(local, 1)).toString();
        const authority = /^CONNECT (\S+) HTTP\/1\.1\r\n/.exec(header)?.[1];
        if (!authority) throw new Error('Invalid owned CONNECT request');
        const split = authority.lastIndexOf(':');
        requests.push({ host: authority.slice(0, split), port: Number(authority.slice(split + 1)), header });
        if (reject) { local.end(`HTTP/1.1 ${reject} Owned refusal\r\n\r\n`); return; }
      } else if (kind === 'socks5') {
        const greeting = await readSocketBytes(local, 3);
        if (!greeting.equals(Buffer.from([5, 1, 0]))) throw new Error('Invalid owned SOCKS5 methods');
        local.write(Buffer.from([5, reject === 407 ? 255 : 0]));
        if (reject === 407) return;
        const head = await readSocketBytes(local, 5);
        if (!head.subarray(0, 4).equals(Buffer.from([5, 1, 0, 3]))) throw new Error('SOCKS5 must carry a hostname');
        const hostname = await readSocketBytes(local, head[4]), port = await readSocketBytes(local, 2);
        requests.push({ host: hostname.toString(), port: port.readUInt16BE() });
        if (reject) { local.end(Buffer.from([5, 5, 0, 1, 127, 0, 0, 1, 0, 0])); return; }
      } else {
        const head = await readSocketBytes(local, 9);
        if (head[0] !== 4 || head[1] !== 1 || !head.subarray(4).equals(Buffer.from([0, 0, 0, 1, 0])))
          throw new Error('SOCKS4a must delegate DNS');
        let host = '', byte: number;
        while ((byte = (await readSocketBytes(local, 1))[0]) !== 0 && host.length < 256) host += String.fromCharCode(byte);
        requests.push({ host, port: head.readUInt16BE(2) });
        if (reject) { local.end(Buffer.from([0, 91, 0, 0, 0, 0, 0, 0])); return; }
      }
      const upstream = connect(targetPort, '127.0.0.1'); sockets.add(upstream);
      const pair = { local, upstream }; pairs.add(pair);
      upstream.on('error', () => local.destroy()); upstream.on('close', () => { sockets.delete(upstream); local.destroy(); });
      local.on('close', () => { pairs.delete(pair); upstream.destroy(); });
      await new Promise<void>((resolve, reject) => { upstream.once('connect', resolve); upstream.once('error', reject); });
      if (kind === 'http') {
        // Fragment the response so the client cannot assume one TCP packet per handshake.
        local.write('HTTP/1.1 200 Connection'); local.write(' established\r\n\r\n');
      } else local.write(kind === 'socks5' ? Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]) : Buffer.from([0, 90, 0, 0, 0, 0, 0, 0]));
      local.pipe(upstream); upstream.pipe(local);
    })().catch(() => local.destroy());
  });
  const port = await listenOwnedServer(server);
  return { port, requests, async pauseForwarding(milliseconds: number) {
    const active = [...pairs];
    for (const { local, upstream } of active) {
      local.unpipe(upstream); upstream.unpipe(local); local.pause(); upstream.pause();
    }
    await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
    for (const { local, upstream } of active) if (!local.destroyed && !upstream.destroyed) {
      local.pipe(upstream); upstream.pipe(local);
    }
  }, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
