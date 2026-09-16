import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration007 = readFileSync(
  new URL("../db/migrations/007_product_events.sql", import.meta.url),
  "utf8",
);
const migration010 = readFileSync(
  new URL("../db/migrations/010_scanner_telemetry.sql", import.meta.url),
  "utf8",
);

const scannerEvents = [
  "CAMERA_START",
  "CAMERA_READY",
  "CAMERA_FAILED",
  "QR_DETECTED",
  "SCAN_SENT",
  "SCAN_SUCCESS",
  "SCAN_FAILED",
];

describe("scanner telemetry migration", () => {
  it("only replaces the product_events event type constraint", () => {
    const alteredTables = [...migration010.matchAll(/alter\s+table\s+([a-z_]+)/gi)]
      .map((match) => match[1]);

    expect(alteredTables).toEqual(["product_events", "product_events"]);
    expect(migration010).toMatch(/drop\s+constraint\s+if\s+exists\s+product_events_event_type_check/i);
    expect(migration010).toMatch(/add\s+constraint\s+product_events_event_type_check/i);
    expect(migration010).not.toMatch(/\b(update|insert|delete|truncate)\b/i);
    expect(migration010).not.toMatch(/subscriptions|billing|audit_logs|tenant/i);
  });

  it("preserves every event accepted by migration 007 and adds scanner telemetry", () => {
    const previousEventTypes = [...migration007.matchAll(/'([A-Z_]+)'/g)]
      .map((match) => match[1]);

    for (const eventType of previousEventTypes) expect(migration010).toContain(`'${eventType}'`);
    for (const eventType of scannerEvents) expect(migration010).toContain(`'${eventType}'`);
  });
});
