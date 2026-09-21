import { describe, expect, it, vi } from "vitest";
import {
  EmailDeliveryError,
  recoveryEmailConfigured,
  sendCardRecoveryEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from "@/lib/email";

const env = {
  NODE_ENV: "production",
  RESEND_API_KEY: "re_test_secret",
  EMAIL_FROM: "Retiko <cartes@send.retiko.fr>",
  EMAIL_REPLY_TO: "contact@retiko.fr",
};

const input = {
  to: "Client@Example.com",
  restaurantName: "Le Comptoir",
  recoveryUrl: `https://retiko.fr/recover/${"a".repeat(43)}`,
  idempotencyKey: `card-recovery-${"b".repeat(64)}`,
};

describe("Resend card recovery email", () => {
  it("requires a monitored reply-to address in addition to the transport", () => {
    expect(recoveryEmailConfigured(env)).toBe(true);
    expect(recoveryEmailConfigured({ ...env, EMAIL_REPLY_TO: "" })).toBe(false);
  });

  it("sends an accessible multipart message with a stable idempotency key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: "resend-message-123" }));

    const result = await sendCardRecoveryEmail(
      { ...input, restaurantName: "Café <script>alert(1)</script>\r\nBCC: victim@example.com" },
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    );

    expect(result).toEqual({ messageId: "resend-message-123" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(input.idempotencyKey);

    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      from: env.EMAIL_FROM,
      to: ["client@example.com"],
      reply_to: env.EMAIL_REPLY_TO,
    });
    expect(payload.subject).not.toContain("\r");
    expect(payload.subject).not.toContain("\n");
    expect(payload.text).toContain(input.recoveryUrl);
    expect(payload.html).toContain('<html lang="fr" dir="ltr">');
    expect(payload.html).toContain("<title>Retrouvez votre carte de fidélité</title>");
    expect(payload.html).toContain("<h1");
    expect(payload.html).toContain("Ouvrir ma carte de fidélité");
    expect(payload.html).toContain("Café &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload.html).not.toContain("<script>alert(1)</script>");
  });

  it("retries only transient provider errors and honors Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "resend-after-retry" }));
    const sleep = vi.fn(async () => undefined);

    await expect(sendCardRecoveryEmail(input, env, {
      fetchImpl: fetchImpl as typeof fetch,
      sleep,
    })).resolves.toEqual({ messageId: "resend-after-retry" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 0);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it("does not retry permanent provider rejections", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    const sleep = vi.fn(async () => undefined);

    await expect(sendCardRecoveryEmail(input, env, {
      fetchImpl: fetchImpl as typeof fetch,
      sleep,
    })).rejects.toMatchObject({ code: "EMAIL_SEND_401" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries network failures without changing the idempotency key", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket reset"))
      .mockResolvedValueOnce(Response.json({ id: "resend-network-retry" }));
    const sleep = vi.fn(async () => undefined);

    await expect(sendCardRecoveryEmail(input, env, {
      fetchImpl: fetchImpl as typeof fetch,
      sleep,
    })).resolves.toEqual({ messageId: "resend-network-retry" });

    const firstHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    const secondHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(firstHeaders.get("idempotency-key")).toBe(secondHeaders.get("idempotency-key"));
  });

  it("aborts a stalled provider call after the bounded timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_url, request) => new Promise((_resolve, reject) => {
      request?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    await expect(sendCardRecoveryEmail(input, env, {
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
    })).rejects.toMatchObject({ code: "EMAIL_SEND_TIMEOUT" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects insecure production recovery URLs before contacting Resend", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendCardRecoveryEmail(
      { ...input, recoveryUrl: `http://retiko.fr/recover/${"a".repeat(43)}` },
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toMatchObject({ code: "EMAIL_INVALID_RECOVERY_URL" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Resend password reset email", () => {
  const resetInput = {
    to: "Owner@Example.com",
    resetUrl: `https://retiko.fr/reset-password?token=${"a".repeat(43)}`,
    idempotencyKey: `password-reset-${"b".repeat(64)}`,
  };

  it("sends the expected subject and reset link, never the raw token elsewhere", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: "resend-reset-123" }));

    const result = await sendPasswordResetEmail(resetInput, env, { fetchImpl: fetchImpl as typeof fetch });

    expect(result).toEqual({ messageId: "resend-reset-123" });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(resetInput.idempotencyKey);

    const payload = JSON.parse(String(request?.body));
    expect(payload.subject).toBe("Réinitialisez votre mot de passe Retiko");
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.text).toContain(resetInput.resetUrl);
    expect(payload.html).toContain(resetInput.resetUrl);
    expect(payload.html).toContain("<title>Réinitialisez votre mot de passe Retiko</title>");
    expect(payload.html).toContain("expire dans 30 minutes");
  });

  it("rejects insecure production reset URLs before contacting Resend", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendPasswordResetEmail(
      { ...resetInput, resetUrl: `http://retiko.fr/reset-password?token=${"a".repeat(43)}` },
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toMatchObject({ code: "EMAIL_INVALID_RECOVERY_URL" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries only transient provider errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "resend-reset-after-retry" }));
    const sleep = vi.fn(async () => undefined);

    await expect(sendPasswordResetEmail(resetInput, env, {
      fetchImpl: fetchImpl as typeof fetch,
      sleep,
    })).resolves.toEqual({ messageId: "resend-reset-after-retry" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent provider rejections", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    await expect(sendPasswordResetEmail(resetInput, env, {
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toMatchObject({ code: "EMAIL_SEND_401" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});


describe("Resend merchant email verification", () => {
  const verificationInput = {
    to: "Owner@Example.com",
    verificationUrl: `https://retiko.fr/verify-email?token=${"a".repeat(43)}`,
    idempotencyKey: `email-verification-${"b".repeat(64)}`,
  };

  it("sends a one-time activation link with the expected Retiko copy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ id: "resend-verify-123" }));

    await expect(sendEmailVerificationEmail(
      verificationInput,
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    )).resolves.toEqual({ messageId: "resend-verify-123" });

    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(verificationInput.idempotencyKey);

    const payload = JSON.parse(String(request?.body));
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.subject).toBe("Vérifiez votre adresse e-mail Retiko");
    expect(payload.text).toContain(verificationInput.verificationUrl);
    expect(payload.html).toContain("<title>Vérifiez votre adresse e-mail Retiko</title>");
    expect(payload.html).toContain("expire dans 24 heures");
  });

  it("rejects a production verification link outside retiko.fr", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendEmailVerificationEmail(
      { ...verificationInput, verificationUrl: `https://evil.example/verify-email?token=${"a".repeat(43)}` },
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toMatchObject({ code: "EMAIL_INVALID_VERIFICATION_URL" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects extra query parameters so the token URL cannot smuggle tracking data", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(sendEmailVerificationEmail(
      { ...verificationInput, verificationUrl: `${verificationInput.verificationUrl}&next=https://evil.example` },
      env,
      { fetchImpl: fetchImpl as typeof fetch },
    )).rejects.toMatchObject({ code: "EMAIL_INVALID_VERIFICATION_URL" } satisfies Partial<EmailDeliveryError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
