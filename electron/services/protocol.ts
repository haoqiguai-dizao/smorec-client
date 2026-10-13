import { app, protocol } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { ProjectStore } from './projects';
import { audioCacheManager } from './audio-cache';
import type { AudioCacheLease } from './audio-cache-manager';
import { compressedWaveResponse } from './audio-wave-response';
import { ffmpegPath } from './ffmpeg';
import { audioReadable } from './audio-readable';

protocol.registerSchemesAsPrivileged([{ scheme: 'frameflow', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
} }]);
const mime: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/mp4', '.wav': 'audio/wav',
};
export function installProtocol(projects: ProjectStore, rendererUrl?: string, audioFile?: (token: string) => string,
  boardFile?: (session: string, asset: string) => Promise<string>, audioSignal?: (token: string) => AbortSignal): void {
  protocol.handle('frameflow', async (request) => {
    let lease: AudioCacheLease | undefined;
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const url = new URL(request.url);
      let mediaSignal: AbortSignal = request.signal;
      let file: string;
      if (url.hostname === 'media') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 2) return new Response(null, { status: 404 });
        file = await projects.media(segments[0], segments[1]);
      } else if (url.hostname === 'background') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 2 || url.search || url.hash) return new Response(null, { status: 404 });
        file = await projects.background(segments[0], segments[1]);
      } else if (url.hostname === 'board') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 2 || url.search || url.hash) return new Response(null, { status: 404 });
        file = boardFile ? await boardFile(segments[0], segments[1]).catch(() => projects.boardImage(segments[0], segments[1]))
          : await projects.boardImage(segments[0], segments[1]);
      } else if (url.hostname === 'audio' && audioFile && /^\/[a-f0-9-]{36}$/.test(url.pathname)) {
        file = audioFile(url.pathname.slice(1));
        if (audioSignal) mediaSignal = AbortSignal.any([request.signal, audioSignal(url.pathname.slice(1))]);
        lease = audioCacheManager().lease(); lease.pin(file);
      } else if (url.hostname === 'app') {
        const root = await fs.realpath(path.join(app.getAppPath(), 'dist'));
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        if (pathname.includes('\\') || pathname.includes('\0')) return new Response(null, { status: 403 });
        file = await fs.realpath(path.resolve(root, `.${pathname}`));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, { status: 403 });
      } else return new Response(null, { status: 404 });
      const stat = await fs.stat(file);
      if (!stat.isFile()) return new Response(null, { status: 404 });
      const headers: Record<string, string> = {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size),
        'Access-Control-Allow-Origin': rendererUrl ? new URL(rendererUrl).origin : 'frameflow://app',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff',
      };
      if (url.hostname === 'board') headers['Content-Type'] = 'image/png';
      if (url.hostname === 'audio' && path.extname(file).toLowerCase() === '.wv') {
        const executable = ffmpegPath(), streamLease = lease; lease = undefined;
        return await compressedWaveResponse(file, request, executable, headers, () => streamLease?.release(), mediaSignal);
      }
      if (url.hostname === 'app') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' data: blob: frameflow://background frameflow://board; img-src 'self' data: blob: frameflow://background frameflow://board; media-src 'self' frameflow: blob:; connect-src 'self' frameflow:; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";
      let start = 0;
      let end = stat.size - 1;
      let status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        headers['Content-Length'] = String(end - start + 1);
      }
      if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
      const reader = createReadStream(file, { start, end, signal: mediaSignal }), streamLease = lease;
      reader.once('close', () => streamLease?.release()); lease = undefined;
      const stream = headers['Content-Type'].startsWith('audio/') ? audioReadable(reader) : Readable.toWeb(reader);
      return new Response(stream as ReadableStream<Uint8Array>, { status, headers });
    } catch { return new Response(null, { status: 404 }); }
    finally { lease?.release(); }
  });
}
