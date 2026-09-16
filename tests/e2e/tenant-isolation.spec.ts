import { expect, test } from "@playwright/test";
import { createMerchant, currentCustomerId, enrollCustomer, origin, unique } from "./helpers";

/**
 * Verrouille l'isolation multi-tenant sur toutes les routes sensibles : une
 * session du commerce A ne doit jamais pouvoir lire, créditer, débiter,
 * ajuster, exporter, supprimer ou administrer une ressource du commerce B,
 * qu'elle soit désignée par token de carte, id client, id transaction ou id
 * employé.
 */
test("isolation tenant : le commerce A ne peut agir sur aucune ressource du commerce B", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await createMerchant(pageA, "tenant-a");
    await createMerchant(pageB, "tenant-b");

    const foreignEmail = `${unique("foreign")}@example.com`;
    const foreignCard = await enrollCustomer(pageB, "Noah", foreignEmail);
    const foreignToken = foreignCard.cardUrl.split("/c/")[1];

    // --- carte : scan, lookup, credit, redeem ---
    const scan = await pageA.request.post("/api/scan", {
      headers: { origin },
      data: { token: `LOY1:${foreignToken}` },
    });
    expect(scan.status()).toBe(404);
    await expect(scan.json()).resolves.toMatchObject({ error: "CARD_NOT_FOUND" });

    const lookup = await pageA.request.get(`/api/lookup?q=${encodeURIComponent(foreignEmail)}`);
    expect(lookup.status()).toBe(404);

    const credit = await pageA.request.post("/api/credit", {
      headers: { origin },
      data: { token: `LOY1:${foreignToken}`, idempotencyKey: crypto.randomUUID() },
    });
    expect(credit.status()).toBe(404);
    await expect(credit.json()).resolves.toMatchObject({ error: "CARD_NOT_FOUND" });

    // B crédite légitimement sa propre carte une fois, pour disposer d'une
    // transaction réelle à utiliser contre /api/transactions/reverse. Le
    // rejet cross-tenant de /api/redeem ne dépend pas d'atteindre le seuil :
    // la carte de B est de toute façon introuvable dans le tenant de A.
    const ownCredit = await pageB.request.post("/api/credit", {
      headers: { origin },
      data: { token: `LOY1:${foreignToken}`, idempotencyKey: crypto.randomUUID() },
    });
    expect(ownCredit.ok()).toBeTruthy();

    const redeem = await pageA.request.post("/api/redeem", {
      headers: { origin },
      data: { token: `LOY1:${foreignToken}`, idempotencyKey: crypto.randomUUID() },
    });
    expect(redeem.status()).toBe(404);
    await expect(redeem.json()).resolves.toMatchObject({ error: "CARD_NOT_FOUND" });

    // --- client : adjust, export, delete ---
    const foreignCustomerId = await currentCustomerId(pageB);

    const adjust = await pageA.request.post(`/api/customers/${foreignCustomerId}/adjust`, {
      headers: { origin },
      data: { newBalance: 0, reason: "tentative cross-tenant", idempotencyKey: crypto.randomUUID() },
    });
    expect(adjust.status()).toBe(404);
    await expect(adjust.json()).resolves.toMatchObject({ error: "CARD_NOT_FOUND" });

    const exportRes = await pageA.request.get(`/api/customers/${foreignCustomerId}/export`);
    expect(exportRes.status()).toBe(404);

    const del = await pageA.request.delete(`/api/customers/${foreignCustomerId}`, {
      headers: { origin },
    });
    expect(del.status()).toBe(404);

    // --- transaction : reverse ---
    const history = await pageB.request.get("/api/history");
    expect(history.ok()).toBeTruthy();
    const foreignTransactionId = (await history.json())[0]?.id;
    expect(foreignTransactionId).toBeTruthy();

    const reverse = await pageA.request.post("/api/transactions/reverse", {
      headers: { origin },
      data: { transactionId: foreignTransactionId, idempotencyKey: crypto.randomUUID() },
    });
    expect(reverse.status()).toBe(404);
    await expect(reverse.json()).resolves.toMatchObject({ error: "TRANSACTION_NOT_FOUND" });

    // --- employé ---
    const newEmployeeEmail = `${unique("employee")}@example.com`;
    const createEmployee = await pageB.request.post("/api/employees", {
      headers: { origin },
      data: { email: newEmployeeEmail, password: "Password-test-123!", role: "EMPLOYEE" },
    });
    expect(createEmployee.ok()).toBeTruthy();
    const employees = await (await pageB.request.get("/api/employees")).json();
    const foreignEmployeeId = employees.find((e: { email: string }) => e.email === newEmployeeEmail)?.id;
    expect(foreignEmployeeId).toBeTruthy();

    const patchEmployee = await pageA.request.patch(`/api/employees/${foreignEmployeeId}`, {
      headers: { origin },
      data: { active: false },
    });
    expect(patchEmployee.status()).toBe(404);

    // --- le commerce B, lui, garde bien accès à ses propres ressources ---
    const ownExport = await pageB.request.get(`/api/customers/${foreignCustomerId}/export`);
    expect(ownExport.ok()).toBeTruthy();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
