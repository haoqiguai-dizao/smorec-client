/** Mac uses a bundle identifier; Windows retains the existing full executable-path identity. */
export function isMacApplicationID(value: string): boolean {
  return value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/.test(value)
    && !/\.exe$/i.test(value);
}
export function applicationIdentity(value: string): string {
  return isMacApplicationID(value) ? value : value.replaceAll('/', '\\').toLowerCase();
}
