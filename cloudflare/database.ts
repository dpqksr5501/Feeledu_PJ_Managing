import type { Db } from "../server/database.ts";

/** Native durable SQLite. No local files or process-memory database. */
export function durableDatabase(storage: DurableObjectStorage): Db {
  return {
    exec(sql) {
      storage.sql.exec(sql).toArray();
    },
    close() {},
    transactionSync: (fn) => storage.transactionSync(fn),
    prepare(sql) {
      return {
        get: (...args) => storage.sql.exec(sql, ...args).toArray()[0],
        all: (...args) => storage.sql.exec(sql, ...args).toArray(),
        run: (...args) => {
          storage.sql.exec(sql, ...args).toArray();
        },
      };
    },
  };
}
