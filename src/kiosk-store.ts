import { openDB } from "idb";
import type { ClockEvent, RosterEntry } from "../shared/types.ts";
type QueueItem = ClockEvent & { seq: number; retry_after?: number };
export const kioskDb = openDB("feeledu-kiosk-v1", 1, {
  upgrade(db) {
    db.createObjectStore("meta");
    db.createObjectStore("queue", { keyPath: "id" });
  },
});
export const kioskStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await kioskDb).get("meta", key);
  },
  async set(key: string, value: unknown) {
    return (await kioskDb).put("meta", value, key);
  },
  async queue(): Promise<QueueItem[]> {
    return ((await (await kioskDb).getAll("queue")) as QueueItem[]).sort(
      (a, b) => a.seq - b.seq,
    );
  },
  async enqueue(event: ClockEvent) {
    const db = await kioskDb;
    const tx = db.transaction(["meta", "queue"], "readwrite");
    const seq =
      (((await tx.objectStore("meta").get("sequence")) as number) || 0) + 1;
    await tx.objectStore("meta").put(seq, "sequence");
    await tx.objectStore("queue").put({ ...event, seq });
    await tx.done;
  },
  async markOffline(id: string) {
    const db = await kioskDb;
    const tx = db.transaction("queue", "readwrite");
    const item = await tx.store.get(id);
    if (item) await tx.store.put({ ...item, offline: true });
    await tx.done;
  },
  async remove(id: string) {
    return (await kioskDb).delete("queue", id);
  },
  async deferUnknownEmployee(id: string) {
    const db = await kioskDb;
    const tx = db.transaction("queue", "readwrite");
    const item = await tx.store.get(id);
    if (item) await tx.store.put({ ...item, retry_after: Date.now() + 300000 });
    await tx.done;
  },
  async archiveAndUnpair() {
    const db = await kioskDb;
    const tx = db.transaction(["meta", "queue"], "readwrite");
    const queue = await tx.objectStore("queue").getAll();
    if (queue.length)
      await tx.objectStore("meta").put(queue, "recovery-archive-" + Date.now());
    await tx.objectStore("queue").clear();
    await tx.objectStore("meta").delete("token");
    await tx.objectStore("meta").delete("roster");
    await tx.done;
  },
};
export type Roster = {
  employees: RosterEntry[];
  academyName: string;
  time: string;
};
