import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { POST as backup } from "../app/api/internal/backup-credentials/route";
import { POST as lifecycle } from "../app/api/internal/lifecycle-credentials/route";
import {
  RETIKO_BACKUP_IMMUTABLE_SUBJECT, RETIKO_BACKUP_REPOSITORY,
  RETIKO_BACKUP_REPOSITORY_ID, RETIKO_BACKUP_REPOSITORY_OWNER_ID,
  RETIKO_BACKUP_WORKFLOW_REF, RETIKO_LIFECYCLE_WORKFLOW_REF,
} from "../lib/backup-oidc";

const jwks = vi.hoisted(() => ({ resolver: null as unknown }));
vi.mock("jose", async (original) => {
  const actual = await original<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: () => (...args: Parameters<ReturnType<typeof createLocalJWKSet>>) =>
    (jwks.resolver as ReturnType<typeof createLocalJWKSet>)(...args) };
});

const databaseUrl = "postgres://synthetic:oidc-secret-sentinel@db.example.test/isolated";
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKey: Awaited<ReturnType<typeof generateKeyPair>>;
const issuer = "https://token.actions.githubusercontent.com";
const policies = [
  { name: "backup", route: backup, audience: "retiko-backup", workflow: RETIKO_BACKUP_WORKFLOW_REF,
    otherAudience: "retiko-lifecycle", otherWorkflow: RETIKO_LIFECYCLE_WORKFLOW_REF, events: ["push", "schedule", "workflow_dispatch"] },
  { name: "lifecycle", route: lifecycle, audience: "retiko-lifecycle", workflow: RETIKO_LIFECYCLE_WORKFLOW_REF,
    otherAudience: "retiko-backup", otherWorkflow: RETIKO_BACKUP_WORKFLOW_REF, events: ["schedule", "workflow_dispatch"] },
];

beforeAll(async () => {
  key = await generateKeyPair("RS256");
  wrongKey = await generateKeyPair("RS256");
  jwks.resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(key.publicKey), kid: "test-only", alg: "RS256", use: "sig" }] });
});
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", databaseUrl);
  for (const method of ["info", "warn", "error", "log"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
  try {
    for (const method of ["info", "warn", "error", "log"] as const) {
      const calls = vi.mocked(console[method]).mock.calls;
      expect(JSON.stringify(calls)).not.toContain(databaseUrl);
      expect(JSON.stringify(calls)).not.toContain("oidc-secret-sentinel");
    }
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

for (const policy of policies) describe(`${policy.name} signed OIDC broker`, () => {
  function claims() {
    return { repository: RETIKO_BACKUP_REPOSITORY, repository_id: RETIKO_BACKUP_REPOSITORY_ID,
      repository_owner_id: RETIKO_BACKUP_REPOSITORY_OWNER_ID, ref: "refs/heads/main",
      workflow_ref: policy.workflow, sub: RETIKO_BACKUP_IMMUTABLE_SUBJECT,
      runner_environment: "github-hosted", event_name: "schedule", sha: "a".repeat(40), run_id: "12345" };
  }
  async function token(overrides: Record<string, unknown> = {}, options: { audience?: string; issuer?: string; wrongSignature?: boolean; expired?: boolean } = {}) {
    return new SignJWT({ ...claims(), ...overrides }).setProtectedHeader({ alg: "RS256", kid: "test-only" })
      .setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? policy.audience)
      .setIssuedAt().setExpirationTime(options.expired ? "-1s" : "5m")
      .sign(options.wrongSignature ? wrongKey.privateKey : key.privateKey);
  }
  async function request(value?: string, status = 401) {
    const result = await policy.route(new Request("https://retiko.test/api/internal/credentials", {
      method: "POST", headers: value ? { authorization: `Bearer ${value}` } : {},
    }));
    expect(result.status).toBe(status);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const body = await result.json();
    if (status === 200) expect(body).toEqual({ databaseUrl });
    else expect(JSON.stringify(body)).not.toContain("oidc-secret-sentinel");
  }
  it.each(policy.events)("accepts a signed conforming token for %s", async (event_name) => {
    await request(await token({ event_name }), 200);
  });
  it("rejects absent and malformed JWTs", async () => { await request(); await request("invalid.jwt"); });
  it("rejects invalid signatures", async () => { await request(await token({}, { wrongSignature: true })); });
  it("rejects an invalid issuer", async () => { await request(await token({}, { issuer: "https://attacker.test" })); });
  it("rejects an expired token", async () => { await request(await token({}, { expired: true })); });
  it("rejects the other audience", async () => { await request(await token({}, { audience: policy.otherAudience })); });
  it("rejects a complete token for the other broker", async () => {
    await request(await token({ workflow_ref: policy.otherWorkflow }, { audience: policy.otherAudience }));
  });
  it.each([
    ["repository", "attacker/Fidgo"], ["repository_id", "1"], ["repository_owner_id", "1"],
    ["workflow_ref", "yassineimpe-bit/Fidgo/.github/workflows/ci.yml@refs/heads/main"],
    ["ref", "refs/heads/feature"], ["runner_environment", "self-hosted"],
    ["event_name", "pull_request"], ["sub", "repo:attacker/Fidgo:environment:production"], ["sha", "invalid"],
    ["repository", databaseUrl], ["event_name", databaseUrl],
  ])("rejects cryptographically valid but forbidden %s", async (claim, value) => {
    await request(await token({ [claim]: value }), 403);
  });
  it("rejects the other workflow even with the right audience", async () => {
    await request(await token({ workflow_ref: policy.otherWorkflow }), 403);
  });
  if (policy.name === "lifecycle") it("rejects push", async () => { await request(await token({ event_name: "push" }), 403); });
  it("returns 503 when the application credential is absent", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await request(await token(), 503);
  });
  it("does not echo arbitrary run IDs into logs", async () => {
    await request(await token({ run_id: databaseUrl }), 200);
  });
});
