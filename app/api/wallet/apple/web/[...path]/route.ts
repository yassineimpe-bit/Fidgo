import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { applePassTypeIdentifier, buildApplePass } from "@/lib/apple-wallet";
import { walletCardById } from "@/lib/wallet-data";

export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorizedWalletPass(serialNumber: string, passTypeIdentifier: string, request: Request) {
  if (passTypeIdentifier !== applePassTypeIdentifier()) return null;
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("ApplePass ")) return null;
  const supplied = authorization.slice("ApplePass ".length).trim();
  const [walletPass] = await sql`
    select id,card_id,authentication_token_hash
    from wallet_passes
    where provider='APPLE' and serial_number=${serialNumber} and external_id=${passTypeIdentifier} and status='active'
    limit 1
  `;
  if (!walletPass || !hashEquals(tokenHash(supplied), String(walletPass.authentication_token_hash || ""))) return null;
  return walletPass;
}

function registrationPath(parts: string[]) {
  if (parts.length !== 6 || parts[0] !== "v1" || parts[1] !== "devices" || parts[3] !== "registrations") return null;
  return { device: parts[2], passType: parts[4], serial: parts[5] };
}

export async function POST(request: Request, context: Context) {
  const { path } = await context.params;
  if (path.length === 2 && path[0] === "v1" && path[1] === "log") {
    // Endpoint impose par Apple, donc non authentifiable. On accuse reception
    // sans jamais recopier le corps brut dans les logs (log injection /
    // saturation du stockage de logs par un tiers anonyme).
    const body = await request.json().catch(() => ({})) as { logs?: unknown };
    const count = Array.isArray(body.logs) ? body.logs.length : 0;
    console.warn(`Apple Wallet device log received (${count} entries)`);
    return new Response(null, { status: 200 });
  }

  const parsed = registrationPath(path);
  if (!parsed) return new Response(null, { status: 404 });
  const walletPass = await authorizedWalletPass(parsed.serial, parsed.passType, request);
  if (!walletPass) return new Response(null, { status: 401 });
  const body = await request.json().catch(() => ({})) as { pushToken?: unknown };
  const pushToken = typeof body.pushToken === "string" ? body.pushToken.trim() : "";
  if (!pushToken || pushToken.length > 512) return new Response(null, { status: 400 });

  const [existing] = await sql`select id from apple_wallet_registrations where wallet_pass_id=${walletPass.id} and device_library_identifier=${parsed.device} limit 1`;
  await sql`
    insert into apple_wallet_registrations(wallet_pass_id,device_library_identifier,push_token)
    values(${walletPass.id},${parsed.device},${pushToken})
    on conflict(wallet_pass_id,device_library_identifier) do update set push_token=excluded.push_token
  `;
  return new Response(null, { status: existing ? 200 : 201 });
}

export async function DELETE(request: Request, context: Context) {
  const { path } = await context.params;
  const parsed = registrationPath(path);
  if (!parsed) return new Response(null, { status: 404 });
  const walletPass = await authorizedWalletPass(parsed.serial, parsed.passType, request);
  if (!walletPass) return new Response(null, { status: 401 });
  await sql`delete from apple_wallet_registrations where wallet_pass_id=${walletPass.id} and device_library_identifier=${parsed.device}`;
  return new Response(null, { status: 200 });
}

export async function GET(request: Request, context: Context) {
  const { path } = await context.params;

  if (path.length === 4 && path[0] === "v1" && path[1] === "passes") {
    const passType = path[2];
    const serial = path[3];
    const walletPass = await authorizedWalletPass(serial, passType, request);
    if (!walletPass) return new Response(null, { status: 401 });
    const card = await walletCardById(String(walletPass.card_id));
    if (!card) return new Response(null, { status: 404 });
    const pass = await buildApplePass(card);
    return new Response(new Uint8Array(pass), { headers: { "content-type": "application/vnd.apple.pkpass", "cache-control": "no-store" } });
  }

  if (path.length === 5 && path[0] === "v1" && path[1] === "devices" && path[3] === "registrations") {
    const device = path[2];
    const passType = path[4];
    if (passType !== applePassTypeIdentifier()) return new Response(null, { status: 404 });
    const sinceRaw = new URL(request.url).searchParams.get("passesUpdatedSince");
    const since = sinceRaw && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : null;
    const rows = since === null
      ? await sql`
          select wp.serial_number,extract(epoch from c.updated_at)::bigint as update_tag
          from apple_wallet_registrations r
          join wallet_passes wp on wp.id=r.wallet_pass_id
          join cards c on c.id=wp.card_id
          where r.device_library_identifier=${device} and wp.provider='APPLE' and wp.external_id=${passType} and wp.status='active'
        `
      : await sql`
          select wp.serial_number,extract(epoch from c.updated_at)::bigint as update_tag
          from apple_wallet_registrations r
          join wallet_passes wp on wp.id=r.wallet_pass_id
          join cards c on c.id=wp.card_id
          where r.device_library_identifier=${device} and wp.provider='APPLE' and wp.external_id=${passType} and wp.status='active' and c.updated_at > to_timestamp(${since})
        `;
    if (!rows.length) return new Response(null, { status: 204 });
    const serialNumbers = rows.map((row) => String(row.serial_number));
    const lastUpdated = String(Math.max(...rows.map((row) => Number(row.update_tag || 0))));
    return Response.json({ serialNumbers, lastUpdated }, { headers: { "cache-control": "no-store" } });
  }

  return new Response(null, { status: 404 });
}
