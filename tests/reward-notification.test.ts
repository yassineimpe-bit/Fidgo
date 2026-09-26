import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  query: vi.fn(),
  sendCampaignEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  sql: Object.assign(mocks.query, { begin: mocks.begin }),
}));

vi.mock("@/lib/email", () => ({
  EmailDeliveryError: class EmailDeliveryError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
  campaignEmailTestMode: () => true,
  emailDeliveryConfigured: () => false,
  sendCampaignEmail: mocks.sendCampaignEmail,
}));

vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/unsubscribe", () => ({ unsubscribeToken: () => "unsubscribe-token" }));

import { EmailDeliveryError } from "@/lib/email";
import { crossedRewardThreshold, notifyRewardAvailable } from "@/lib/reward-notification";

function queryText(strings: TemplateStringsArray) {
  return strings.join(" ").replace(/\s+/g, " ").trim();
}

function eligibleRow(cardId = "card-1") {
  return {
    card_id: cardId,
    customer_id: `customer-${cardId}`,
    email: `${cardId}@example.com`,
    name: "Café Retiko",
    address: "1 rue du Test",
    reward_label: "Un café offert",
    enabled: "true",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendCampaignEmail.mockResolvedValue({ messageId: "message-1" });
});

describe("récompense disponible : franchissement du seuil", () => {
  it("uniquement quand le solde passe d'en dessous à au moins le seuil", () => {
    expect(crossedRewardThreshold(9, 10, 10)).toBe(true);
    expect(crossedRewardThreshold(8, 12, 10)).toBe(true);
    expect(crossedRewardThreshold(10, 11, 10)).toBe(false);
    expect(crossedRewardThreshold(7, 9, 10)).toBe(false);
    expect(crossedRewardThreshold(0, 1, 0)).toBe(false);
  });
});

describe("récompense disponible : réservation anti-spam", () => {
  it("verrouille la carte et réserve la notification avant l'appel au prestataire", async () => {
    const transactionQueries: string[] = [];
    const tx = vi.fn(async (strings: TemplateStringsArray) => {
      const text = queryText(strings);
      transactionQueries.push(text);
      if (text.startsWith("select t.card_id")) return [eligibleRow()];
      if (text.startsWith("select id, status")) return [];
      if (text.startsWith("insert into reward_notifications")) return [{ id: "notification-1" }];
      throw new Error(`Unexpected transaction query: ${text}`);
    });
    mocks.begin.mockImplementation(async (callback) => callback(tx));
    mocks.query.mockResolvedValue([]);

    await notifyRewardAvailable("establishment-1", "transaction-1");

    expect(transactionQueries[0]).toContain("for update of c");
    expect(transactionQueries[0]).toContain("u.establishment_id=t.establishment_id");
    expect(transactionQueries[0]).toContain("p.active=true");
    expect(transactionQueries[0]).toContain("c.expires_at is null or c.expires_at > now()");
    expect(transactionQueries[2]).toContain("where not exists");
    expect(mocks.sendCampaignEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendCampaignEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "card-1@example.com",
      idempotencyKey: "reward-transaction-1",
    }));
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("ne réserve rien quand le consentement ou les conditions ne sont plus valides", async () => {
    const tx = vi.fn().mockResolvedValue([]);
    mocks.begin.mockImplementation(async (callback) => callback(tx));

    await notifyRewardAvailable("establishment-1", "transaction-1");

    expect(tx).toHaveBeenCalledTimes(1);
    expect(mocks.sendCampaignEmail).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("ne rejoue pas une réservation pending ou sent de la même transaction", async () => {
    for (const status of ["pending", "sent"]) {
      const tx = vi.fn(async (strings: TemplateStringsArray) => {
        const text = queryText(strings);
        if (text.startsWith("select t.card_id")) return [eligibleRow()];
        if (text.startsWith("select id, status")) return [{ id: "notification-1", status }];
        throw new Error(`Unexpected transaction query: ${text}`);
      });
      mocks.begin.mockImplementationOnce(async (callback) => callback(tx));
      await notifyRewardAvailable("establishment-1", `transaction-${status}`);
    }

    expect(mocks.sendCampaignEmail).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejoue un échec avec la même ligne et la même clé d'idempotence", async () => {
    let status = "new";
    const tx = vi.fn(async (strings: TemplateStringsArray) => {
      const text = queryText(strings);
      if (text.startsWith("select t.card_id")) return [eligibleRow()];
      if (text.startsWith("select id, status")) {
        return status === "new" ? [] : [{ id: "notification-1", status }];
      }
      if (text.startsWith("insert into reward_notifications")) {
        status = "pending";
        return [{ id: "notification-1" }];
      }
      if (text.startsWith("update reward_notifications n")) {
        status = "pending";
        return [{ id: "notification-1" }];
      }
      throw new Error(`Unexpected transaction query: ${text}`);
    });
    mocks.begin.mockImplementation(async (callback) => callback(tx));
    mocks.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = queryText(strings);
      if (text.includes("set status='failed'")) status = "failed";
      if (text.includes("set status='sent'")) status = "sent";
      return [];
    });
    mocks.sendCampaignEmail
      .mockRejectedValueOnce(new EmailDeliveryError("EMAIL_SEND_503"))
      .mockResolvedValueOnce({ messageId: "message-2" });

    await notifyRewardAvailable("establishment-1", "transaction-1");
    expect(status).toBe("failed");
    await notifyRewardAvailable("establishment-1", "transaction-1");

    expect(status).toBe("sent");
    expect(mocks.sendCampaignEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendCampaignEmail.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      "reward-transaction-1",
      "reward-transaction-1",
    ]);
  });
});
