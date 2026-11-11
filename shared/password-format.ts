export const MIN_PASSWORD_LENGTH = 10;
// Letters (including Korean), numbers and whitespace do not count as special characters.
export const PASSWORD_SPECIAL_CHARACTER = /[\p{P}\p{S}]/u;
export const PASSWORD_INPUT_PATTERN = String.raw`.*[\p{P}\p{S}].*`;
export const PASSWORD_HINT = `${MIN_PASSWORD_LENGTH}자 이상 · 특수문자 1개 이상`;
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
