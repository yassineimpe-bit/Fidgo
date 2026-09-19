const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 3;

type EmailEnv = Record<string, string | undefined>;

export type RecoveryEmailInput = {
  to: string;
  restaurantName: string;
  recoveryUrl: string;
  idempotencyKey: string;
};

export type PasswordResetEmailInput = {
  to: string;
  resetUrl: string;
  idempotencyKey: string;
};

export type EmailDeliveryResult = {
  messageId: string;
};

type SendEmailOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
};

export class EmailDeliveryError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanSubjectPart(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function validRecoveryUrl(value: string, env: EmailEnv) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return env.NODE_ENV !== "production"
      && url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Le lien de réinitialisation de mot de passe porte son jeton en query string
 * (`?token=...`, imposé par le produit) plutôt qu'en segment de chemin comme
 * `/recover/<token>` : validRecoveryUrl rejetterait `url.search` à tort ici.
 */
function validPasswordResetUrl(value: string, env: EmailEnv) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if ([...url.searchParams.keys()].some((key) => key !== "token")) return false;
    const token = url.searchParams.get("token") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    if (url.protocol === "https:") return true;
    return env.NODE_ENV !== "production"
      && url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function retryDelay(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 5_000);
  }
  return 250 * 2 ** (attempt - 1);
}

function shouldRetry(status: number) {
  return status === 429 || status >= 500;
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function emailDocument(restaurantName: string, recoveryUrl: string) {
  const safeRestaurant = escapeHtml(restaurantName);
  const safeUrl = escapeHtml(recoveryUrl);
  return `<!doctype html>
<html lang="fr" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Retrouvez votre carte de fidélité</title>
  </head>
  <body lang="fr" dir="ltr" style="margin:0;background:#f6f7f9;color:#172033;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Votre lien Retiko sécurisé expire dans 15 minutes.</div>
    <main style="max-width:600px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px 24px;">
        <p style="margin:0 0 20px;color:#5b6475;font-weight:700;">RETIKO</p>
        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;">Retrouvez votre carte de fidélité</h1>
        <p style="margin:0 0 24px;line-height:1.6;">Vous avez demandé à retrouver votre carte chez <strong>${safeRestaurant}</strong>.</p>
        <p style="margin:0 0 24px;">
          <a href="${safeUrl}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:14px 22px;">Ouvrir ma carte de fidélité</a>
        </p>
        <p style="margin:0 0 12px;line-height:1.6;">Ce lien expire dans 15 minutes et ne fonctionne qu’une seule fois.</p>
        <p style="margin:0;line-height:1.6;color:#5b6475;">Vous n’avez pas demandé cet email ? Vous pouvez l’ignorer en toute sécurité.</p>
      </div>
    </main>
  </body>
</html>`;
}

function passwordResetDocument(resetUrl: string) {
  const safeUrl = escapeHtml(resetUrl);
  return `<!doctype html>
<html lang="fr" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Réinitialisez votre mot de passe Retiko</title>
  </head>
  <body lang="fr" dir="ltr" style="margin:0;background:#f6f7f9;color:#172033;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ce lien de réinitialisation expire dans 30 minutes.</div>
    <main style="max-width:600px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border-radius:16px;padding:32px 24px;">
        <p style="margin:0 0 20px;color:#5b6475;font-weight:700;">RETIKO</p>
        <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;">Réinitialisez votre mot de passe</h1>
        <p style="margin:0 0 24px;line-height:1.6;">Une demande de réinitialisation de mot de passe a été effectuée pour votre espace commerçant Retiko.</p>
        <p style="margin:0 0 24px;">
          <a href="${safeUrl}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:14px 22px;">Choisir un nouveau mot de passe</a>
        </p>
        <p style="margin:0 0 12px;line-height:1.6;">Ce lien expire dans 30 minutes et ne fonctionne qu’une seule fois.</p>
        <p style="margin:0;line-height:1.6;color:#5b6475;">Vous n’avez pas demandé cette réinitialisation ? Vous pouvez ignorer cet email en toute sécurité : votre mot de passe actuel reste inchangé.</p>
      </div>
    </main>
  </body>
</html>`;
}

export function recoveryEmailConfigured(env: EmailEnv = process.env) {
  return Boolean(
    env.RESEND_API_KEY?.trim()
    && env.EMAIL_FROM?.trim()
    && env.EMAIL_REPLY_TO?.trim(),
  );
}

export async function sendCardRecoveryEmail(
  input: RecoveryEmailInput,
  env: EmailEnv = process.env,
  options: SendEmailOptions = {},
): Promise<EmailDeliveryResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const replyTo = env.EMAIL_REPLY_TO?.trim();
  if (!apiKey || !from || !replyTo) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");

  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new EmailDeliveryError("EMAIL_INVALID_RECIPIENT");
  if (!validRecoveryUrl(input.recoveryUrl, env)) throw new EmailDeliveryError("EMAIL_INVALID_RECOVERY_URL");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.idempotencyKey)) {
    throw new EmailDeliveryError("EMAIL_INVALID_IDEMPOTENCY_KEY");
  }

  const restaurantName = cleanSubjectPart(input.restaurantName) || "votre commerce";
  const payload = {
    from,
    to: [to],
    reply_to: replyTo,
    subject: `Retrouvez votre carte fidélité ${restaurantName}`,
    text: [
      "Retrouvez votre carte de fidélité",
      "",
      `Vous avez demandé à retrouver votre carte chez ${restaurantName}.`,
      "",
      `Ouvrir ma carte de fidélité : ${input.recoveryUrl}`,
      "",
      "Ce lien expire dans 15 minutes et ne fonctionne qu'une seule fois.",
      "Vous n'avez pas demandé cet email ? Vous pouvez l'ignorer en toute sécurité.",
    ].join("\n"),
    html: emailDocument(restaurantName, input.recoveryUrl),
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetchImpl(RESEND_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        const result = await response.json().catch(() => null) as { id?: unknown } | null;
        const messageId = typeof result?.id === "string" ? result.id.trim().slice(0, 200) : "";
        if (!messageId) throw new EmailDeliveryError("EMAIL_INVALID_RESPONSE");
        return { messageId };
      }

      if (!shouldRetry(response.status) || attempt === maxAttempts) {
        throw new EmailDeliveryError(`EMAIL_SEND_${response.status}`);
      }
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      if (attempt === maxAttempts) {
        const code = controller.signal.aborted ? "EMAIL_SEND_TIMEOUT" : "EMAIL_SEND_NETWORK";
        throw new EmailDeliveryError(code);
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(retryDelay(response, attempt));
  }

  throw new EmailDeliveryError("EMAIL_SEND_FAILED");
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
  env: EmailEnv = process.env,
  options: SendEmailOptions = {},
): Promise<EmailDeliveryResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const replyTo = env.EMAIL_REPLY_TO?.trim();
  if (!apiKey || !from || !replyTo) throw new EmailDeliveryError("EMAIL_NOT_CONFIGURED");

  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new EmailDeliveryError("EMAIL_INVALID_RECIPIENT");
  if (!validPasswordResetUrl(input.resetUrl, env)) throw new EmailDeliveryError("EMAIL_INVALID_RECOVERY_URL");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.idempotencyKey)) {
    throw new EmailDeliveryError("EMAIL_INVALID_IDEMPOTENCY_KEY");
  }

  const payload = {
    from,
    to: [to],
    reply_to: replyTo,
    subject: "Réinitialisez votre mot de passe Retiko",
    text: [
      "Réinitialisez votre mot de passe",
      "",
      "Une demande de réinitialisation de mot de passe a été effectuée pour votre espace commerçant Retiko.",
      "",
      `Choisir un nouveau mot de passe : ${input.resetUrl}`,
      "",
      "Ce lien expire dans 30 minutes et ne fonctionne qu'une seule fois.",
      "Vous n'avez pas demandé cette réinitialisation ? Vous pouvez ignorer cet email en toute sécurité : votre mot de passe actuel reste inchangé.",
    ].join("\n"),
    html: passwordResetDocument(input.resetUrl),
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? wait;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetchImpl(RESEND_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        const result = await response.json().catch(() => null) as { id?: unknown } | null;
        const messageId = typeof result?.id === "string" ? result.id.trim().slice(0, 200) : "";
        if (!messageId) throw new EmailDeliveryError("EMAIL_INVALID_RESPONSE");
        return { messageId };
      }

      if (!shouldRetry(response.status) || attempt === maxAttempts) {
        throw new EmailDeliveryError(`EMAIL_SEND_${response.status}`);
      }
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      if (attempt === maxAttempts) {
        const code = controller.signal.aborted ? "EMAIL_SEND_TIMEOUT" : "EMAIL_SEND_NETWORK";
        throw new EmailDeliveryError(code);
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(retryDelay(response, attempt));
  }

  throw new EmailDeliveryError("EMAIL_SEND_FAILED");
}
