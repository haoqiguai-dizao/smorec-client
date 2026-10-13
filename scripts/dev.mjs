import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await import('./build-electron.mjs');
const server = await createServer();
await server.listen();
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: false });
let closing = false;
async function close() {
  if (closing) return;
  closing = true; child.kill(); await server.close();
}
child.on('exit', async (code) => { await close(); process.exit(code ?? 0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
