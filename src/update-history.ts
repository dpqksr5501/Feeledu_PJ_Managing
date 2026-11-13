import { releaseNotesSince, type AppRelease } from "../shared/app-releases.ts";

export const UPDATE_HISTORY_KEY = "feeledu-app-updates-v1";
type Identity = { revision: string; releaseId: string };
type Receipt = { revision: string; ids: string[]; at: number };
type Ledger = {
  seen?: Identity;
  pending?: Identity & { from?: string; at: number };
  receipt?: Receipt;
  acknowledged: string[];
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 60;
const validRevision = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{16}$/.test(v);

/** Small, non-personal ledger. Storage failures never interfere with attendance. */
export class UpdateHistory {
  private memory: Ledger = { acknowledged: [] };
  private storageFailed = false;
  constructor(
    privateStorage: () => Pick<Storage, "getItem" | "setItem"> = () =>
      localStorage,
  ) {
    this.storage = privateStorage;
  }
  private storage: () => Pick<Storage, "getItem" | "setItem">;
  read(): Ledger {
    if (this.storageFailed) return this.memory;
    try {
      const raw = this.storage().getItem(UPDATE_HISTORY_KEY);
      if (!raw) this.memory = { acknowledged: [] };
      if (raw && raw.length <= 20000) {
        const value = JSON.parse(raw) as Ledger;
        if (!Array.isArray(value.acknowledged)) return this.memory;
        const next: Ledger = {
          acknowledged: value.acknowledged.filter(validId).slice(-60),
        };
        if (
          value.seen &&
          validRevision(value.seen.revision) &&
          validId(value.seen.releaseId)
        )
          next.seen = value.seen;
        if (
          value.pending &&
          validRevision(value.pending.revision) &&
          validId(value.pending.releaseId) &&
          Number.isFinite(value.pending.at)
        )
          next.pending = value.pending;
        if (
          value.receipt &&
          validRevision(value.receipt.revision) &&
          Array.isArray(value.receipt.ids) &&
          value.receipt.ids.every(validId) &&
          Number.isFinite(value.receipt.at)
        )
          next.receipt = {
            ...value.receipt,
            ids: value.receipt.ids.slice(0, 30),
          };
        this.memory = next;
      }
    } catch {
      /* Browsers may disable storage, including private/managed profiles. */
    }
    return this.memory;
  }
  private save(next: Ledger) {
    this.memory = next;
    try {
      this.storage().setItem(UPDATE_HISTORY_KEY, JSON.stringify(next));
    } catch {
      this.storageFailed = true;
    }
  }
  begin(target: AppRelease, from?: AppRelease) {
    this.save({
      ...this.read(),
      pending: {
        revision: target.revision,
        releaseId: target.releaseId,
        from: from?.revision,
        at: Date.now(),
      },
    });
  }
  cancel() {
    const value = this.read();
    delete value.pending;
    this.save(value);
  }
  arrive(active: AppRelease) {
    const value = this.read();
    const changed = value.pending
      ? value.pending.revision === active.revision ||
        (value.pending.from &&
          value.pending.from !== active.revision &&
          value.seen?.revision !== active.revision)
      : value.seen && value.seen.revision !== active.revision;
    if (changed) {
      value.receipt = {
        revision: active.revision,
        ids: releaseNotesSince(active, value.seen?.releaseId)
          .filter((note) => !value.acknowledged.includes(note.id))
          .map((note) => note.id),
        at: Date.now(),
      };
      delete value.pending;
    } else if (value.pending && Date.now() - value.pending.at > 15 * 60000)
      delete value.pending;
    value.seen = { revision: active.revision, releaseId: active.releaseId };
    if (value.receipt && value.receipt.revision !== active.revision)
      delete value.receipt;
    this.save(value);
    return value.receipt ?? null;
  }
  acknowledge(info: AppRelease) {
    const value = this.read();
    this.save({
      seen: { revision: info.revision, releaseId: info.releaseId },
      acknowledged: [
        ...new Set([
          ...value.acknowledged,
          ...info.releases.map((note) => note.id),
        ]),
      ].slice(-60),
    });
  }
}
