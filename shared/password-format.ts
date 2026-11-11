export const MIN_PASSWORD_LENGTH = 15;
export const PASSWORD_SCRYPT = { N: 16384, r: 8, p: 5, dkLen: 64 };
export function parsePasswordHash(stored: string) {
  if (typeof stored !== "string") return null;
  const current = /^scrypt-v2:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored);
  const legacy = /^([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored);
  const match = current || legacy;
  return match
    ? { salt: match[1], digest: match[2], p: current ? 5 : 1, legacy: !current }
    : null;
}
export const passwordNeedsUpgrade = (stored: string) =>
  !!parsePasswordHash(stored)?.legacy;
