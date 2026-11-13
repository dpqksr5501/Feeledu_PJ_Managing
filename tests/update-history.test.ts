import { test, expect } from "vitest";
import { UpdateHistory, UPDATE_HISTORY_KEY } from "../src/update-history.ts";
import {
  appReleases,
  parseAppRelease,
  releaseNotesSince,
  type AppRelease,
} from "../shared/app-releases.ts";
const build = (
  revision: string,
  releaseId = appReleases[0].id,
): AppRelease => ({
  revision: revision.repeat(16),
  releaseId,
  releases: appReleases,
});
function store() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
test("only a verified changed build creates a receipt; skipped release notes stay grouped until acknowledged", () => {
  const storage = store(),
    ledger = new UpdateHistory(() => storage);
  const original = build("a", appReleases.at(-1)!.id),
    current = build("b");
  expect(ledger.arrive(original)).toBeNull();
  ledger.acknowledge(original);
  // An old build knows only its published history, not newer entries.
  storage.setItem(
    UPDATE_HISTORY_KEY,
    JSON.stringify({
      seen: { revision: original.revision, releaseId: original.releaseId },
      acknowledged: [original.releaseId],
    }),
  );
  ledger.begin(current, original);
  expect(ledger.arrive(original)).toBeNull();
  const receipt = new UpdateHistory(() => storage).arrive(current)!;
  expect(receipt.ids).toEqual(appReleases.slice(0, -1).map((note) => note.id));
  expect(new UpdateHistory(() => storage).arrive(current)).toEqual(receipt);
  ledger.acknowledge(current);
  expect(new UpdateHistory(() => storage).arrive(current)).toBeNull();
});
test("cancelled activation is not reported as applied, while another-tab version changes are detected", () => {
  const storage = store(),
    ledger = new UpdateHistory(() => storage),
    original = build("a"),
    newer = build("c");
  ledger.arrive(original);
  ledger.begin(newer, original);
  ledger.cancel();
  expect(ledger.arrive(original)).toBeNull();
  expect(ledger.arrive(newer)?.revision).toBe(newer.revision);
  expect(releaseNotesSince(newer, newer.releaseId)).toEqual([]);
});
test("corrupt/quota-disabled storage cannot break attendance or cause repeated receipts in one session", () => {
  const storage = store();
  storage.setItem(UPDATE_HISTORY_KEY, "not-json");
  const ledger = new UpdateHistory(() => storage);
  expect(ledger.arrive(build("a"))).toBeNull();
  const blocked = new UpdateHistory(() => ({
    getItem: () => null,
    setItem: () => {
      throw Error("quota");
    },
  }));
  blocked.arrive(build("a"));
  blocked.begin(build("b"), build("a"));
  expect(blocked.arrive(build("b"))).not.toBeNull();
  blocked.acknowledge(build("b"));
  expect(blocked.arrive(build("b"))).toBeNull();
});
test("release metadata rejects malformed, oversized or duplicate lists", () => {
  expect(parseAppRelease(build("a"))).toEqual(build("a"));
  for (const input of [
    null,
    {},
    { ...build("a"), revision: null },
    { ...build("a"), releases: Array(31).fill(appReleases[0]) },
    { ...build("a"), releases: [appReleases[0], appReleases[0]] },
  ])
    expect(parseAppRelease(input)).toBeNull();
});
