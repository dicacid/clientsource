import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-contract checks only. These are NOT substitutes for fixture-backed
// integration tests against isolated Redis, users and organizations.
const state = readFileSync(new URL("../src/integrations/render/state.server.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("../src/integrations/render/email-verification.server.ts", import.meta.url), "utf8");
const functions = readFileSync(new URL("../src/integrations/render/server.functions.ts", import.meta.url), "utf8");
test("write policy rejects unknown columns", () => {
  assert.match(state, /function assertWritable/);
  assert.match(state, /if \(!allowed\.has\(key\)\) throw dbError/);
  assert.match(state, /assertWritable\(table, raw/);
  assert.match(state, /assertWritable\(table, patch/);
});
test("foreign keys are checked against organization", () => {
  assert.match(state, /function validateReferences/);
  assert.match(state, /c\.organization_id === orgId/);
});
test("new domain memberships require verified email", () => {
  assert.match(state, /!user\.email_verified_at \|\| !hasAutomaticCompanyAccess/);
  assert.match(state, /email_confirmed_at: user\.email_verified_at \?\? null/);
});
test("verification tokens are hashed, expiring and single use", () => {
  assert.match(email, /createHash\("sha256"\)/);
  assert.match(email, /EX: TTL/);
  assert.match(email, /getDel/);
  assert.match(email, /Too many verification requests/);
});
test("verification handlers are server-side", () => {
  assert.match(functions, /confirmEmailVerificationRequest/);
  assert.match(functions, /requestEmailVerificationRequest/);
});
