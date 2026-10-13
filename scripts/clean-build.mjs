import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive the workspace from this script, never from a caller's working directory or arguments.
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
const targets = [];

// Validate every existing target before removing anything. Refuse linked directories, including junctions.
for (const name of ['dist', 'dist-electron']) {
  const target = path.join(root, name);
  let info;
  try { info = await lstat(target); }
  catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refusing to clean a linked or non-directory target: ${target}`);
  const resolved = await realpath(target);
  if (comparable(path.dirname(resolved)) !== comparable(root) || comparable(resolved) !== comparable(target)) {
    throw new Error(`Refusing to clean outside a direct workspace build directory: ${target}`);
  }
  targets.push(resolved);
}

for (const target of targets) await rm(target, { recursive: true, maxRetries: 3, retryDelay: 100 });
