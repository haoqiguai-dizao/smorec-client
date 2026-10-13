const release = require('./mac.cjs');

// Force the same ad-hoc mode used by certificate-free distribution for local acceptance.
module.exports = { ...release, mac: { ...release.mac, identity: '-', hardenedRuntime: false,
  entitlements: 'build/mac-local-entitlements.plist', entitlementsInherit: 'build/mac-local-entitlements.plist' } };
