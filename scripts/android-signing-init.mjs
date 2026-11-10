// A permanent signing identity is required for APK updates to preserve app data.
// This script never prints the private key or password, and refuses to overwrite them.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const folder = resolve(".secrets/android-signing");
if (
  existsSync(resolve(folder, "private.pem")) ||
  existsSync(resolve(folder, "release.p12"))
)
  throw new Error(
    "Signing identity already exists; preserve the existing identity.",
  );
mkdirSync(folder, { recursive: true });
const password = existsSync(resolve(folder, "password"))
  ? readFileSync(resolve(folder, "password"), "utf8")
  : randomBytes(36).toString("base64url");
if (!existsSync(resolve(folder, "password")))
  writeFileSync(resolve(folder, "password"), password, {
    mode: 0o600,
    flag: "wx",
  });
const executable = process.env.OPENSSL_PATH || "openssl";
const env = { ...process.env, FEELEDU_SIGNING_PASSWORD: password };
function run(args) {
  const result = spawnSync(executable, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `OpenSSL signing setup failed (${result.error?.code || result.status}): ${result.stderr?.slice(-1200) || ""}`,
    );
}
run([
  "req",
  "-x509",
  "-newkey",
  "rsa:3072",
  "-sha256",
  "-days",
  "10000",
  "-nodes",
  "-subj",
  "/CN=Feeledu Attendance/O=Feeledu",
  "-keyout",
  resolve(folder, "private.pem"),
  "-out",
  resolve(folder, "certificate.pem"),
]);
run([
  "pkcs12",
  "-export",
  "-name",
  "feeledu",
  "-inkey",
  resolve(folder, "private.pem"),
  "-in",
  resolve(folder, "certificate.pem"),
  "-out",
  resolve(folder, "release.p12"),
  "-passout",
  "env:FEELEDU_SIGNING_PASSWORD",
]);
const cert = new X509Certificate(
  readFileSync(resolve(folder, "certificate.pem")),
);
mkdirSync("public/.well-known", { recursive: true });
writeFileSync(
  "public/.well-known/assetlinks.json",
  JSON.stringify(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "kr.feeledu.attendance",
          sha256_cert_fingerprints: [cert.fingerprint256],
        },
      },
    ],
    null,
    2,
  ) + "\n",
);
console.log(
  "Signing identity created in ignored .secrets/android-signing/. Back up this directory securely.",
);
console.log("Public certificate SHA-256:", cert.fingerprint256);
