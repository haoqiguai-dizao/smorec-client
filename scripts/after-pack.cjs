const { promises: fs, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Public artifactBuildStarted runs after executable resource editing and before NSIS archiving.
// The same final managed-file list goes in the installer and the app-update archive.
module.exports = async context => {
  // ArtifactBuildStarted exposes only targetPresentableName, file and arch.
  // Mac overrides this hook; its archive event is named "macOS zip" as well.
  if (!['nsis', 'zip'].includes(context.targetPresentableName)) return;
  const root = path.join(path.dirname(context.file), 'win-unpacked'), files = [];
  const metadata = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf8'));
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name), relative = path.relative(root, full).replaceAll('\\', '/');
      if (relative === 'smorec-update-files.json') continue;
      if (entry.isSymbolicLink()) throw new Error('Application archive cannot contain links');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(full)) digest.update(chunk);
        files.push({ path: relative, size: (await fs.stat(full)).size, sha256: digest.digest('hex') });
      }
    }
  }
  await walk(root); files.sort((a, b) => a.path.localeCompare(b.path));
  await fs.writeFile(path.join(root, 'smorec-update-files.json'), JSON.stringify({ schema: 1, version: metadata.version, files }));
};
