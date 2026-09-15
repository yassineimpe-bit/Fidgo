import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import type { StaffRole } from "@/lib/loyalty";

const COOKIE = "loyalty_staff";

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(process.env.AUTH_SECRET);
}

export type StaffSession = {
  staffId: string;
  establishmentId: string;
  email: string;
  role: StaffRole;
};

export async function signSession(session: StaffSession) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export function sessionCookie(value: string) {
  return {
    name: COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

async function decodeSession(): Promise<StaffSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      staffId: String(payload.staffId),
      establishmentId: String(payload.establishmentId),
      email: String(payload.email),
      role: String(payload.role || "EMPLOYEE") as StaffRole,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<StaffSession | null> {
  const decoded = await decodeSession();
  if (!decoded) return null;
  const [current] = await sql`
    select s.id, s.establishment_id, s.email, s.role
    from staff_users s
    join establishments e on e.id = s.establishment_id
    where s.id = ${decoded.staffId}
      and s.establishment_id = ${decoded.establishmentId}
      and s.active = true
      and e.status = 'active'
    limit 1
  `;
  if (!current) return null;
  return {
    staffId: String(current.id),
    establishmentId: String(current.establishment_id),
    email: String(current.email),
    role: String(current.role) as StaffRole,
  };
}
