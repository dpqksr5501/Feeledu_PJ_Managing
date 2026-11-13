import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
const folder = mkdtempSync(join(tmpdir(), "feeledu-test-"));
process.env.NODE_ENV = "production";
process.env.PORT = "4173";
process.env.HOST = "127.0.0.1";
process.env.COOKIE_SECURE = "false";
process.env.DB_PATH = join(folder, "test.db");
process.env.SETUP_TOKEN = "test-only-setup-token";
process.env.DISABLE_BACKUPS = "1";
delete process.env.KASI_SERVICE_KEY;
process.on("exit", () => {
  try {
    if (
      dirname(folder) === resolve(tmpdir()) &&
      basename(folder).startsWith("feeledu-test-")
    )
      rmSync(folder, { recursive: true, force: true });
  } catch {}
});
await import("../server/index.ts");
