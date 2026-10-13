import { isIP, type Socket } from 'node:net';
import { StreamProxyError, type StreamProxy } from './proxy-routing';

/** Consume exact handshake bytes, leaving any following stream bytes in the socket. */
export function readSocketBytes(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.off('readable', read); socket.off('error', fail); socket.off('end', closed); socket.off('close', closed); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const closed = () => fail(new StreamProxyError('connect'));
    const read = () => {
      const bytes: Buffer | null = socket.read(length);
      if (bytes) { cleanup(); resolve(bytes); }
      else if (socket.destroyed || socket.readableEnded) closed();
    };
    socket.on('readable', read); socket.once('error', fail); socket.once('end', closed); socket.once('close', closed);
    read();
  });
}

async function httpConnect(socket: Socket, url: URL, port: number): Promise<void> {
  const authority = `${url.hostname}:${port}`;
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  const header: number[] = [];
  while (header.length < 8192) {
    header.push((await readSocketBytes(socket, 1))[0]);
    if (header.length >= 4 && Buffer.from(header.slice(-4)).equals(Buffer.from('\r\n\r\n'))) break;
  }
  const text = Buffer.from(header).toString('latin1');
  const status = /^HTTP\/1\.[01] (\d{3})(?: |\r\n)/.exec(text)?.[1];
  if (status === '407') throw new StreamProxyError('auth');
  if (status !== '200' || !text.endsWith('\r\n\r\n')) throw new StreamProxyError('connect');
}

async function socksConnect(socket: Socket, kind: 'socks4' | 'socks5', host: string, port: number): Promise<void> {
  const hostname = Buffer.from(host);
  if (!hostname.length || hostname.length > 255 || (kind === 'socks4' && isIP(host) === 6)) throw new StreamProxyError('unsupported');
  const targetPort = Buffer.alloc(2); targetPort.writeUInt16BE(port);
  if (kind === 'socks4') {
    // SOCKS4a delegates hostname resolution to the proxy, including when local DNS is unusable.
    socket.write(Buffer.concat([Buffer.from([4, 1]), targetPort, Buffer.from([0, 0, 0, 1, 0]), hostname, Buffer.from([0])]));
    const response = await readSocketBytes(socket, 8);
    if (response[0] !== 0 || response[1] !== 90) throw new StreamProxyError('connect');
    return;
  }
  socket.write(Buffer.from([5, 1, 0]));
  const method = await readSocketBytes(socket, 2);
  if (method[0] !== 5) throw new StreamProxyError('connect');
  if (method[1] !== 0) throw new StreamProxyError('auth');
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, hostname.length]), hostname, targetPort]));
  const response = await readSocketBytes(socket, 4);
  if (response[0] !== 5 || response[2] !== 0 || response[1] !== 0) throw new StreamProxyError('connect');
  const size = response[3] === 1 ? 4 : response[3] === 4 ? 16
    : response[3] === 3 ? (await readSocketBytes(socket, 1))[0] : 0;
  if (!size) throw new StreamProxyError('connect');
  await readSocketBytes(socket, size + 2);
}

export async function negotiateStreamProxy(socket: Socket, proxy: Exclude<StreamProxy, { kind: 'direct' }>, url: URL): Promise<void> {
  const port = Number(url.port || (url.protocol === 'rtmps:' ? 443 : 1935));
  if (proxy.kind === 'http' || proxy.kind === 'https') await httpConnect(socket, url, port);
  else await socksConnect(socket, proxy.kind, url.hostname.replace(/^\[|\]$/g, ''), port);
}
