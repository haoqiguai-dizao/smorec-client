import { connect, isIP, type Socket } from 'node:net';
import { connect as connectTLS, type TLSSocket } from 'node:tls';
import { negotiateStreamProxy } from './proxy-handshake';
import { StreamProxyError, type StreamProxy } from './proxy-routing';

function waitConnected(socket: Socket | TLSSocket, secure = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const event = secure ? 'secureConnect' : 'connect';
    const cleanup = () => { socket.off(event, ready); socket.off('error', failed); socket.off('close', closed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const closed = () => failed(new Error('stream transport connection closed'));
    socket.once(event, ready); socket.once('error', failed); socket.once('close', closed);
    if (socket.destroyed) closed();
  });
}

function verifiedTLS(socket: Socket, hostname: string, ca?: Buffer): TLSSocket {
  return connectTLS({ socket, host: hostname, servername: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true,
    ...(ca ? { ca } : {}) });
}

async function openRoute(url: URL, route: StreamProxy, signal: AbortSignal, ca?: Buffer): Promise<Socket> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const targetPort = Number(url.port || (url.protocol === 'rtmps:' ? 443 : 1935));
  let socket: Socket = connect({ host: route.kind === 'direct' ? hostname : route.host,
    port: route.kind === 'direct' ? targetPort : route.port });
  // Keep gap errors handled while moving between TCP, proxy and TLS handshakes.
  socket.on('error', () => {});
  const aborted = () => socket.destroy(new Error('stream transport cancelled'));
  const timeout = setTimeout(() => socket.destroy(new Error('stream transport timeout')), 10000);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    if (signal.aborted) aborted();
    await waitConnected(socket); socket.setNoDelay(true);
    if (route.kind !== 'direct') {
      if (route.kind === 'https') {
        socket = verifiedTLS(socket, route.host); socket.on('error', () => {});
        await waitConnected(socket, true);
      }
      await negotiateStreamProxy(socket, route, url);
    }
    if (url.protocol === 'rtmps:') {
      socket = verifiedTLS(socket, hostname, ca); socket.on('error', () => {});
      await waitConnected(socket, true);
    }
    if (signal.aborted) throw new Error('stream transport cancelled');
    return socket;
  } catch (error) {
    socket.destroy();
    // Proxy refusal cannot be mistaken for the streaming platform rejecting its key.
    if (route.kind !== 'direct' && !(error instanceof StreamProxyError)
      && !/CERT|SELF_SIGNED|ISSUER|VERIFY_LEAF|ALTNAME/i.test((error as NodeJS.ErrnoException).code || ''))
      throw new StreamProxyError('connect');
    throw error;
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', aborted);
  }
}

export async function openStreamTransport(server: string, routes: StreamProxy[], signal: AbortSignal, ca?: Buffer): Promise<Socket> {
  if (!routes.length) throw new StreamProxyError('configuration');
  let failure: unknown;
  for (const route of routes) {
    if (signal.aborted) throw new Error('stream transport cancelled');
    try { return await openRoute(new URL(server), route, signal, ca); }
    catch (error) {
      failure = error;
      if (error instanceof StreamProxyError && error.kind !== 'connect') throw error;
      if (/CERT|SELF_SIGNED|ISSUER|VERIFY_LEAF|ALTNAME/i.test((error as NodeJS.ErrnoException).code || '')) throw error;
    }
  }
  throw failure;
}
