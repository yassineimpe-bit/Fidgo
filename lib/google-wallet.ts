import { JWT } from "google-auth-library";
import { importPKCS8, SignJWT } from "jose";
import { getAppUrl } from "@/lib/app-url";
import { cardImagePath } from "@/lib/card-image-path";
import { sql } from "@/lib/db";
import { isValidGoogleIssuerId } from "@/lib/google-wallet-config";
import { walletCardForRevocationById, type WalletCard } from "@/lib/wallet-data";
import { safeErrorCode, sanitizeAuditText } from "@/lib/observability";

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("fr-FR") + value.slice(1);
}

const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";
const GOOGLE_ERROR_BODY_LIMIT = 16_384;

type GoogleWalletOperation =
  | "GOOGLE_CLASS_GET"
  | "GOOGLE_CLASS_CREATE"
  | "GOOGLE_OBJECT_GET"
  | "GOOGLE_OBJECT_CREATE"
  | "GOOGLE_OBJECT_PATCH"
  | "GOOGLE_OBJECT_REVOKE";

type GoogleWalletProviderDiagnostic = {
  operation: GoogleWalletOperation;
  status: number;
  googleCode?: string;
  reason?: string;
  message?: string;
};

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
  if (!isValidGoogleIssuerId(issuerId)) throw new Error("GOOGLE_WALLET_BAD_ISSUER_ID");
  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_WALLET_BAD_CREDENTIALS");
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error("GOOGLE_WALLET_BAD_CREDENTIALS");
  return { issuerId: issuerId.trim(), serviceAccount };
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

class GoogleWalletProviderError extends Error {
  readonly code: string;

  constructor(readonly diagnostic: GoogleWalletProviderDiagnostic) {
    const code = `${diagnostic.operation}_${diagnostic.status}`;
    super(code);
    this.name = "GoogleWalletProviderError";
    this.code = code;
  }
}

function sanitizeProviderDiagnostic(
  value: unknown,
  sensitiveValues: string[],
  maxLength: number,
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  let text = String(value);
  for (const sensitive of sensitiveValues) {
    if (sensitive) text = text.split(sensitive).join("[redacted]");
  }
  text = text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gi, "[secret]")
    .replace(/\b(?:private_key|access_token|service_account_json)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "[secret]")
    .replace(/\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;}"']+/gi, "Authorization=[secret]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt]")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[secret]");
  const sanitized = sanitizeAuditText(text, maxLength);
  return sanitized || undefined;
}

async function googleWalletProviderError(
  operation: GoogleWalletOperation,
  response: Response,
  sensitiveValues: string[] = [],
) {
  let providerError: Record<string, unknown> | undefined;
  try {
    const raw = (await response.text()).slice(0, GOOGLE_ERROR_BODY_LIMIT);
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)) {
      providerError = parsed.error as Record<string, unknown>;
    }
  } catch {
    // Le corps brut n'est jamais journalisé : un fournisseur peut y recopier
    // un header, un credential ou un payload sensible.
  }

  const firstDetail = Array.isArray(providerError?.errors)
    ? providerError.errors.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined
    : undefined;
  const diagnostic: GoogleWalletProviderDiagnostic = {
    operation,
    status: response.status,
    googleCode: sanitizeProviderDiagnostic(providerError?.status ?? providerError?.code, sensitiveValues, 64),
    reason: sanitizeProviderDiagnostic(firstDetail?.reason ?? providerError?.status, sensitiveValues, 80),
    message: sanitizeProviderDiagnostic(providerError?.message, sensitiveValues, 240),
  };
  console.error("GOOGLE_WALLET_PROVIDER_ERROR", diagnostic);
  return new GoogleWalletProviderError(diagnostic);
}

class GoogleWalletCardRevokedError extends Error {
  constructor() {
    super("GOOGLE_WALLET_CARD_REVOKED");
    this.name = "GoogleWalletCardRevokedError";
  }
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

export function objectBody(card: WalletCard, state: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  const { classId, objectId } = ids(card);
  const base = getAppUrl();
  return {
    id: objectId,
    classId,
    state,
    accountName: (card.firstName || "Client Retiko").slice(0, 20),
    accountId: card.shortCode,
    loyaltyPoints: card.mode === "STAMPS"
      ? { label: capitalize(card.units.plural), balance: { string: `${card.balance}/${card.rewardThreshold}` } }
      : { label: capitalize(card.units.plural), balance: { string: `${card.balance}` } },
    secondaryLoyaltyPoints: {
      label: card.rewardLabel,
      balance: {
        string: card.balance >= card.rewardThreshold
          ? "Disponible"
          : `${card.rewardThreshold - card.balance} restant(s)`,
      },
    },
    barcode: { type: "QR_CODE", value: `LOY1:${card.token}`, alternateText: card.shortCode },
    linksModuleData: base ? { uris: [{ uri: `${base}/c/${card.token}`, description: "Voir ma carte Retiko" }] } : undefined,
    // Visuel du commerce en bannière : porté par l'objet, mis à jour à chaque synchronisation.
    heroImage: base && card.cardImageId ? {
      sourceUri: { uri: `${base}${cardImagePath(card.cardImageId)}` },
      contentDescription: { defaultValue: { language: "fr-FR", value: `Visuel ${card.restaurantName}` } },
    } : undefined,
  };
}

async function persistGoogleWalletAfterProvider(card: WalletCard, objectId: string) {
  return sql.begin(async (tx) => {
    const [active] = await tx`
      select c.id
      from cards c
      join customers u on u.id=c.customer_id
      join establishments e on e.id=c.establishment_id
      join loyalty_programs p on p.establishment_id=c.establishment_id
      where c.id=${card.cardId} and c.establishment_id=${card.establishmentId}
        and c.active=true and (c.expires_at is null or c.expires_at > now())
        and u.deleted_at is null and e.status='active' and p.active=true
      for update of c
    `;

    if (!active) {
      const [walletPass] = await tx`
        insert into wallet_passes(establishment_id,card_id,provider,external_id,status,last_error,updated_at)
        values(${card.establishmentId},${card.cardId},'GOOGLE',${objectId},'revoked',null,now())
        on conflict(card_id,provider) do update set
          external_id=excluded.external_id,status='revoked',last_error=null,updated_at=now()
        returning id
      `;
      return { active: false as const, walletPassId: String(walletPass.id) };
    }

    await tx`
      insert into wallet_passes(establishment_id,card_id,provider,external_id,status,last_synced_at)
      values(${card.establishmentId},${card.cardId},'GOOGLE',${objectId},'active',now())
      on conflict(card_id,provider) do update set
        external_id=excluded.external_id,status='active',last_synced_at=now(),last_error=null,updated_at=now()
    `;
    return { active: true as const, walletPassId: null };
  });
}

async function deactivateGoogleWalletObject(card: WalletCard, objectId: string, walletPassId?: string) {
  try {
    const updated = await walletFetch(`/loyaltyObject/${encodeURIComponent(objectId)}`, {
      method: "PATCH",
      body: JSON.stringify(objectBody(card, "INACTIVE")),
    });
    if (!updated.ok) throw await googleWalletProviderError("GOOGLE_OBJECT_REVOKE", updated, [card.token]);
    if (walletPassId) {
      await sql`
        update wallet_passes set status='revoked',last_synced_at=now(),last_error=null,updated_at=now()
        where id=${walletPassId}
      `;
    }
  } catch (error) {
    if (walletPassId) {
      const code = safeErrorCode(error, "GOOGLE_WALLET_REVOKE_FAILED");
      await sql`
        update wallet_passes set status='revoked',last_error=${code},updated_at=now()
        where id=${walletPassId}
      `;
    }
    throw error;
  }
}

export async function ensureGoogleWalletObject(card: WalletCard) {
  const { classId, objectId } = ids(card);
  const classGet = await walletFetch(`/loyaltyClass/${encodeURIComponent(classId)}`);
  if (classGet.status === 404) {
    const created = await walletFetch("/loyaltyClass", { method: "POST", body: JSON.stringify(classBody(card)) });
    if (!created.ok) throw await googleWalletProviderError("GOOGLE_CLASS_CREATE", created, [card.token]);
  } else if (!classGet.ok) {
    throw await googleWalletProviderError("GOOGLE_CLASS_GET", classGet, [card.token]);
  }

  const objectGet = await walletFetch(`/loyaltyObject/${encodeURIComponent(objectId)}`);
  if (objectGet.status === 404) {
    const created = await walletFetch("/loyaltyObject", { method: "POST", body: JSON.stringify(objectBody(card)) });
    if (!created.ok) throw await googleWalletProviderError("GOOGLE_OBJECT_CREATE", created, [card.token]);
  } else if (objectGet.ok) {
    const updated = await walletFetch(`/loyaltyObject/${encodeURIComponent(objectId)}`, { method: "PATCH", body: JSON.stringify(objectBody(card)) });
    if (!updated.ok) throw await googleWalletProviderError("GOOGLE_OBJECT_PATCH", updated, [card.token]);
  } else {
    throw await googleWalletProviderError("GOOGLE_OBJECT_GET", objectGet, [card.token]);
  }

  let persisted: Awaited<ReturnType<typeof persistGoogleWalletAfterProvider>>;
  try {
    persisted = await persistGoogleWalletAfterProvider(card, objectId);
  } catch (error) {
    // Le provider a déjà rendu l'objet ACTIVE. Si la revalidation DB échoue,
    // on échoue fermé côté Wallet au lieu de laisser un objet actif orphelin.
    await deactivateGoogleWalletObject(card, objectId).catch(() => undefined);
    throw error;
  }
  if (!persisted.active) {
    await deactivateGoogleWalletObject(card, objectId, persisted.walletPassId);
    throw new GoogleWalletCardRevokedError();
  }
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
    if (error instanceof GoogleWalletCardRevokedError) return;
    const code = safeErrorCode(error, "GOOGLE_WALLET_SYNC_FAILED");
    await sql`
      update wallet_passes set status='error',last_error=${code},updated_at=now()
      where card_id=${card.cardId} and provider='GOOGLE' and status<>'revoked'
    `;
  }
}

/**
 * Contrepartie Google de notifyAppleWalletRevocation() : sans cet appel, une
 * carte révoquée (établissement suspendu, client effacé) laisse un objet
 * Google Wallet visible et actif dans le portefeuille du client alors que le
 * pass Apple équivalent affiche déjà "Désactivée". On bascule ici l'objet
 * existant sur state=INACTIVE, ce qui le grise dans Google Wallet.
 */
export async function notifyGoogleWalletRevocation(cardId: string) {
  if (!googleWalletEnabled()) return;
  const [walletPass] = await sql`
    select id,external_id from wallet_passes
    where card_id=${cardId} and provider='GOOGLE'
    limit 1
  `;
  if (!walletPass) return;
  const card = await walletCardForRevocationById(cardId);
  if (!card) return;
  const objectId = walletPass.external_id ? String(walletPass.external_id) : ids(card).objectId;
  try {
    await deactivateGoogleWalletObject(card, objectId, String(walletPass.id));
  } catch {
    // deactivateGoogleWalletObject conserve déjà la ligne en revoked et y
    // enregistre l'erreur pour qu'une relance ne perde jamais l'intention.
  }
}
