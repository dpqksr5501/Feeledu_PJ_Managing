import { readFileSync } from "node:fs";
const statements = JSON.parse(
  readFileSync("public/.well-known/assetlinks.json", "utf8"),
);
const expected = statements.find(
  (s) => s.target.package_name === "kr.feeledu.attendance",
)?.target.sha256_cert_fingerprints;
const signature = readFileSync("release/signature.txt", "utf8");
const actual = signature
  .match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]
  ?.toLowerCase();
if (
  !actual ||
  !expected?.some((value) => value.replaceAll(":", "").toLowerCase() === actual)
) {
  throw new Error(
    "APK signing certificate does not match the public website identity. Release blocked.",
  );
}
console.log("APK signature matches the website Digital Asset Links.");
