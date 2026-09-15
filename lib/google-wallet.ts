import { JWT } from "google-auth-library";
import { importPKCS8, SignJWT } from "jose";
import { getAppUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";
import type { WalletCard } from "@/lib/wallet-data";

const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";

type ServiceAccount = { client_email: string; private_key: string };

export function googleWalletEnabled() {
  return process.env.GOOGLE_WALLET_ENABLED === "true";
}

export function sanitizeGoogleWalletId(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function config() {
  if (!googleWalletEnabled()) throw new Error("GOOGLE_WALLET_DISABLED");
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const encoded = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64;
  if (!issuerId || !encoded) throw new Error("GOOGLE_WALLET_NOT_CONFIGURED");
  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_WALLET_BAD_CREDENTIALS");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error("GOOGLE_WALLET_BAD_CREDENTIALS");
  return { issuerId, serviceAccount };
}

function ids(card: WalletCard) {
  const { issuerId } = config();
  return {
    classId: `${issuerId}.${sanitizeGoogleWalletId(`fidgo_${card.restaurantSlug}`)}`,
    objectId: `${issuerId}.${sanitizeGoogleWalletId(`card_${card.cardId}`)}`,
  };
}

async function accessToken() {
  const { serviceAccount } = config();
  const client = new JWT({ email: serviceAccount.client_email, key: serviceAccount.private_key, scopes: [WALLET_SCOPE] });
  const credentials = await client.authorize();
  if (!credentials.access_token) throw new Error("GOOGLE_WALLET_AUTH_FAILED");
  return credentials.access_token;
}

async function walletFetch(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  return fetch(`${WALLET_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
}

function logoUri() {
  const base = getAppUrl();
  if (!base) throw new Error("APP_URL is required");
  return `${base}/wallet-logo.png`;
}

function classBody(card: WalletCard) {
  const { classId } = ids(card);
  return {
    id: classId,
    issuerName: card.restaurantName.slice(0, 20),
    reviewStatus: "UNDER_REVIEW",
    programName: card.programName.slice(0, 20),
    programLogo: {
      sourceUri: { uri: logoUri() },
      contentDescription: { defaultValue: { language: "fr-FR", value: `Logo ${card.restaurantName}` } },
    },
    accountNameLabel: "Client",
    accountIdLabel: "Carte",
    hexBackgroundColor: /^#[0-9a-fA-F]{6}$/.test(card.primaryColor) ? card.primaryColor : "#111827",
  };
}

function objectBody(card: WalletCard) {
  const { classId, objectId } = ids(card);
  const base = getAppUrl();
  return {
    id: objectId,
    classId,
    state: "ACTIVE",
    accountName: (card.firstName || "Client Fidgo").slice(0, 20),
    accountId: card.shortCode.slice(0, 20),
    loyaltyPoints: { label: card.mode === "STAMPS" ? "Tampons" : "Points", balance: { int: card.balance } },
    barcode: { type: "QR_CODE", value: `LOY1:${card.token}`, alternateText: card.shortCode },
    textModulesData: [
      { id: "reward", header: "Récompense", body: card.balance >= card.rewardThreshold ? `Disponible : ${card.rewardLabel}` : `${card.rewardThreshold - card.balance} restant(s) avant ${card.rewardLabel}` },
    ],
    linksModuleData: base ? { uris: [{ uri: `${base}/c/${card.token}`, description: "Voir ma carte Fidgo" }] } : undefined,
  };
}

export async function ensureGoogleWalletObject(card: WalletCard) {
  const { classId, objectId } = ids(card);
  const classGet = await walletFetch(`/loyaltyClass/${encodeURIComponent(classId)}`);
  if (classGet.status === 404) {
    const created = await walletFetch("/loyaltyClass", { method: "POST", body: JSON.stringify(classBody(card)) });
    if (!created.ok) throw new Error(`GOOGLE_CLASS_${created.status}:${await created.text()}`);
  } else if (!classGet.ok) {
    throw new Error(`GOOGLE_CLASS_${classGet.status}:${await classGet.text()}`);
  }

  const objectGet = await walletFetch(`/loyaltyObject/${encodeURIComponent(objectId)}`);
  if (objectGet.status === 404) {
    const created = await walletFetch("/loyaltyObject", { method: "POST", body: JSON.stringify(objectBody(card)) });
    if (!created.ok) throw new Error(`GOOGLE_OBJECT_${created.status}:${await created.text()}`);
  } else if (objectGet.ok) {
    const updated = await walletFetch(`/loyaltyObject/${encodeURIComponent(objectId)}`, { method: "PATCH", body: JSON.stringify(objectBody(card)) });
    if (!updated.ok) throw new Error(`GOOGLE_OBJECT_PATCH_${updated.status}:${await updated.text()}`);
  } else {
    throw new Error(`GOOGLE_OBJECT_${objectGet.status}:${await objectGet.text()}`);
  }

  await sql`
    insert into wallet_passes(establishment_id,card_id,provider,external_id,status,last_synced_at)
    values(${card.establishmentId},${card.cardId},'GOOGLE',${objectId},'active',now())
    on conflict(card_id,provider) do update set external_id=excluded.external_id,status='active',last_synced_at=now(),last_error=null,updated_at=now()
  `;
  return { classId, objectId };
}

export async function googleWalletSaveLink(card: WalletCard) {
  const { objectId, classId } = await ensureGoogleWalletObject(card);
  const { serviceAccount } = config();
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const appUrl = getAppUrl();
  if (!appUrl) throw new Error("APP_URL is required");
  const origin = new URL(appUrl).origin;
  const jwt = await new SignJWT({
    typ: "savetowallet",
    origins: [origin],
    payload: { loyaltyObjects: [{ id: objectId, classId }] },
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience("google")
    .setIssuedAt()
    .sign(privateKey);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

export async function syncGoogleWallet(card: WalletCard) {
  if (!googleWalletEnabled()) return;
  try {
    await ensureGoogleWalletObject(card);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "GOOGLE_WALLET_SYNC_FAILED";
    await sql`update wallet_passes set status='error',last_error=${message},updated_at=now() where card_id=${card.cardId} and provider='GOOGLE'`;
  }
}
