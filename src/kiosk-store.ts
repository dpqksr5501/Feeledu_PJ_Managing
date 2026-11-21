import { openDB } from "idb";
import type { ClockEvent, ClockResult, RosterEntry } from "../shared/types.ts";
import { projectRosterEntry } from "./kiosk-jobs.ts";
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
  async queueCount() {
    return (await kioskDb).count("queue");
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
  async acknowledge(event: ClockEvent, result: ClockResult) {
    const tx = (await kioskDb).transaction(["meta", "queue"], "readwrite");
    const meta = tx.objectStore("meta");
    const roster = (await meta.get("roster")) as Roster | undefined;
    if (roster) {
      roster.employees = roster.employees.map((person) => {
        if (person.id !== event.employee_id) return person;
        const pending = (person.pending ?? []).filter(
          (item) => item.id !== event.id,
        );
        if (result.status === "pending")
          pending.push({
            id: event.id,
            action: event.action,
            job_id: event.job_id,
            expected_shift_id: event.expected_shift_id,
          });
        if (result.status !== "accepted" || !result.shift_id)
          return { ...person, pending };
        if (result.open_shift !== undefined)
          return {
            ...person,
            working: !!result.open_shift,
            open_shift_id: result.open_shift?.id ?? null,
            open_job: result.open_shift?.job ?? null,
            pending,
          };
        const confirmed = projectRosterEntry({ ...person, pending: [] }, [
          { ...event, id: event.action === "out" ? event.id : result.shift_id },
        ]);
        return { ...confirmed, pending };
      });
      await meta.put(roster, "roster");
    }
    await tx.objectStore("queue").delete(event.id);
    const remaining = await tx.objectStore("queue").count();
    await tx.done;
    return { roster, remaining };
  },
  async deferEvent(id: string) {
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
