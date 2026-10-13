import { net } from 'electron';

/** Chromium net.fetch rejects manual redirects instead of returning their headers.
 * Probe without following, then stream a nonredirect response with net.fetch.
 * This retains system proxy support and the downloader's per-hop HTTPS checks.
 */
async function redirectResponse(url: string, signal?: AbortSignal | null): Promise<Response | undefined> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    let settled = false;
    const finish = (response?: Response, error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(response);
      request.abort();
    };
    const aborted = () => finish(undefined, new Error('更新下载已取消'));
    signal?.addEventListener('abort', aborted, { once: true });
    request.on('redirect', (status, _method, location) => finish(new Response(null, { status, headers: { location } })));
    request.on('response', () => finish());
    request.on('error', () => finish(undefined, new Error('更新下载连接失败')));
    request.on('login', (_info, callback) => { callback(); finish(undefined, new Error('更新下载不接受身份验证')); });
    request.end();
  });
}
export const electronFetch: typeof fetch = async (input, init) => {
  const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
  if (init?.redirect !== 'manual') return net.fetch(url, init);
  if (init.method && init.method !== 'GET') throw new Error('Manual redirect adapter only accepts GET');
  const redirect = await redirectResponse(url, init.signal);
  if (redirect) return redirect;
  // If the endpoint changes between the probe and stream, reject and retry later.
  return net.fetch(url, { ...init, redirect: 'error' });
};
