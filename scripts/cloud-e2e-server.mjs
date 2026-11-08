import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { spawn } from "node:child_process";
const folder = mkdtempSync(join(tmpdir(), "feeledu-cloud-test-"));
const child = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    "4175",
    "--persist-to",
    folder,
    "--var",
    "SETUP_TOKEN:test-only-setup-token",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    windowsHide: true,
  },
);
const cleanup = () => {
  try {
    if (
      dirname(folder) === resolve(tmpdir()) &&
      basename(folder).startsWith("feeledu-cloud-test-")
    )
      rmSync(folder, { recursive: true, force: true });
  } catch {}
};
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child.kill(signal);
    cleanup();
    process.exit(0);
  });
