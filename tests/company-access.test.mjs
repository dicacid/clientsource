import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, test } from "node:test";
import { AUTOMATIC_ACCESS_DOMAINS, hasAutomaticCompanyAccess } from "../src/lib/company-access.ts";

const savedEnv = { STATE_KEY: process.env.STATE_KEY, SESSION_SECRET: process.env.SESSION_SECRET };
const stateKey = "spa-intelligence:test:company-access";
process.env.STATE_KEY = stateKey;
process.env.SESSION_SECRET = "test-only-session-secret-with-at-least-32-characters";

// Replace only the persistence transport; exercise the real password, session,
// membership, invitation and data-scoping functions against stored JSON state.
const values = new Map();
const transportKey = Symbol.for("spa-intelligence.test.company-access.redis");
globalThis[transportKey] = {
  async get(key) { return values.get(key) ?? null; },
  async set(key, value) { values.set(key, value); },
};
const transportUrl = "data:text/javascript," + encodeURIComponent(`
  export function createRedisConnection() {
    const client = globalThis[Symbol.for("spa-intelligence.test.company-access.redis")];
    return async () => client;
  }
`);
const stateUrl = new URL("../src/integrations/render/state.server.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === stateUrl && specifier === "./redis.server") {
      return { url: transportUrl, shortCircuit: true };
    }
    if (context.parentURL === stateUrl && specifier === "../../lib/company-access") {
      return nextResolve(new URL("../src/lib/company-access.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const auth = await import(stateUrl);
hooks.deregister();
delete globalThis[transportKey];

const password = "Test-password-123!";
const snapshot = () => JSON.parse(values.get(stateKey));
const save = (state) => values.set(stateKey, JSON.stringify(state));

beforeEach(() => values.clear());
after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("automatic access matches exact domains, ignoring case and outer whitespace", () => {
  for (const domain of AUTOMATIC_ACCESS_DOMAINS) {
    assert.equal(hasAutomaticCompanyAccess(`  Person+sales@${domain.toUpperCase()}  `), true);
  }
  for (const email of [
    "person@example.com", "person@sub.revealingmindai.org",
    "person@revealingmindai.org.attacker.com", "person@notrevealingmindai.org",
    "person@solaronline.com.au.attacker.com", "person@solarpoweraustralia.com.au.attacker.com",
    "person@elmofo.com.au.attacker.com", "person@@elmofo.com.au",
    "@elmofo.com.au", "person name@elmofo.com.au", "person@elmofo.com.au.",
  ]) assert.equal(hasAutomaticCompanyAccess(email), false, email);
});

for (const domain of AUTOMATIC_ACCESS_DOMAINS) {
  test(`${domain} can register and sign in without an invitation or workspace setup`, async () => {
    const { user } = await auth.signUp(`Person@${domain.toUpperCase()}`, password, "Person");
    assert.equal(snapshot().organization_members.length, 0);
    const session = await auth.signIn(`  PERSON@${domain.toUpperCase()}  `, password);
    const membership = await auth.membershipForUser(user.id);
    assert.ok(membership);
    assert.equal(membership.userId, user.id);
    assert.equal(membership.role, "owner");
    assert.equal(membership.orgName, "Solar Power Australia");
    assert.equal((await auth.verifySessionToken(session.access_token))?.id, user.id);
    assert.equal("password_hash" in session.user, false);
    assert.equal(snapshot().organizations.length, 1);
  });
}

test("approved accounts share existing data without changing current roles", async () => {
  const owner = (await auth.signUp("owner@example.com", password, "Owner")).user;
  const created = await auth.executeRpc(owner.id, "create_workspace", { org_name: "Existing SPA data" });
  assert.equal(created.error, null);
  const company = await auth.executeDbRequest(owner.id, {
    table: "companies", action: "insert", returning: true,
    payload: { organization_id: created.data, name: "Existing company" },
  });
  assert.equal(company.error, null);
  for (const domain of AUTOMATIC_ACCESS_DOMAINS) {
    const { user } = await auth.signUp(`person@${domain}`, password, "Person");
    await auth.signIn(user.email, password);
    const membership = await auth.membershipForUser(user.id);
    assert.equal(membership.organizationId, created.data);
    assert.equal(membership.role, "member");
    const rows = await auth.executeDbRequest(user.id, { table: "companies", action: "select" });
    assert.equal(rows.data[0].name, "Existing company");
    const denied = await auth.executeDbRequest(user.id, {
      table: "companies", action: "insert", payload: { organization_id: "another-scope", name: "Denied" },
    });
    assert.equal(denied.error?.code, "42501");
  }
  assert.equal((await auth.membershipForUser(owner.id)).role, "owner");
  assert.equal(snapshot().organizations.length, 1);
  assert.equal(snapshot().companies.length, 1);
});

test("wrong passwords and unknown accounts cannot provision access", async () => {
  await auth.signUp("person@elmofo.com.au", password, "Person");
  const before = values.get(stateKey);
  await assert.rejects(auth.signIn("person@elmofo.com.au", "Wrong-password!"), /Invalid email or password/);
  await assert.rejects(auth.signIn("unknown@solaronline.com.au", password), /Invalid email or password/);
  assert.equal(values.get(stateKey), before);
  assert.equal(await auth.verifySessionToken("invalid.token"), null);
});

test("an account outside the approved domains receives no automatic membership", async () => {
  const { user } = await auth.signUp("person@example.com", password, "Person");
  await auth.signIn(user.email, password);
  assert.equal(await auth.membershipForUser(user.id), null);
  assert.equal((await auth.executeRpc(user.id, "claim_invite")).error, null);
  assert.equal(snapshot().organizations.length, 0);
  const denied = await auth.executeDbRequest(user.id, {
    table: "companies", action: "insert", payload: { organization_id: "any-scope", name: "Denied" },
  });
  assert.equal(denied.error?.code, "42501");
});

test("existing approved sessions gain membership without signing in again", async () => {
  const { user } = await auth.signUp("existing@revealingmindai.org", password, "Existing");
  const membership = await auth.membershipForUser(user.id);
  assert.equal(membership.userId, user.id);
  assert.equal(snapshot().organization_members.length, 1);
  assert.equal(await auth.membershipForUser("missing-user"), null);
});

test("the legacy onboarding resolver also grants approved company access", async () => {
  const { user } = await auth.signUp("existing@solaronline.com.au", password, "Existing");
  assert.equal((await auth.executeRpc(user.id, "claim_invite")).error, null);
  assert.equal((await auth.membershipForUser(user.id)).userId, user.id);
});

test("explicit invitation roles and existing admin roles survive automatic access", async () => {
  const owner = (await auth.signUp("owner@elmofo.com.au", password, "Owner")).user;
  await auth.signIn(owner.email, password);
  const { organizationId } = await auth.membershipForUser(owner.id);
  const invited = (await auth.signUp("admin@solarpoweraustralia.com.au", password, "Admin")).user;
  const invite = await auth.executeDbRequest(owner.id, {
    table: "pending_invites", action: "insert",
    payload: { organization_id: organizationId, email: invited.email, role: "admin" },
  });
  assert.equal(invite.error, null);
  await auth.signIn(invited.email, password);
  assert.equal((await auth.membershipForUser(invited.id)).role, "admin");
  await auth.signIn(invited.email, password);
  assert.equal((await auth.membershipForUser(invited.id)).role, "admin");
  assert.equal(snapshot().pending_invites.length, 0);
  assert.equal(snapshot().organization_members.length, 2);
});

test("explicit invitations still work for other domains", async () => {
  const owner = (await auth.signUp("owner@elmofo.com.au", password, "Owner")).user;
  await auth.signIn(owner.email, password);
  const { organizationId } = await auth.membershipForUser(owner.id);
  const invited = (await auth.signUp("guest@example.com", password, "Guest")).user;
  await auth.executeDbRequest(owner.id, {
    table: "pending_invites", action: "insert",
    payload: { organization_id: organizationId, email: invited.email, role: "member" },
  });
  await auth.signIn(invited.email, password);
  assert.equal((await auth.executeRpc(invited.id, "claim_invite")).error, null);
  assert.equal((await auth.membershipForUser(invited.id)).organizationId, organizationId);
});

test("concurrent and repeated access creates only one shared scope and one membership each", async () => {
  const users = [];
  for (const domain of AUTOMATIC_ACCESS_DOMAINS) {
    users.push((await auth.signUp(`person@${domain}`, password, "Person")).user);
  }
  await Promise.all(users.map(user => auth.signIn(user.email, password)));
  await Promise.all(users.flatMap(user => [auth.signIn(user.email, password), auth.membershipForUser(user.id)]));
  const state = snapshot();
  assert.equal(state.organizations.length, 1);
  assert.equal(state.organization_members.length, users.length);
  assert.equal(state.organization_members.filter(member => member.role === "owner").length, 1);
});

test("persistent membership works after reload, while tampered sessions are rejected", async () => {
  const { user } = await auth.signUp("person@elmofo.com.au", password, "Person");
  const session = await auth.signIn(user.email, password);
  const stored = snapshot();
  save(JSON.parse(JSON.stringify(stored)));
  assert.equal((await auth.membershipForUser(user.id)).organizationId, stored.organizations[0].id);
  assert.equal(await auth.verifySessionToken(session.access_token.split(".")[0] + ".invalid"), null);
});
