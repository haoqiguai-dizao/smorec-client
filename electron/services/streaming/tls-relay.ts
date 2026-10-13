import { promises as fs } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import type { StreamProfile } from '../../../shared/streaming';
import { openStreamTransport } from './transport-socket';
import { StreamProxyError, type StreamProxy } from './proxy-routing';

export interface RelayTransport { server: string; tcUrl: string }

/** Node owns system-proxy routing and verified TLS; FFmpeg has one private local connection. */
export class StreamTLSRelay {
  private server?: Server;
  private local?: Socket;
  private remote?: Socket;
  private cancellation = new AbortController();
  private closed = false;
  constructor(private profile: StreamProfile, private caFile: string | undefined,
    private failed: (reason: string) => void, private routes: StreamProxy[] = [{ kind: 'direct' }]) {}
  async open(): Promise<RelayTransport> {
    const url = new URL(this.profile.server);
    if (!['rtmp:', 'rtmps:'].includes(url.protocol)) throw new Error('推流地址无效');
    const ca = this.caFile ? await fs.readFile(this.caFile) : undefined;
    const server = this.server = createServer(local => {
      if (this.closed || this.local) { local.destroy(); return; }
      this.local = local;
      server.close(); local.setNoDelay(true);
      local.on('error', () => this.cancellation.abort());
      local.on('close', () => { this.cancellation.abort(); this.remote?.destroy(); });
      void openStreamTransport(this.profile.server, this.routes, this.cancellation.signal, ca).then(remote => {
        if (this.closed || local.destroyed) { remote.destroy(); return; }
        this.remote = remote; remote.setNoDelay(true);
        remote.setTimeout(10000, () => remote.destroy(new Error('stream transport timeout')));
        remote.on('error', error => this.failure(error));
        remote.on('close', () => local.destroy());
        local.pipe(remote); remote.pipe(local);
      }).catch(error => this.failure(error));
    });
    server.maxConnections = 1;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', () => this.failed('RTMPS local transport failed'));
    const port = (server.address() as { port: number }).port;
    const tcUrl = new URL(this.profile.server);
    if (!this.profile.key) tcUrl.pathname = tcUrl.pathname.slice(0, tcUrl.pathname.lastIndexOf('/')) || '/';
    const destination = new URL(this.profile.server);
    destination.protocol = 'rtmp:'; destination.hostname = '127.0.0.1'; destination.port = String(port);
    return { server: destination.toString(), tcUrl: tcUrl.toString().replace(/\/$/, '') };
  }
  private failure(error: NodeJS.ErrnoException): void {
    if (this.closed || this.cancellation.signal.aborted) return;
    const certificate = /CERT|SELF_SIGNED|ISSUER|VERIFY_LEAF|ALTNAME/i.test(error.code || '');
    const reason = error instanceof StreamProxyError ? error.message : certificate
      ? 'RTMPS certificate verification failed' : 'stream transport connection failed';
    this.failed(reason); this.local?.destroy();
  }
  async close(): Promise<void> {
    this.closed = true; this.cancellation.abort(); this.local?.destroy(); this.remote?.destroy();
    const server = this.server; this.server = undefined;
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
