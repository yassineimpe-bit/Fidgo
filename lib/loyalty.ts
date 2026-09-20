export type LoyaltyMode = "STAMPS" | "POINTS";
export type PointsRule = "PER_PURCHASE" | "PER_EURO";
export type StaffRole = "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER";
export type StaffPermission =
  | "BACKOFFICE_VIEW"
  | "SCAN"
  | "PROGRAM_WRITE"
  | "CUSTOMER_WRITE"
  | "STAFF_WRITE"
  | "MANAGER_WRITE"
  | "TRANSACTION_REVERSE"
  | "ESTABLISHMENT_WRITE"
  | "ESTABLISHMENT_SUSPEND"
  | "BILLING_WRITE";
export type LoyaltyProgramRules = { mode: LoyaltyMode; pointsRule: PointsRule; stampsPerVisit: number; pointsPerEuro: number; pointsPerPurchase: number; rewardThreshold: number; };

export const STAFF_ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  OWNER: [
    "BACKOFFICE_VIEW",
    "SCAN",
    "PROGRAM_WRITE",
    "CUSTOMER_WRITE",
    "STAFF_WRITE",
    "MANAGER_WRITE",
    "TRANSACTION_REVERSE",
    "ESTABLISHMENT_WRITE",
    "ESTABLISHMENT_SUSPEND",
    "BILLING_WRITE",
  ],
  MANAGER: [
    "BACKOFFICE_VIEW",
    "SCAN",
    "PROGRAM_WRITE",
    "CUSTOMER_WRITE",
    "STAFF_WRITE",
    "TRANSACTION_REVERSE",
    "ESTABLISHMENT_WRITE",
  ],
  EMPLOYEE: ["SCAN"],
  VIEWER: ["BACKOFFICE_VIEW"],
};

export function hasStaffPermission(role: StaffRole, permission: StaffPermission): boolean {
  return STAFF_ROLE_PERMISSIONS[role].includes(permission);
}

export function parseCardToken(input: unknown): string | null { if (typeof input !== "string") return null; const trimmed=input.trim(); const raw=trimmed.startsWith("LOY1:")?trimmed.slice(5):trimmed; return /^[A-Za-z0-9_-]{20,64}$/.test(raw)?raw:null; }
export function isValidIdempotencyKey(input: unknown): input is string { return typeof input === "string" && /^[A-Za-z0-9:_-]{8,128}$/.test(input); }
export function computeEarnDelta(rules: LoyaltyProgramRules,input:{purchaseAmountCents?:number}):number { if(rules.mode==="STAMPS") return Math.max(1,Math.floor(rules.stampsPerVisit||1)); if(rules.pointsRule==="PER_EURO"){const cents=Number(input.purchaseAmountCents); if(!Number.isFinite(cents)||cents<=0||rules.pointsPerEuro<=0)return 0; return Math.max(0,Math.floor((cents/100)*rules.pointsPerEuro));} return Math.max(1,Math.floor(rules.pointsPerPurchase||1)); }
export function unitLabel(mode:LoyaltyMode,count:number):string{const word=mode==="STAMPS"?"tampon":"point";return `${count} ${word}${count>1?"s":""}`;}

export function canManageProgram(role:StaffRole):boolean{return hasStaffPermission(role,"PROGRAM_WRITE");}
export function canManageCustomers(role:StaffRole):boolean{return hasStaffPermission(role,"CUSTOMER_WRITE");}
export function canManageStaff(role:StaffRole):boolean{return hasStaffPermission(role,"STAFF_WRITE");}
export function canManageManagers(role:StaffRole):boolean{return hasStaffPermission(role,"MANAGER_WRITE");}
export function canManageEstablishment(role:StaffRole):boolean{return hasStaffPermission(role,"ESTABLISHMENT_WRITE");}
export function canManageBilling(role:StaffRole):boolean{return hasStaffPermission(role,"BILLING_WRITE");}
export function canAccessBackoffice(role:StaffRole):boolean{return hasStaffPermission(role,"BACKOFFICE_VIEW");}
export function canScan(role:StaffRole):boolean{return hasStaffPermission(role,"SCAN");}
export function canReverse(role:StaffRole):boolean{return hasStaffPermission(role,"TRANSACTION_REVERSE");}
export function canSuspendEstablishment(role:StaffRole):boolean{return hasStaffPermission(role,"ESTABLISHMENT_SUSPEND");}

export function canAssignStaffRole(actorRole: StaffRole, targetRole: StaffRole): boolean {
  if (targetRole === "OWNER") return false;
  if (targetRole === "MANAGER") return canManageManagers(actorRole);
  return canManageStaff(actorRole);
}

export function canManageStaffTarget(actorRole: StaffRole, targetRole: StaffRole): boolean {
  if (targetRole === "OWNER") return false;
  if (targetRole === "MANAGER") return canManageManagers(actorRole);
  return canManageStaff(actorRole);
}

export function staffRoleLabel(role:StaffRole):string {
  if (role==="OWNER") return "Propriétaire";
  if (role==="MANAGER") return "Manager";
  if (role==="EMPLOYEE") return "Employé";
  return "Lecture seule";
}
