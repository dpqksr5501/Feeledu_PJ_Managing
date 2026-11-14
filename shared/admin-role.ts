import type { Role } from "./types.ts";

/** Display names only. Stored roles and authorization stay compatible. */
export const adminRoleLabel = (role: Role) =>
  role === "owner" ? "개발자" : "학원 관리자";
