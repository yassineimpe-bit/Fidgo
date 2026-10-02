import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attribute, inventory, type SchemaSource } from "../scripts/db-schema-status.mjs";

const migrationDir = path.join(process.cwd(), "db", "migrations");
const read = (name: string) => fs.readFileSync(path.join(migrationDir, name), "utf8");

describe("db-schema-status : inventaire statique des migrations", () => {
  it("relève tables, colonnes, index, contraintes, triggers et fonctions", () => {
    const objects = inventory(read("027_email_campaigns.sql"));
    expect(objects).toEqual(expect.arrayContaining([
      { kind: "column", name: "campaigns.kind" },
      { kind: "column", name: "campaign_recipients.claimed_at" },
      { kind: "constraint", name: "campaigns_email_shape_check", table: "campaigns" },
      { kind: "index", name: "campaigns_idempotency_key" },
      { kind: "trigger", name: "campaign_recipients_same_tenant" },
      { kind: "function", name: "campaign_recipient_same_tenant" },
    ]));
  });

  it("repère les nouvelles versions d'une contrainte existante", () => {
    expect(inventory(read("031_card_visuals.sql"))).toContainEqual({ kind: "constraintdef", name: "establishments_card_design_check", pattern: "%card_image_id%" });
    expect(inventory(read("029_billing_price_grids.sql")).filter((o) => o.kind === "constraintdef").map((o) => o.name))
      .toEqual(["subscriptions_plan_check", "subscriptions_stripe_checkout_plan_check"]);
  });

  it("attribue un objet recréé à la première migration qui le crée, pas à schema.sql", () => {
    const list: SchemaSource[] = [
      { id: "schema.sql", objects: [{ kind: "table", name: "a" }, { kind: "index", name: "idx" }] },
      { id: "010.sql", objects: [{ kind: "index", name: "idx" }] },
      { id: "020.sql", objects: [{ kind: "index", name: "idx" }, { kind: "trigger", name: "t" }] },
    ];
    expect(attribute(list)).toEqual([
      { id: "schema.sql", objects: [{ kind: "table", name: "a" }] },
      { id: "010.sql", objects: [{ kind: "index", name: "idx" }] },
      { id: "020.sql", objects: [{ kind: "trigger", name: "t" }] },
    ]);
  });

  it("donne à chaque migration 024 à 033 au moins un objet vérifiable", () => {
    const names = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
    const list = [
      { id: "schema.sql", objects: inventory(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8")) },
      ...names.map((id) => ({ id, objects: inventory(read(id)) })),
    ];
    const attributed = attribute(list);
    for (const id of names.filter((name) => name >= "024" && name < "034")) {
      expect(attributed.find((source) => source.id === id)?.objects.length, id).toBeGreaterThan(0);
    }
  });
});
