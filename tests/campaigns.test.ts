import { describe, expect, it, vi } from "vitest";
import {
  CAMPAIGNS_PER_WEEK, nextCampaignAllowedAt, parseAudience, parseCampaignInput, segmentLabel,
} from "@/lib/campaigns";
import { EmailDeliveryError, campaignEmailTestMode, sendCampaignEmail } from "@/lib/email";

const valid = {
  kind: "promotion",
  segment: "all",
  subject: "  Offre  de rentrée ",
  message: "Bonjour,\r\n\r\nUn café offert cette semaine.",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
};

describe("campagnes : saisie", () => {
  it("normalise une campagne promotionnelle valide", () => {
    expect(parseCampaignInput(valid)).toEqual({
      ok: true,
      value: {
        kind: "promotion", segment: "all", inactiveDays: null, subject: "Offre de rentrée",
        message: "Bonjour,\n\nUn café offert cette semaine.", idempotencyKey: valid.idempotencyKey,
      },
    });
  });

  it("une relance cible toujours les inactifs, avec une durée autorisée", () => {
    const parsed = parseCampaignInput({ ...valid, kind: "inactive_reminder", segment: "all", inactiveDays: 60 });
    expect(parsed).toMatchObject({ ok: true, value: { kind: "inactive_reminder", segment: "inactive", inactiveDays: 60 } });
    expect(parseCampaignInput({ ...valid, kind: "inactive_reminder", inactiveDays: 45 })).toMatchObject({ ok: false, field: "inactiveDays" });
    expect(parseCampaignInput({ ...valid, segment: "inactive", inactiveDays: 30 })).toMatchObject({ ok: false, field: "segment" });
  });

  it("refuse les champs vides, trop longs, avec caractères de contrôle ou sans clé d'idempotence", () => {
    expect(parseCampaignInput({ ...valid, kind: "sms" })).toMatchObject({ ok: false, field: "kind" });
    expect(parseCampaignInput({ ...valid, segment: "everyone" })).toMatchObject({ ok: false, field: "segment" });
    expect(parseCampaignInput({ ...valid, subject: " " })).toMatchObject({ ok: false, field: "subject" });
    expect(parseCampaignInput({ ...valid, subject: "x".repeat(121) })).toMatchObject({ ok: false, field: "subject" });
    expect(parseCampaignInput({ ...valid, message: "x".repeat(2001) })).toMatchObject({ ok: false, field: "message" });
    expect(parseCampaignInput({ ...valid, message: "a\u0000b" })).toMatchObject({ ok: false, field: "message" });
    expect(parseCampaignInput({ ...valid, idempotencyKey: "short" })).toMatchObject({ ok: false, field: "idempotencyKey" });
    expect(parseCampaignInput(null)).toMatchObject({ ok: false });
    expect(parseAudience({ segment: "reward_available" })).toEqual({ ok: true, value: { segment: "reward_available", inactiveDays: null } });
    expect(parseAudience({ segment: "inactive", inactiveDays: "90" })).toEqual({ ok: true, value: { segment: "inactive", inactiveDays: 90 } });
  });

  it("libellés de ciblage", () => {
    expect(segmentLabel("inactive", 60)).toBe("Clients sans visite depuis 60 jours");
    expect(segmentLabel("all", null)).toBe("Tous les clients abonnés");
  });
});

describe("campagnes : limite hebdomadaire", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000);

  it(`autorise jusqu'à ${CAMPAIGNS_PER_WEEK} campagnes sur 7 jours glissants`, () => {
    expect(nextCampaignAllowedAt([], now)).toBeNull();
    expect(nextCampaignAllowedAt([daysAgo(1)], now)).toBeNull();
    expect(nextCampaignAllowedAt([daysAgo(8), daysAgo(9)], now)).toBeNull();
    expect(nextCampaignAllowedAt([daysAgo(1), daysAgo(3)], now)).toEqual(new Date(daysAgo(3).getTime() + 7 * 24 * 3600 * 1000));
    expect(nextCampaignAllowedAt([daysAgo(1), daysAgo(2), daysAgo(3)], now)).toEqual(new Date(daysAgo(2).getTime() + 7 * 24 * 3600 * 1000));
  });
});

describe("campagnes : e-mail", () => {
  const env = {
    NODE_ENV: "production",
    RESEND_API_KEY: "re_test_secret",
    EMAIL_FROM: "Retiko <cartes@retiko.fr>",
    EMAIL_REPLY_TO: "contact@retiko.fr",
  };
  const input = {
    to: "Client@Example.com",
    restaurantName: 'Café "Le <b>Comptoir</b>"',
    restaurantAddress: "12 rue de la Paix, Paris",
    subject: "Offre\r\nBcc: victim@example.com",
    message: "Bonjour <script>alert(1)</script>\n\nÀ bientôt",
    unsubscribeUrl: "https://retiko.fr/unsubscribe/AAAA.BBBB",
    oneClickUnsubscribeUrl: "https://retiko.fr/api/unsubscribe/AAAA.BBBB",
    idempotencyKey: "campaign-1-2",
  };

  it("envoie un e-mail avec désabonnement en un clic, expéditeur au nom du commerce, contenu échappé", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: "msg-1" }));
    expect(await sendCampaignEmail(input, env, { fetchImpl: fetchImpl as typeof fetch })).toEqual({ messageId: "msg-1" });
    const [, request] = fetchImpl.mock.calls[0];
    expect(new Headers(request?.headers).get("idempotency-key")).toBe("campaign-1-2");
    const payload = JSON.parse(String(request?.body));
    expect(payload.from).toBe('"Café Le bComptoir/b via Retiko" <cartes@retiko.fr>');
    expect(payload.to).toEqual(["client@example.com"]);
    expect(payload.subject).toBe("Offre Bcc: victim@example.com");
    expect(payload.headers).toEqual({
      "List-Unsubscribe": "<https://retiko.fr/api/unsubscribe/AAAA.BBBB>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(payload.text).toContain("Se désabonner : https://retiko.fr/unsubscribe/AAAA.BBBB");
    expect(payload.text).toContain("12 rue de la Paix, Paris");
    expect(payload.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).toContain('href="https://retiko.fr/unsubscribe/AAAA.BBBB"');
  });

  it("refuse un lien de désabonnement douteux et une configuration absente", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendCampaignEmail({ ...input, unsubscribeUrl: "https://retiko.fr/recover/x" }, env, { fetchImpl })).rejects.toEqual(new EmailDeliveryError("EMAIL_INVALID_UNSUBSCRIBE_URL"));
    await expect(sendCampaignEmail({ ...input, oneClickUnsubscribeUrl: "http://retiko.fr/api/unsubscribe/x" }, env, { fetchImpl })).rejects.toEqual(new EmailDeliveryError("EMAIL_INVALID_UNSUBSCRIBE_URL"));
    await expect(sendCampaignEmail(input, { ...env, RESEND_API_KEY: "" }, { fetchImpl })).rejects.toEqual(new EmailDeliveryError("EMAIL_NOT_CONFIGURED"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("le mode test n'appelle pas le prestataire, et n'existe jamais en production", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const testEnv = { ...env, NODE_ENV: "development", CAMPAIGN_EMAIL_TEST_MODE: "true" };
    expect(campaignEmailTestMode(testEnv)).toBe(true);
    expect(await sendCampaignEmail(input, testEnv, { fetchImpl })).toEqual({ messageId: "test-campaign-1-2" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(campaignEmailTestMode({ ...env, CAMPAIGN_EMAIL_TEST_MODE: "true" })).toBe(false);
  });
});
