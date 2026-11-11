import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const repo = "dpqksr5501/Feeledu_PJ_Managing";
const tag = process.env.ANDROID_RELEASE_TAG;
if (tag && !/^android-v\d+\.\d+\.\d+$/.test(tag))
  throw new Error("Invalid Android release tag");
const api = `https://api.github.com/repos/${repo}/releases${tag ? "/tags/" + tag : "?per_page=100"}`;
const response = await fetch(api, {
  headers: {
    Accept: "application/vnd.github+json",
    ...(process.env.GH_TOKEN
      ? { Authorization: "Bearer " + process.env.GH_TOKEN }
      : {}),
  },
  signal: AbortSignal.timeout(60000),
});
if (!response.ok)
  throw new Error(`Android release metadata: HTTP ${response.status}`);
const payload = await response.json();
const candidates = (tag ? [payload] : payload).filter(
  (row) =>
    /^android-v\d+\.\d+\.\d+$/.test(row.tag_name) &&
    !row.draft &&
    !row.prerelease,
);
candidates.sort((a, b) => {
  const left = a.tag_name.slice(9).split(".").map(Number),
    right = b.tag_name.slice(9).split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return right[i] - left[i];
  return 0;
});
const release = candidates[0];
if (
  !release ||
  !/^android-v\d+\.\d+\.\d+$/.test(release.tag_name) ||
  release.draft ||
  release.prerelease
)
  throw new Error("Expected a published Android release");
async function asset(name) {
  const url = release.assets.find(
    (row) => row.name === name,
  )?.browser_download_url;
  if (
    !url?.startsWith(
      `https://github.com/${repo}/releases/download/${release.tag_name}/`,
    )
  )
    throw new Error("Unexpected APK source");
  const result = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!result.ok)
    throw new Error(`Android asset ${name}: HTTP ${result.status}`);
  return result;
}
const checksum = (await (await asset("SHA256SUMS.txt")).text()).match(
  /^([a-f0-9]{64})\s+\*?feeledu-attendance\.apk\s*$/m,
)?.[1];
if (!checksum) throw new Error("Missing published APK checksum");
const apk = new Uint8Array(
  await (await asset("feeledu-attendance.apk")).arrayBuffer(),
);
const sha256 = createHash("sha256").update(apk).digest("hex");
if (
  sha256 !== checksum ||
  apk.length < 4 ||
  apk.length > 25 * 1024 * 1024 ||
  apk[0] !== 0x50 ||
  apk[1] !== 0x4b ||
  apk[2] !== 3 ||
  apk[3] !== 4
)
  throw new Error("APK integrity validation failed");
const version = release.tag_name.slice("android-v".length);
mkdirSync("dist/downloads", { recursive: true });
writeFileSync("dist/downloads/feeledu-attendance.apk", apk);
writeFileSync(
  "dist/android-release.json",
  JSON.stringify({
    version,
    bytes: apk.length,
    sha256,
    filename: `feeledu-attendance-${version}.apk`,
    releaseUrl: release.html_url,
  }) + "\n",
);
console.log(
  `Packaged published Android ${version}: ${apk.length} bytes, SHA-256 verified.`,
);
