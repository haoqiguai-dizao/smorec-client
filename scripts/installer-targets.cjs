function isZipOnlyBuild(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return false;
  for (const target of targets) {
    if (target === null || typeof target !== 'object' || target.name !== 'zip') return false;
  }
  return true;
}

module.exports = { isZipOnlyBuild };
