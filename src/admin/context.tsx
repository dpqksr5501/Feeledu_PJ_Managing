import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type {
  Admin,
  Adjustment,
  Device,
  Employee,
  Holiday,
  Payroll,
  Policy,
  ReviewEvent,
  Shift,
} from "../../shared/types.ts";
export type AuditEntry = {
  id: string;
  actor_name: string | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
};
export type SettlementEntry = {
  id: string;
  date_from: string;
  date_to: string;
  version: number;
  total: number;
  created_at: string;
  reason: string;
  name: string;
};
export type AdminData = {
  employees: Employee[];
  records: Shift[];
  reviews: ReviewEvent[];
  payroll: Payroll;
  policy: Policy;
  holidays: Holiday[];
  adjustments: Adjustment[];
  accounts: Admin[];
  devices: Device[];
  audit: AuditEntry[];
  settlements: SettlementEntry[];
};
type ContextValue = {
  admin: Admin;
  data: AdminData;
  refresh: () => void;
  mutate: (path: string, body?: unknown, method?: string) => Promise<boolean>;
  open: (title: string, content: ReactNode) => void;
  close: () => void;
  from: string;
  to: string;
  setPeriod: (from: string, to: string) => void;
  navigate: (tab: string) => void;
};
export const AdminContext = createContext<ContextValue | null>(null);
export function useAdmin() {
  return useContext(AdminContext)!;
}
