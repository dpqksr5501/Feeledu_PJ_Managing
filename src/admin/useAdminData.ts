import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Admin, Policy } from "../../shared/types.ts";
import { api, ApiError } from "../api.ts";
import type { AdminData, AdminResource } from "./context.tsx";
import { AdminReadCache } from "./read-cache.ts";
const EMPTY: never[] = [];
const paths: Record<AdminResource, string> = {
  employees: "employees",
  records: "records",
  reviews: "reviews",
  payroll: "payroll",
  policy: "settings",
  holidays: "holidays",
  adjustments: "adjustments",
  accounts: "accounts",
  devices: "devices",
  audit: "audit",
  settlements: "settlements",
};
const rangeResources: AdminResource[] = ["records", "payroll", "adjustments"];
export function resourcesForView(
  view: string,
  owner: boolean,
): AdminResource[] {
  return [
    "policy",
    ...({
      overview: [],
      employees: ["employees"],
      records: ["employees", "holidays", "records", "reviews"],
      payroll: [
        "employees",
        "holidays",
        "payroll",
        "adjustments",
        "settlements",
      ],
      settings: ["holidays", ...(owner ? ["accounts", "devices"] : [])],
      audit: ["audit"],
    }[view] ?? []),
  ] as AdminResource[];
}
export function resourcesAfterMutation(
  path: string,
): AdminResource[] | undefined {
  if (path.startsWith("/admin/employees"))
    return ["employees", "records", "reviews", "payroll", "audit"];
  if (/^\/admin\/(records|reviews|recovery)/.test(path))
    return ["records", "reviews", "payroll", "audit"];
  if (path.startsWith("/admin/settings")) return ["policy", "payroll", "audit"];
  if (/^\/admin\/(holidays|holiday-calendar)/.test(path))
    return ["holidays", "payroll", "audit"];
  if (path.startsWith("/admin/adjustments"))
    return ["adjustments", "payroll", "audit"];
  if (path.startsWith("/admin/settlements"))
    return ["settlements", "payroll", "audit"];
  if (path.startsWith("/admin/accounts")) return ["accounts", "audit"];
  if (/^\/admin\/(devices|pairings)/.test(path)) return ["devices", "audit"];
}
export function useAdminData({
  admin,
  tab,
  from,
  to,
  expired,
  failed,
}: {
  admin: Admin;
  tab: string;
  from: string;
  to: string;
  expired: () => void;
  failed: (text: string) => void;
}) {
  const cache = useMemo(() => new AdminReadCache(), [admin.id]);
  const [epoch, invalidate] = useReducer((value: number) => value + 1, 0);
  const [, rendered] = useReducer((value: number) => value + 1, 0);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const range = new URLSearchParams({ from, to }).toString();
  const [settledRange, setSettledRange] = useState(range);
  const needed = resourcesForView(tab, admin.role === "owner");
  const key = (name: AdminResource) =>
    name + ":" + (rangeResources.includes(name) ? range : "");
  const neededKey = needed.map(key).join("|");
  const rangeChanged =
    settledRange !== range &&
    needed.some((name) => rangeResources.includes(name));
  useEffect(() => {
    const timer = setTimeout(() => setSettledRange(range), 200);
    return () => clearTimeout(timer);
  }, [range]);
  useEffect(() => () => cache.clear(), [cache]);
  const refresh = useCallback(
    (resources?: AdminResource[]) => {
      cache.invalidate(resources);
      invalidate();
    },
    [cache],
  );
  useEffect(() => {
    const resumed = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", resumed);
    window.addEventListener("online", resumed);
    return () => {
      document.removeEventListener("visibilitychange", resumed);
      window.removeEventListener("online", resumed);
    };
  }, []);
  useEffect(() => {
    let current = true;
    cache.retain(needed.map(key));
    if (document.hidden || rangeChanged) return;
    if (!navigator.onLine) {
      setLoadError(true);
      setFetching(false);
      failed("오프라인입니다. 연결 후 새로고침해 주세요.");
      return;
    }
    setFetching(true);
    setLoadError(false);
    void Promise.all(
      needed.map((name) =>
        cache.get(
          key(name),
          (signal) =>
            api(
              "/admin/" +
                paths[name] +
                (rangeResources.includes(name) ? "?" + range : ""),
              { signal },
            ),
          ["policy", "employees", "holidays"].includes(name) ? 300000 : 60000,
        ),
      ),
    )
      .then(() => {
        if (current) rendered();
      })
      .catch((error) => {
        if (!current) return;
        setLoadError(true);
        if (error instanceof ApiError && error.status === 401) expired();
        else if ((error as Error).name !== "AbortError")
          failed(
            error instanceof ApiError
              ? error.message
              : "연결을 확인하고 새로고침해 주세요.",
          );
      })
      .finally(() => {
        if (current) setFetching(false);
      });
    return () => {
      current = false;
    };
    // Parent callbacks intentionally do not restart requests; cache keys own freshness.
  }, [cache, neededKey, epoch, rangeChanged]);
  const policy = cache.peek<Policy>(key("policy"));
  const loading =
    rangeChanged || needed.some((name) => cache.peek(key(name)) === undefined);
  const get = <K extends AdminResource>(name: K): AdminData[K] | undefined =>
    cache.peek(key(name));
  const data: AdminData | null = policy
    ? {
        policy,
        employees: get("employees") ?? EMPTY,
        records: get("records") ?? EMPTY,
        reviews: get("reviews") ?? EMPTY,
        holidays: get("holidays") ?? EMPTY,
        adjustments: get("adjustments") ?? EMPTY,
        accounts: get("accounts") ?? EMPTY,
        devices: get("devices") ?? EMPTY,
        audit: get("audit") ?? EMPTY,
        settlements: get("settlements") ?? EMPTY,
        payroll: get("payroll") ?? {
          from,
          to,
          policy,
          rows: [],
          total: 0,
          warnings: [],
          fingerprint: "",
          settlement: null,
          difference: null,
        },
      }
    : null;
  return { data, loading, fetching, loadError, refresh };
}
