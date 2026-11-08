import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function secret() {
  return randomBytes(32).toString("base64url");
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  return (
    expected?.length === actual.length * 2 &&
    timingSafeEqual(actual, Buffer.from(expected, "hex"))
  );
}
export function secureEqual(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
