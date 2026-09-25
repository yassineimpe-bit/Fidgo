import { describe, expect, it } from "vitest";
import {
  STAFF_ROLE_PERMISSIONS,
  canAccessBackoffice,
  canAssignStaffRole,
  canManageBilling,
  canManageCustomers,
  canManageEstablishment,
  canManageManagers,
  canManageProgram,
  canManageStaff,
  canManageStaffTarget,
  canReverse,
  canScan,
  canSuspendEstablishment,
  hasStaffPermission,
  staffRoleLabel,
  type StaffPermission,
  type StaffRole,
} from "../lib/loyalty";

describe("staff role access", () => {
  it("defines an explicit permission matrix for every role", () => {
    const expected: Record<StaffRole, StaffPermission[]> = {
      OWNER: [
        "BACKOFFICE_VIEW", "SCAN", "PROGRAM_WRITE", "CUSTOMER_WRITE", "STAFF_WRITE",
        "MANAGER_WRITE", "TRANSACTION_REVERSE", "ESTABLISHMENT_WRITE",
        "ESTABLISHMENT_SUSPEND", "BILLING_WRITE", "CAMPAIGN_WRITE",
      ],
      MANAGER: [
        "BACKOFFICE_VIEW", "SCAN", "PROGRAM_WRITE", "CUSTOMER_WRITE", "STAFF_WRITE",
        "TRANSACTION_REVERSE", "ESTABLISHMENT_WRITE", "CAMPAIGN_WRITE",
      ],
      EMPLOYEE: ["SCAN"],
      VIEWER: ["BACKOFFICE_VIEW"],
    };
    expect(STAFF_ROLE_PERMISSIONS).toEqual(expected);
    for (const [role, permissions] of Object.entries(expected) as [StaffRole, StaffPermission[]][]) {
      for (const permission of permissions) expect(hasStaffPermission(role, permission)).toBe(true);
    }
  });

  it("gives OWNER the privileged controls that MANAGER must never inherit", () => {
    expect(canManageManagers("OWNER")).toBe(true);
    expect(canManageBilling("OWNER")).toBe(true);
    expect(canSuspendEstablishment("OWNER")).toBe(true);

    expect(canManageManagers("MANAGER")).toBe(false);
    expect(canManageBilling("MANAGER")).toBe(false);
    expect(canSuspendEstablishment("MANAGER")).toBe(false);
  });

  it("lets MANAGER operate the business without owner-only powers", () => {
    expect(canAccessBackoffice("MANAGER")).toBe(true);
    expect(canManageProgram("MANAGER")).toBe(true);
    expect(canManageCustomers("MANAGER")).toBe(true);
    expect(canManageStaff("MANAGER")).toBe(true);
    expect(canManageEstablishment("MANAGER")).toBe(true);
    expect(canReverse("MANAGER")).toBe(true);
    expect(canScan("MANAGER")).toBe(true);
  });

  it("keeps EMPLOYEE on scanner duties only", () => {
    expect(canAccessBackoffice("EMPLOYEE")).toBe(false);
    expect(canManageProgram("EMPLOYEE")).toBe(false);
    expect(canManageCustomers("EMPLOYEE")).toBe(false);
    expect(canManageStaff("EMPLOYEE")).toBe(false);
    expect(canManageEstablishment("EMPLOYEE")).toBe(false);
    expect(canReverse("EMPLOYEE")).toBe(false);
    expect(canScan("EMPLOYEE")).toBe(true);
  });

  it("enforces role-assignment and target-management boundaries", () => {
    expect(canAssignStaffRole("OWNER", "MANAGER")).toBe(true);
    expect(canAssignStaffRole("OWNER", "OWNER")).toBe(false);
    expect(canAssignStaffRole("MANAGER", "EMPLOYEE")).toBe(true);
    expect(canAssignStaffRole("MANAGER", "VIEWER")).toBe(true);
    expect(canAssignStaffRole("MANAGER", "MANAGER")).toBe(false);
    expect(canAssignStaffRole("MANAGER", "OWNER")).toBe(false);

    expect(canManageStaffTarget("OWNER", "MANAGER")).toBe(true);
    expect(canManageStaffTarget("OWNER", "OWNER")).toBe(false);
    expect(canManageStaffTarget("MANAGER", "EMPLOYEE")).toBe(true);
    expect(canManageStaffTarget("MANAGER", "VIEWER")).toBe(true);
    expect(canManageStaffTarget("MANAGER", "MANAGER")).toBe(false);
    expect(canManageStaffTarget("MANAGER", "OWNER")).toBe(false);
  });

  it.each([
    ["OWNER", "Propriétaire"],
    ["MANAGER", "Manager"],
    ["EMPLOYEE", "Employé"],
    ["VIEWER", "Lecture seule"],
  ] as const)("labels %s clearly", (role, label) => {
    expect(staffRoleLabel(role)).toBe(label);
  });
});
