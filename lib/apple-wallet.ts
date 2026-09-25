import { createHash, createHmac } from "node:crypto";
import { connect } from "node:http2";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PKPass } from "passkit-generator";
import { getAppUrl } from "@/lib/app-url";
import { sql } from "@/lib/db";
import { safeErrorCode } from "@/lib/observability";
import type { WalletCard } from "@/lib/wallet-data";

export function appleWalletEnabled() {
  return process.env.APPLE_WALLET_ENABLED === "true";
}

function config() {
  if (!appleWalletEnabled()) throw new Error("APPLE_WALLET_DISABLED");
  const passTypeIdentifier = process.env.APPLE_PASS_TYPE_IDENTIFIER;
  const teamIdentifier = process.env.APPLE_TEAM_IDENTIFIER;
  const wwdr = process.env.APPLE_WWDR_CERT_BASE64;
  const signerCert = process.env.APPLE_SIGNER_CERT_BASE64;
  const signerKey = process.env.APPLE_SIGNER_KEY_BASE64;
  if (!passTypeIdentifier || !teamIdentifier || !wwdr || !signerCert || !signerKey) throw new Error("APPLE_WALLET_NOT_CONFIGURED");
  return {
    passTypeIdentifier,
    teamIdentifier,
    wwdr: Buffer.from(wwdr, "base64"),
    signerCert: Buffer.from(signerCert, "base64"),
    signerKey: Buffer.from(signerKey, "base64"),
    signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE || undefined,
  };
}

export function appleAuthenticationToken(cardToken: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret).update(`fidgo:apple:${cardToken}`).digest("base64url");
}

export function appleAuthenticationTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function rgb(hex: string) {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "111827";
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
}

// Lu depuis le disque plutot que via un fetch HTTP vers l'app elle-meme :
// un aller-retour reseau vers sa propre instance est un point de panne
// inutile (auto-appel serverless, cold start, absence de NEXT_PUBLIC_APP_URL
// en previw) pour un fichier statique deja present dans le bundle.
let cachedWalletImage: Buffer | null = null;
async function walletImage() {
  if (!cachedWalletImage) {
    cachedWalletImage = await readFile(join(process.cwd(), "public", "wallet-logo.png"));
  }
  return cachedWalletImage;
}

async function renderApplePass(card: WalletCard, authToken: string, revoked: boolean) {
  const cfg = config();
  const appUrl = getAppUrl();
  if (!appUrl) throw new Error("APP_URL is required");
  const image = await walletImage();

  const pass = new PKPass(
    { "icon.png": image, "icon@2x.png": image, "icon@3x.png": image, "logo.png": image, "logo@2x.png": image, "logo@3x.png": image },
    { wwdr: cfg.wwdr, signerCert: cfg.signerCert, signerKey: cfg.signerKey, signerKeyPassphrase: cfg.signerKeyPassphrase },
    {
      formatVersion: 1,
      passTypeIdentifier: cfg.passTypeIdentifier,
      teamIdentifier: cfg.teamIdentifier,
      serialNumber: card.cardId,
      organizationName: card.restaurantName,
      description: `${card.programName} - Retiko`,
      logoText: card.restaurantName,
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(229, 231, 235)",
      backgroundColor: rgb(card.primaryColor),
      webServiceURL: `${appUrl}/api/wallet/apple/web`,
      authenticationToken: authToken,
      voided: revoked,
    },
  );

  pass.type = "storeCard";
  if (revoked) {
    pass.primaryFields.push({ key: "status", label: "CARTE", value: "Désactivée" });
    pass.secondaryFields.push({ key: "detail", label: "STATUT", value: "Cette carte n’est plus utilisable" });
    pass.backFields.push({ key: "revoked", label: "Information", value: "Cette carte Retiko a été révoquée par le commerce." });
  } else {
    pass.primaryFields.push({
      key: "balance",
      label: card.units.plural.toLocaleUpperCase("fr-FR"),
      value: card.balance,
    });
    pass.secondaryFields.push({
      key: "reward",
      label: "RÉCOMPENSE",
      value: card.balance >= card.rewardThreshold ? "Disponible" : `${card.rewardThreshold - card.balance} restant(s)`,
    });
    pass.auxiliaryFields.push({ key: "code", label: "CARTE", value: card.shortCode });
    pass.backFields.push(
      { key: "rewardDetail", label: "Récompense", value: card.rewardLabel },
      { key: "program", label: "Programme", value: card.programName },
    );
    if (card.cardMessage) pass.backFields.push({ key: "message", label: "Message", value: card.cardMessage });
    pass.backFields.push({ key: "web", label: "Carte en ligne", value: `${appUrl}/c/${card.token}` });
    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: `LOY1:${card.token}`,
      messageEncoding: "iso-8859-1",
      altText: card.shortCode,
    });
  }

  return pass.getAsBuffer();
}

export async function buildApplePass(card: WalletCard) {
  const cfg = config();
  const authToken = appleAuthenticationToken(card.token);
  const buffer = await renderApplePass(card, authToken, false);

  await sql.begin(async (tx) => {
    const [active] = await tx`
      select c.id
      from cards c
      join customers u on u.id=c.customer_id
      join establishments e on e.id=c.establishment_id
      join loyalty_programs p on p.establishment_id=c.establishment_id
      where c.id=${card.cardId} and c.establishment_id=${card.establishmentId}
        and c.active=true and u.deleted_at is null and e.status='active' and p.active=true
      for update of c
    `;
    if (!active) throw new Error("CARD_NOT_ACTIVE");
    await tx`
      insert into wallet_passes(establishment_id,card_id,provider,external_id,serial_number,authentication_token_hash,status,last_synced_at)
      values(${card.establishmentId},${card.cardId},'APPLE',${cfg.passTypeIdentifier},${card.cardId},${appleAuthenticationTokenHash(authToken)},'active',now())
      on conflict(card_id,provider) do update set external_id=excluded.external_id,serial_number=excluded.serial_number,authentication_token_hash=excluded.authentication_token_hash,status='active',last_synced_at=now(),last_error=null,updated_at=now()
    `;
  });
  return buffer;
}

export async function buildRevokedApplePass(card: WalletCard, authenticationToken: string) {
  return renderApplePass(card, authenticationToken, true);
}

async function sendPassPush(pushToken: string) {
  const cfg = config();
  return new Promise<void>((resolve, reject) => {
    const client = connect("https://api.push.apple.com", { cert: cfg.signerCert, key: cfg.signerKey, passphrase: cfg.signerKeyPassphrase });
    client.once("error", reject);
    const request = client.request({ ":method": "POST", ":path": `/3/device/${pushToken}`, "apns-topic": cfg.passTypeIdentifier });
    let status = 0;
    request.on("response", (headers) => { status = Number(headers[":status"] || 0); });
    request.on("data", () => {});
    request.on("end", () => {
      client.close();
      if (status === 200) resolve(); else reject(new Error(`APPLE_APNS_${status}`));
    });
    request.end("{}");
  });
}

export async function notifyAppleWalletRevocation(cardId: string) {
  if (!appleWalletEnabled()) return;
  const [walletPass] = await sql`
    select id from wallet_passes
    where card_id=${cardId} and provider='APPLE' and status='revoked'
    limit 1
  `;
  if (!walletPass) return;
  const registrations = await sql`
    select push_token from apple_wallet_registrations
    where wallet_pass_id=${walletPass.id}
  `;
  const failures: string[] = [];
  await Promise.all(registrations.map(async (row) => {
    try {
      await sendPassPush(String(row.push_token));
    } catch (error) {
      failures.push(safeErrorCode(error, "APPLE_APNS_FAILED"));
    }
  }));
  await sql`
    update wallet_passes
    set last_synced_at=now(),last_error=${failures.length ? failures.join(" | ").slice(0, 1000) : null},updated_at=now()
    where id=${walletPass.id}
  `;
}

export async function notifyAppleWallet(cardId: string) {
  if (!appleWalletEnabled()) return;
  const [walletPass] = await sql`select id from wallet_passes where card_id=${cardId} and provider='APPLE' and status='active' limit 1`;
  if (!walletPass) return;
  await sql`update wallet_passes set last_synced_at=now(),updated_at=now() where id=${walletPass.id}`;
  const registrations = await sql`select push_token from apple_wallet_registrations where wallet_pass_id=${walletPass.id}`;
  const failures: string[] = [];
  await Promise.all(registrations.map(async (row) => {
    try { await sendPassPush(String(row.push_token)); }
    catch (error) { failures.push(safeErrorCode(error, "APPLE_APNS_FAILED")); }
  }));
  if (failures.length) await sql`update wallet_passes set last_error=${failures.join(" | ").slice(0, 1000)},updated_at=now() where id=${walletPass.id}`;
}

export function applePassTypeIdentifier() {
  return config().passTypeIdentifier;
}
