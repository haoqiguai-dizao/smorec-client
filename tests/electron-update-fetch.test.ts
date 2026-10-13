import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

test('Electron manual redirect returns location without following; final stream forbids redirects', async () => {
  const requests: Request[] = [], fetched: { url: string; init: RequestInit }[] = [];
  class Request extends EventEmitter {
    aborted = false;
    abort() { this.aborted = true; this.emit('error', new Error('Redirect was cancelled')); }
    end() {}
  }
  const net = {
    request() { const request = new Request(); requests.push(request); return request; },
    fetch: async (url: string, init: RequestInit) => { fetched.push({ url, init }); return new Response('signed ZIP bytes'); },
  };
  const bundle = await build({ entryPoints: ['electron/services/updates/electron-fetch.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['electron'] });
  const module = { exports: {} as { electronFetch: typeof fetch } };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(() => ({ net }), module, module.exports);
  const fetcher = module.exports.electronFetch;
  const redirected = fetcher('https://updates.test/artifact', { redirect: 'manual', credentials: 'omit' });
  requests[0].emit('redirect', 302, 'GET', 'https://cos.test/signed.zip');
  const response = await redirected;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://cos.test/signed.zip');
  assert.equal(fetched.length, 0);
  assert.equal(requests[0].aborted, true);
  const download = fetcher('https://cos.test/signed.zip', { redirect: 'manual', credentials: 'omit' });
  requests[1].emit('response', {});
  assert.equal(await (await download).text(), 'signed ZIP bytes');
  assert.equal(fetched[0].init.redirect, 'error');
  assert.equal(fetched[0].init.credentials, 'omit');
  const controller = new AbortController();
  const cancelled = fetcher('https://cos.test/signed.zip', { redirect: 'manual', signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, /取消/);
  assert.equal(requests[2].aborted, true);
});
