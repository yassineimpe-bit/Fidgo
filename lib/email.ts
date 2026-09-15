import { STAFF_PASSWORD_RESET_TTL_MINUTES } from "@/lib/staff-password-reset";

const RESEND_API = "https://api.resend.com/emails";

type EmailEnv = Record<string, string | undefined>;

type RecoveryEmailInput = {
  to: string;
  restaurantName: string;
  recoveryUrl: string;
};

type StaffResetEmailInput = {
  to: string;
  resetUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function recoveryEmailConfigured(env: EmailEnv = process.env) {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendCardRecoveryEmail(input: RecoveryEmailInput, env: EmailEnv = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("EMAIL_NOT_CONFIGURED");

  const restaurantName = input.restaurantName.trim().slice(0, 120) || "votre commerce";
  const safeRestaurant = escapeHtml(restaurantName);
  const safeUrl = escapeHtml(input.recoveryUrl);

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Retrouvez votre carte fidélité ${restaurantName}`,
      text: [
        `Vous avez demandé à retrouver votre carte fidélité ${restaurantName}.`,
        "",
        `Ouvrez ce lien dans les 15 minutes : ${input.recoveryUrl}`,
        "",
        "Ce lien ne fonctionne qu'une seule fois. Si vous n'avez rien demandé, ignorez cet email.",
      ].join("\n"),
      html: `<p>Vous avez demandé à retrouver votre carte fidélité <strong>${safeRestaurant}</strong>.</p><p><a href="${safeUrl}">Retrouver ma carte</a></p><p>Ce lien expire dans 15 minutes et ne fonctionne qu’une seule fois.</p><p>Si vous n’avez rien demandé, ignorez cet email.</p>`,
    }),
  });

  if (!response.ok) throw new Error(`EMAIL_SEND_${response.status}`);
}

export async function sendStaffPasswordResetEmail(input: StaffResetEmailInput, env: EmailEnv = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("EMAIL_NOT_CONFIGURED");

  const safeUrl = escapeHtml(input.resetUrl);

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Réinitialiser votre mot de passe Fidgo",
      text: [
        "Vous avez demandé à réinitialiser le mot de passe de votre espace commerçant Fidgo.",
        "",
        `Ouvrez ce lien dans les ${STAFF_PASSWORD_RESET_TTL_MINUTES} minutes : ${input.resetUrl}`,
        "",
        "Ce lien ne fonctionne qu'une seule fois. Si vous n'avez rien demandé, ignorez cet email : votre mot de passe reste inchangé.",
      ].join("\n"),
      html: `<p>Vous avez demandé à réinitialiser le mot de passe de votre espace commerçant Fidgo.</p><p><a href="${safeUrl}">Réinitialiser mon mot de passe</a></p><p>Ce lien expire dans ${STAFF_PASSWORD_RESET_TTL_MINUTES} minutes et ne fonctionne qu’une seule fois.</p><p>Si vous n’avez rien demandé, ignorez cet email : votre mot de passe reste inchangé.</p>`,
    }),
  });

  if (!response.ok) throw new Error(`EMAIL_SEND_${response.status}`);
}
