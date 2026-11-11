import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  parsePasswordHash,
  PASSWORD_SCRYPT,
} from "../shared/password-format.ts";
export { passwordNeedsUpgrade } from "../shared/password-format.ts";
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function secret() {
  return randomBytes(32).toString("base64url");
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return (
    "scrypt-v2:" +
    salt +
    ":" +
    scryptSync(password, salt, 64, {
      ...PASSWORD_SCRYPT,
      maxmem: 64 * 1024 * 1024,
    }).toString("hex")
  );
}
export function passwordMatches(password: string, stored: string) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const actual = scryptSync(password, parsed.salt, 64, {
    ...PASSWORD_SCRYPT,
    p: parsed.p,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(parsed.digest, "hex"));
}
export function secureEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
