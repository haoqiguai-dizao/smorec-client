export type StreamProxy = { kind: 'direct' } | { kind: 'http' | 'https' | 'socks4' | 'socks5'; host: string; port: number };
export type StreamProxyResolver = (server: string) => Promise<StreamProxy[]>;

export class StreamProxyError extends Error {
  constructor(readonly kind: 'auth' | 'connect' | 'unsupported' | 'configuration') {
    super(`system proxy ${kind} failed`);
  }
}

/** PAC receives only the platform origin, never a stream key, query or URL credentials. */
export function streamProxyURL(server: string): string {
  const url = new URL(server);
  const port = url.port || (url.protocol === 'rtmps:' ? '443' : '1935');
  return `${url.protocol === 'rtmps:' ? 'https:' : 'http:'}//${url.hostname}:${port}/`;
}

/** Preserve PAC ordering; direct fallback is allowed only when the resolver says DIRECT. */
export function parseStreamProxies(value: string): StreamProxy[] {
  const routes: StreamProxy[] = [];
  for (const item of value.split(';').map(value => value.trim()).filter(Boolean)) {
    if (item === 'DIRECT') { routes.push({ kind: 'direct' }); continue; }
    const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\S+)$/i.exec(item);
    if (!match) throw new StreamProxyError('unsupported');
    let url: URL;
    try { url = new URL(`http://${match[2]}`); } catch { throw new StreamProxyError('configuration'); }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !/^(?:\[[\da-f:]+\]|[^\s:/]+):\d+$/i.test(match[2])) throw new StreamProxyError('configuration');
    const port = Number(match[2].slice(match[2].lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new StreamProxyError('configuration');
    const type = match[1].toUpperCase();
    routes.push({ kind: type === 'HTTPS' ? 'https' : type === 'SOCKS5' ? 'socks5'
      : type === 'SOCKS' || type === 'SOCKS4' ? 'socks4' : 'http', host: url.hostname.replace(/^\[|\]$/g, ''), port });
  }
  if (!routes.length) throw new StreamProxyError('configuration');
  return routes;
}
