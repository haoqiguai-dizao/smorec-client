// Generate the Mac redistribution notices from tracked texts and the locked Electron runtime.
// Does not package, sign, publish, or overwrite existing release material.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'output/release-legal');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sources = [
  ['docs/open-source/public/THIRD-PARTY-LICENSES.txt', 'npm-licenses.txt'],
  ['docs/open-source/public/NATIVE-SPEECH-NOTICES.txt', 'native-speech-notices.txt'],
  ['native/THIRD-PARTY-NOTICES.txt', 'native-notices.txt'],
  ['node_modules/electron/dist/LICENSE', 'LICENSE.electron.txt'],
  ['node_modules/electron/dist/LICENSES.chromium.html', 'LICENSES.chromium.html'],
];
try {
  await fs.access(path.join(root, 'LICENSE'));
  sources.push(['LICENSE', 'LICENSE.client.txt']);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const name of await fs.readdir(path.join(root, 'public/beauty'))) {
  if (name.endsWith('.txt')) sources.push(['public/beauty/' + name, name]);
}
const files = await Promise.all(sources.map(async ([source, name]) => {
  let location = path.join(root, source);
  if (source.startsWith('docs/open-source/public/')) {
    try { await fs.access(location); }
    catch (error) { if (error.code !== 'ENOENT') throw error; location = path.join(root, path.basename(source)); }
  }
  return [name, await fs.readFile(location)];
}));
const template = await fs.readFile(path.join(root, 'build/mac-legal-README.txt'), 'utf8');
files.push(['README.txt', template.replaceAll('{{VERSION}}', pkg.version)]);
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.mkdir(destination); // An existing directory is an error; retain the accepted materials.
for (const [name, data] of files) await fs.writeFile(path.join(destination, name), data, { flag: 'wx' });
console.log(JSON.stringify({ result: 'PASS', version: pkg.version, destination, files: files.length }));
