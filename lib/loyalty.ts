export type LoyaltyMode = "STAMPS" | "POINTS";
export type PointsRule = "PER_PURCHASE" | "PER_EURO";
export type StaffRole = "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER";
export type LoyaltyProgramRules = { mode: LoyaltyMode; pointsRule: PointsRule; stampsPerVisit: number; pointsPerEuro: number; pointsPerPurchase: number; rewardThreshold: number; };
export function parseCardToken(input: unknown): string | null { if (typeof input !== "string") return null; const trimmed=input.trim(); const raw=trimmed.startsWith("LOY1:")?trimmed.slice(5):trimmed; return /^[A-Za-z0-9_-]{20,64}$/.test(raw)?raw:null; }
export function isValidIdempotencyKey(input: unknown): input is string { return typeof input === "string" && /^[A-Za-z0-9:_-]{8,128}$/.test(input); }
export function computeEarnDelta(rules: LoyaltyProgramRules,input:{purchaseAmountCents?:number}):number { if(rules.mode==="STAMPS") return Math.max(1,Math.floor(rules.stampsPerVisit||1)); if(rules.pointsRule==="PER_EURO"){const cents=Number(input.purchaseAmountCents); if(!Number.isFinite(cents)||cents<=0||rules.pointsPerEuro<=0)return 0; return Math.max(0,Math.floor((cents/100)*rules.pointsPerEuro));} return Math.max(1,Math.floor(rules.pointsPerPurchase||1)); }
export function unitLabel(mode:LoyaltyMode,count:number):string{const word=mode==="STAMPS"?"tampon":"point";return `${count} ${word}${count>1?"s":""}`;}
export function canManageProgram(role:StaffRole):boolean{return role==="OWNER"||role==="MANAGER";}
export function canManageStaff(role:StaffRole):boolean{return role==="OWNER"||role==="MANAGER";}
export function canAccessBackoffice(role:StaffRole):boolean{return role!=="EMPLOYEE";}
export function canScan(role:StaffRole):boolean{return role!=="VIEWER";}
export function canReverse(role:StaffRole):boolean{return role==="OWNER"||role==="MANAGER";}
export function canSuspendEstablishment(role:StaffRole):boolean{return role==="OWNER";}
export function staffRoleLabel(role:StaffRole):string {
  if (role==="OWNER") return "Propriétaire";
  if (role==="MANAGER") return "Manager";
  if (role==="EMPLOYEE") return "Employé";
  return "Lecture seule";
}
