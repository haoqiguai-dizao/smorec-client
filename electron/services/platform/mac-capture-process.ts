import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { parseMacLaunchReceipt } from './mac-launch-receipt';

/** Launch Services gives the capture app its own privacy identity. Stdio stays private to this session. */
export class MacCaptureProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid?: number;
  killed = false;
  exitCode: number | null = null;
  private server: Server;
  private socket?: Socket;
  private directory: string;
  private timer: ReturnType<typeof setTimeout>;
  private finished = false;
  private connected = false;
  constructor(executable: string, launcher: string, parent: number) {
    super();
    this.directory = mkdtempSync(path.join(tmpdir(), 'xl-'));
    const endpoint = path.join(this.directory, 'rpc');
    const target = path.resolve(executable, '../../..');
    this.server = createServer(socket => {
      if (this.socket || this.finished) { socket.destroy(); return; }
      this.socket = socket; this.server.close();
      socket.on('error', error => this.finish(1, error));
      socket.on('close', () => this.connected ? this.finish(0) : this.finish(1, new Error('录制组件在启动回执前关闭通信')));
      this.connect();
    });
    this.server.once('error', error => this.finish(1, error));
    this.timer = setTimeout(() => { this.finish(1, new Error('录制组件启动超时')); this.kill(); }, 20000);
    this.server.listen(endpoint, () => {
      chmodSync(endpoint, 0o600);
      const child = spawn(launcher, [target, JSON.stringify([`--protocol-socket=${endpoint}`, `--parent-pid=${parent}`])],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FRAMEFLOW_PARENT_PID: String(parent) } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { if (!this.finished) this.stderr.write(chunk); });
      child.once('error', error => this.finish(1, error));
      child.once('exit', code => {
        try {
          if (code !== 0) throw new Error('录制组件启动回执无效');
          const receipt = parseMacLaunchReceipt(output, target);
          this.pid = receipt.pid;
          if (this.finished) this.kill();
          else this.connect();
        } catch (error) { this.finish(1, error instanceof Error ? error : new Error('录制组件启动失败')); }
      });
    });
  }
  private connect() {
    // A one-shot query can reply and exit before LaunchServices returns its PID.
    // Keep commands buffered until both the receipt and private socket are ready.
    if (!this.socket || !this.pid || this.finished || this.connected) return;
    this.connected = true; clearTimeout(this.timer);
    this.stdin.pipe(this.socket); this.socket.pipe(this.stdout);
  }
  kill(): boolean {
    this.killed = true;
    if (this.pid) { try { process.kill(this.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
    this.socket?.destroy(); this.finish(0);
    return true;
  }
  private finish(code: number, error?: Error) {
    if (this.finished) return;
    this.finished = true; clearTimeout(this.timer); this.exitCode = code;
    if (this.server.listening) this.server.close(); this.socket?.destroy();
    this.stdout.end(); this.stderr.end(); this.stdin.destroy();
    rmSync(this.directory, { recursive: true, force: true });
    if (error) this.emit('error', error);
    this.emit('exit', code); this.emit('close', code);
  }
}
