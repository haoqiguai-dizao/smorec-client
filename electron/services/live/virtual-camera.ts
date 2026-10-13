import { app } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { VirtualCameraStatus } from '../../../shared/live-types';
import { VIRTUAL_CAMERA_NAME } from '../../../shared/live-types';

export { VIRTUAL_CAMERA_NAME } from '../../../shared/live-types';
export function virtualCameraExecutable(): string | undefined {
  if (process.platform === 'darwin') return [
    path.join(process.resourcesPath, '..', 'MacOS', 'XiaoLu.CameraBridge'),
    path.join(app.getAppPath(), 'native', 'macos', '.build', 'release', 'XiaoLu.CameraBridge'),
    path.join(app.getAppPath(), 'native', 'macos', '.build', 'debug', 'XiaoLu.CameraBridge'),
  ].find(existsSync);
  return [path.join(process.resourcesPath, 'virtual-camera', 'XiaoLu.CameraBridge.exe'),
    path.join(app.getAppPath(), 'native', 'virtual-camera', 'bin', 'x64', 'XiaoLu.CameraBridge.exe')].find(existsSync);
}
async function command(args: string[]): Promise<Record<string, unknown>> {
  const executable = virtualCameraExecutable();
  if (!executable) throw new Error(process.platform === 'darwin' ? 'Mac 虚拟摄像头组件未构建，请运行 npm run native:mac:build' : '虚拟摄像头组件未构建，请运行 npm run virtual-camera:build');
  return new Promise((resolve, reject) => execFile(executable, args,
    { windowsHide: true, timeout: args[0] === 'install' ? 120_000 : 10_000, maxBuffer: 65536 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr.trim() || error.message)); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '{}')); }
      catch { reject(new Error('虚拟摄像头组件响应无效')); }
    }));
}
export async function virtualCameraStatus(): Promise<VirtualCameraStatus> {
  if (!virtualCameraExecutable()) return { available: false, installed: false, name: VIRTUAL_CAMERA_NAME };
  try {
    const result = await command(['status']);
    return { available: true, installed: result.installed === true && result.compatible === true, name: VIRTUAL_CAMERA_NAME,
      ...(typeof result.installable === 'boolean' ? { installable: result.installable } : {}),
      ...(typeof result.error === 'string' ? { error: result.error } : {}) };
  } catch (error) { return { available: true, installed: false, name: VIRTUAL_CAMERA_NAME, error: String(error) }; }
}
export async function installVirtualCamera(): Promise<VirtualCameraStatus> {
  const result = await command(process.platform === 'darwin' ? ['install'] : ['install', '--elevate']);
  if (result.error) throw new Error(String(result.error));
  if (result.needsRestart) throw new Error('请重新启动 Mac，以完成虚拟摄像头安装');
  const status = await virtualCameraStatus();
  if (!status.installed) throw new Error('虚拟摄像头尚未安装，请完成系统安装确认后重试');
  return status;
}
export class VirtualCameraWriter {
  private child?: ChildProcessWithoutNullStreams;
  private writing = false;
  private stopping = false;
  private ready = false;
  private byteLength = 0;
  private rejectStart?: (error: Error) => void;
  constructor(private failed: (error: Error) => void) {}
  async start(width: number, height: number, fps: number): Promise<void> {
    if (this.child) throw new Error('虚拟摄像头已在运行');
    if (![width, height, fps].every(Number.isSafeInteger) || width < 2 || height < 2 || width > 8192 || height > 8192
      || fps < 1 || fps > 60) throw new Error('虚拟摄像头输出规格无效');
    const executable = virtualCameraExecutable();
    if (!executable) throw new Error('虚拟摄像头组件不存在');
    this.stopping = false; this.ready = false;
    this.byteLength = width * height * 4;
    const child = this.child = spawn(executable, ['stream', '--width', String(width), '--height', String(height), '--fps', String(fps)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    child.stdin.on('error', error => { if (!this.stopping) this.failed(error); });
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const rejectStart = (error: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.rejectStart = undefined; reject(error);
      };
      const timer = setTimeout(() => { rejectStart(new Error('虚拟摄像头启动超时')); child.kill(); }, 5000);
      this.rejectStart = rejectStart;
      lines.on('line', line => {
        try {
          const message = JSON.parse(line);
          if (message.event === 'ready' && !settled) { this.ready = true; settled = true; clearTimeout(timer); this.rejectStart = undefined; resolve(); }
          if (message.event === 'error' || message.error) {
            this.ready = false;
            const error = new Error(String(message.error ?? message.message)); rejectStart(error);
            if (!this.stopping) this.failed(error);
          }
        } catch { /* Native stdout is bounded diagnostic JSON. */ }
      });
      child.on('error', error => { this.ready = false; rejectStart(error); if (!this.stopping) this.failed(error); });
      child.on('exit', code => {
        this.ready = false;
        const error = new Error(`虚拟摄像头已停止 (${code})`);
        rejectStart(error);
        if (!this.stopping) this.failed(error);
      });
    });
  }
  write(value: unknown): Promise<void> {
    if (!(value instanceof ArrayBuffer) || value.byteLength !== this.byteLength) return Promise.reject(new Error('直播输出帧无效'));
    if (this.writing || !this.child || !this.ready || this.stopping) return Promise.reject(new Error('直播输出尚未就绪'));
    this.writing = true;
    const child = this.child;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('虚拟摄像头输出超时')); }, 5000);
      child.stdin.write(Buffer.from(value), error => { clearTimeout(timer); if (error) reject(error); else resolve(); });
    }).finally(() => { this.writing = false; });
  }
  async stop(): Promise<void> {
    this.stopping = true; this.ready = false;
    this.rejectStart?.(new Error('虚拟摄像头启动已取消'));
    const child = this.child; this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once('close', () => { clearTimeout(timer); resolve(); }); child.stdin.end();
    });
  }
}
