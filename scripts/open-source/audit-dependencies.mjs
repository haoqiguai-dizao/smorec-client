// Generates metadata and installed production-package notices; not a legal clearance.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const output = path.resolve(process.argv[2] ?? 'output/open-source/inventory');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const packages = [], texts = [], missing = [];
for (const [name, value] of Object.entries(lock.packages)) {
  if (!name) continue;
  const row = {
    path: name, version: value.version, license: value.license ?? 'UNRESOLVED',
    development: Boolean(value.dev), optional: Boolean(value.optional),
    source: value.resolved, integrity: value.integrity,
  };
  const directory = path.join(root, name);
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (name === 'node_modules/parse-cache-control' && value.version === '1.0.1' && entries) {
    const text = await fs.readFile(path.join(directory, 'LICENSE'), 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== '111f42b37daecc6c387d037ef25955bd269e7f9a46a736d5257a23560534763f') {
      throw new Error('Review changed parse-cache-control license before applying the audited BSD identifier');
    }
    row.license = 'BSD-3-Clause'; row.licenseEvidence = 'package LICENSE read; package-lock SPDX missing';
  }
  if (!row.development) {
    row.licenseFiles = [];
    for (const entry of entries ?? []) {
      if (!entry.isFile() || !/^(?:license|copying|notice)/i.test(entry.name)) continue;
      const content = await fs.readFile(path.join(directory, entry.name));
      row.licenseFiles.push({ file: entry.name, sha256: createHash('sha256').update(content).digest('hex') });
      texts.push(`\n===== ${name} @ ${value.version} / ${entry.name} =====\n${content.toString()}`);
    }
    if (!row.licenseFiles.length) missing.push(name);
  }
  packages.push(row);
}
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'DEPENDENCIES.json'), JSON.stringify({
  generatedFrom: 'package-lock.json and installed package notices; regenerate when dependencies change',
  projectVersion: lock.version, missingProductionLicenseText: missing, packages,
}, null, 2) + '\n');
await fs.writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'),
  'Generated from locked production npm packages; preserve upstream terms.\n' + texts.join(''));
console.log(JSON.stringify({ packages: packages.length, productionLicenseTexts: texts.length, missing, output }));
