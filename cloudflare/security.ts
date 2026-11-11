import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
export { hash, secret, secureEqual } from "../server/security.ts";
import {
  parsePasswordHash,
  PASSWORD_SCRYPT,
} from "../shared/password-format.ts";
export { passwordNeedsUpgrade } from "../shared/password-format.ts";
const derive = (password: string, salt: string, p = PASSWORD_SCRYPT.p) =>
  scrypt(new TextEncoder().encode(password), new TextEncoder().encode(salt), {
    N: 16384,
    r: 8,
    p,
    dkLen: 64,
  });
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return "scrypt-v2:" + salt + ":" + bytesToHex(derive(password, salt));
}
export function passwordMatches(password: string, stored: string) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  return timingSafeEqual(
    derive(password, parsed.salt, parsed.p),
    Buffer.from(parsed.digest, "hex"),
  );
}
