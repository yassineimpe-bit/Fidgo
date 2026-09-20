import { describe, expect, it } from "vitest";
import {
  canAccessBackoffice,
  canManageProgram,
  canManageStaff,
  canScan,
  canSuspendEstablishment,
  staffRoleLabel,
  type StaffRole,
} from "../lib/loyalty";

describe("staff role access", () => {
  it("gives OWNER full merchant administration", () => {
    expect(canAccessBackoffice("OWNER")).toBe(true);
    expect(canManageProgram("OWNER")).toBe(true);
    expect(canManageStaff("OWNER")).toBe(true);
    expect(canScan("OWNER")).toBe(true);
    expect(canSuspendEstablishment("OWNER")).toBe(true);
  });

  it("keeps EMPLOYEE on scanner duties only", () => {
    expect(canAccessBackoffice("EMPLOYEE")).toBe(false);
    expect(canManageProgram("EMPLOYEE")).toBe(false);
    expect(canManageStaff("EMPLOYEE")).toBe(false);
    expect(canScan("EMPLOYEE")).toBe(true);
    expect(canSuspendEstablishment("EMPLOYEE")).toBe(false);
  });

  it.each([
    ["OWNER", "Propriétaire"],
    ["MANAGER", "Manager"],
    ["EMPLOYEE", "Employé"],
    ["VIEWER", "Lecture seule"],
  ] as const)("labels %s clearly", (role, label) => {
    expect(staffRoleLabel(role as StaffRole)).toBe(label);
  });
});
