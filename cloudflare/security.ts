import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
export { hash, secret, secureEqual } from "../server/security.ts";
const derive = (password: string, salt: string) =>
  scrypt(new TextEncoder().encode(password), new TextEncoder().encode(salt), {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: 64,
  });
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + bytesToHex(derive(password, salt));
}
export function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = derive(password, salt || "invalid-password-salt");
  return (
    /^[a-f0-9]{128}$/.test(expected || "") &&
    timingSafeEqual(actual, Buffer.from(expected, "hex"))
  );
}
