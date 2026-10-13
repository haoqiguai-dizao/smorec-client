const { verifyInstallerBranding } = require('./installer-branding.cjs');
const { isZipOnlyBuild } = require('./installer-targets.cjs');
const { spawn } = require('node:child_process');
const path = require('node:path');

module.exports = async context => {
  if (context.electronPlatformName === 'darwin') {
    const fs = require('node:fs');
    const { createHash } = require('node:crypto');
    const { execFileSync } = require('node:child_process');
    const directory = path.join(context.packager.projectDir, 'output/ffmpeg-gpl');
    const binary = path.join(directory, 'ffmpeg');
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'SOURCE-BUILD.json')));
    const digest = createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
    const configuration = execFileSync(binary, ['-version'], { encoding: 'utf8' });
    if (digest !== receipt.sha256 || /--enable-nonfree\b/.test(configuration)) throw new Error('Mac FFmpeg source receipt or redistribution configuration mismatch');
    for (const name of ['LICENSE.GPLv3', 'LICENSE.libwebp', 'ffmpeg-corresponding-source.tar.gz', 'README.txt']) {
      if (!fs.statSync(path.join(directory, name)).isFile()) throw new Error('Missing Mac FFmpeg redistribution material: ' + name);
    }
    require('./mac-release-inputs.cjs').verifyMacReleaseInputs(context.packager.projectDir, context.packager.config);
    console.log('  • Mac FFmpeg, NO-TTS runtime and complete redistribution materials verified');
    return;
  }
  if (context.electronPlatformName !== 'win32') return;
  const packager = context.packager;
  const result = verifyInstallerBranding(packager.projectDir, packager.config, packager.info.metadata);
  if (process.platform !== 'win32') throw new Error('Run the Windows installer path regression on Windows before packaging');
  if (isZipOnlyBuild(context.targets)) {
    console.log(`  • installer branding verified: ${result.installDirectory}; native installer directory QA not applicable to ZIP-only application archive`);
    return;
  }
  await new Promise((resolve, reject) => {
    const check = spawn(process.execPath, [path.join(packager.projectDir, 'scripts/verify-installer-directory.mjs')], {
      cwd: packager.projectDir, windowsHide: true, stdio: 'inherit',
    });
    check.once('error', reject);
    check.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installer directory regression failed (${code})`)));
  });
  console.log(`  • installer branding verified: ${result.installDirectory}; existing upgrade paths preserved`);
};
