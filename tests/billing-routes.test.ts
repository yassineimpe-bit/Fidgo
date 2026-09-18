import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  sql: vi.fn(),
  rateLimit: vi.fn(async () => ({ allowed: true })),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/security", () => ({ rejectCrossOrigin: vi.fn(() => null) }));
vi.mock("stripe", () => ({
  default: class StripeMock {
    checkout = { sessions: { create: mocks.checkoutCreate } };
    billingPortal = { sessions: { create: mocks.portalCreate } };
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));

const env = {
  STRIPE_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_FLEX_MONTHLY: "price_flex",
  STRIPE_PRICE_RETIKO12_MONTHLY: "price_retiko12",
  STRIPE_PRICE_ANNUAL: "price_annual",
  NEXT_PUBLIC_APP_URL: "https://retiko.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, env);
  mocks.getSession.mockResolvedValue({
    staffId: "staff-a",
    establishmentId: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    role: "OWNER",
  });
  mocks.sql.mockResolvedValue([{
    status: "trial",
    trial_ends_at: new Date(Date.now() + 10 * 86_400_000),
    external_customer_id: null,
    external_subscription_id: null,
  }]);
});

describe("routes Stripe", () => {
  it("refuse Checkout lorsque Stripe est désactivé", async () => {
    process.env.STRIPE_ENABLED = "false";
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(new Request("https://retiko.test/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "FLEX" }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "BILLING_DISABLED" });
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejette un Price ID navigateur avant tout appel Stripe", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(new Request("https://retiko.test/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "FLEX", priceId: "price_attacker" }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "CLIENT_PRICE_NOT_ALLOWED" });
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("crée Checkout dans le tenant de la session et contient une panne Stripe", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.checkoutCreate.mockRejectedValueOnce(new Error("network sk_test_do_not_log"));
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(new Request("https://retiko.test/api/billing/checkout", {
      method: "POST",
      headers: { "idempotency-key": "retry-key-123" },
      body: JSON.stringify({ plan: "FLEX" }),
    }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("sk_test");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("sk_test_do_not_log");
    expect(mocks.sql.mock.calls.flat()).toContain("11111111-1111-4111-8111-111111111111");
    consoleError.mockRestore();
  });

  it("réserve la facturation au OWNER", async () => {
    mocks.getSession.mockResolvedValueOnce({ establishmentId: "tenant-a", role: "MANAGER" });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(new Request("https://retiko.test/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "FLEX" }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("rejette une signature webhook invalide avant la base", async () => {
    mocks.constructEvent.mockImplementationOnce(() => { throw new Error("bad signature"); });
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(new Request("https://retiko.test/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "invalid" },
      body: "{\"id\":\"evt_invalid\"}",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_SIGNATURE" });
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
