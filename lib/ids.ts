import { randomBytes, randomUUID } from "crypto";
export function id() { return randomUUID(); }
export function cardToken() { return randomBytes(16).toString("base64url"); }
export function shortCode() { const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b=randomBytes(6); return Array.from(b,x=>alphabet[x%alphabet.length]).join(""); }
