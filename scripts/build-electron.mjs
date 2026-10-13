import { build } from 'esbuild';
await build({
  entryPoints: { 'permission-window-preload': 'electron/permission-window-preload.ts', main: 'electron/entry.ts', 'mac-update-helper': 'electron/mac-update-helper.ts', preload: 'electron/preload.ts', 'export-preload': 'electron/export-preload.ts', 'overlay-preload': 'electron/overlay-preload.ts', 'recorder-preload': 'electron/recorder-preload.ts', 'whiteboard-preload': 'electron/whiteboard-preload.ts', 'region-preload': 'electron/region-preload.ts' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  external: ['electron', 'ffmpeg-static', 'electron-updater'], sourcemap: true,
});
