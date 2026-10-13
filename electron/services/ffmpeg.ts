import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cancelPcmDecoders } from './audio-pcm-process';

const mediaProcesses = new Set<ChildProcess>();
export function disposeMediaProcesses(): void { cancelPcmDecoders(); for (const process of mediaProcesses) process.kill(); mediaProcesses.clear(); }

export function ffmpegPath(): string {
  const packaged = path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dependency = app.isPackaged
    ? path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', name)
    : path.join(path.dirname(createRequire(path.join(app.getAppPath(), 'package.json')).resolve('ffmpeg-static/package.json')), name);
  const unpacked = dependency.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const executable = app.isPackaged ? (existsSync(packaged) ? packaged : unpacked) : (process.env.FFMPEG_BIN || dependency);
  if (!executable || !existsSync(executable)) throw new Error('找不到 FFmpeg，请重新安装应用依赖');
  return executable;
}
export function ffmpegAvailable(): boolean { try { ffmpegPath(); return true; } catch { return false; } }
export async function probeMedia(file: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean; browserCompatible: boolean }> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    mediaProcesses.add(process);
    let output = '';
    const timer = setTimeout(() => { process.kill(); reject(new Error('读取视频信息超时')); }, 20_000);
    process.stderr.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-30000); });
    process.once('error', (error) => { clearTimeout(timer); reject(error); });
    process.once('close', () => {
      mediaProcesses.delete(process);
      clearTimeout(timer);
      const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
      const dimensions = /Video:.*?[, ](\d{2,5})x(\d{2,5})(?= |\[|,)/.exec(output);
      if (!duration || !dimensions) { reject(new Error('无法读取视频时长或尺寸，请选择有效的视频文件')); return; }
      const hasAudio = /Stream .*Audio:/.test(output);
      const extension = path.extname(file).toLowerCase();
      const mp4 = ['.mp4', '.m4v'].includes(extension) && /Video: h264\b/.test(output)
        && /Video:.*\byuv420p\b/.test(output) && (!hasAudio || /Audio: (aac|mp3)\b/.test(output));
      const webm = extension === '.webm' && /Video: (vp8|vp9)\b/.test(output) && (!hasAudio || /Audio: (opus|vorbis)\b/.test(output));
      resolve({ duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
        width: Number(dimensions[1]), height: Number(dimensions[2]), hasAudio, browserCompatible: mp4 || webm });
    });
  });
}
export async function normalizeMedia(source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', destination],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    mediaProcesses.add(process);
    let error = '';
    process.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-6000); });
    process.once('error', reject);
    process.once('close', (code) => {
      mediaProcesses.delete(process);
      if (code === 0) resolve(); else reject(new Error(`视频转码失败：${error || '进程已结束'}`));
    });
  });
}
