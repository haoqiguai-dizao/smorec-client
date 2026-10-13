import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Private same-machine endpoint: a named pipe on Windows, a 0600 Unix socket on Mac. */
export class StreamAudioChannel {
  private server?: Server;
  socket?: Socket;
  private address?: string;
  async open(): Promise<string> {
    const name = 'xiaolu-stream-' + randomUUID();
    const root = `/tmp/smorec-${process.getuid?.()}`;
    if (process.platform === 'darwin') {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const info = await fs.lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077))
        throw new Error('推流音频通道目录权限无效');
    }
    const address = this.address = process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.posix.join(root, name + '.sock');
    const server = this.server = createServer(socket => {
      if (this.socket) { socket.destroy(); return; }
      this.socket = socket;
      socket.on('error', () => socket.destroy());
    });
    server.maxConnections = 1;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', () => this.socket?.destroy());
    if (process.platform === 'darwin') await fs.chmod(address, 0o600);
    return process.platform === 'win32' ? address : 'unix://' + address;
  }
  async close(): Promise<void> {
    this.socket?.destroy(); this.socket = undefined;
    const server = this.server; this.server = undefined;
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (process.platform === 'darwin' && this.address) await fs.rm(this.address, { force: true });
    this.address = undefined;
  }
}
