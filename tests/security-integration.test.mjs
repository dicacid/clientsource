import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { securityFixture } from "./helpers/security-fixture.mjs";

const fixture = await securityFixture();
const { auth, verification } = fixture;
const password = "Synthetic-password-123!";
const filter = (id) => [{ op: "eq", column: "id", value: id }];
const user = async (email, verified = true) => {
  const { user } = await auth.signUp(email, password, "Synthetic");
  if (verified) await auth.markVerifiedEmail(user.id);
  return user;
};
const request = (id, table, action, payload, filters = []) =>
  auth.executeDbRequest(id, { table, action, payload, filters, returning: true });
async function workspace() {
  const owner = await user("owner@elmofo.com.au");
  await auth.signIn(owner.email, password);
  const { organizationId } = await auth.membershipForUser(owner.id);
  const member = await user("member@elmofo.com.au");
  await auth.signIn(member.email, password);
  const company = (
    await request(owner.id, "companies", "insert", {
      organization_id: organizationId,
      name: "Synthetic company",
    })
  ).data[0];
  return { owner, member, organizationId, company };
}
beforeEach(() => fixture.reset());

test("unverified domain accounts cannot auto-join, claim invites or create workspaces", async () => {
  const u = await user("unverified@elmofo.com.au", false);
  assert.equal((await auth.userById(u.id)).email_confirmed_at, null);
  await auth.signIn(u.email, password);
  assert.equal(await auth.membershipForUser(u.id), null);
  for (const fn of ["claim_invite", "create_workspace"])
    assert.equal((await auth.executeRpc(u.id, fn, { org_name: "Denied" })).error?.code, "42501");
  assert.equal(fixture.snapshot().organizations.length, 0);
});

test("legacy membership and roles survive unverified sign-in and onboarding claim", async () => {
  const { owner, organizationId } = await workspace();
  const state = fixture.snapshot();
  delete state.users.find((u) => u.id === owner.id).email_verified_at;
  fixture.save(state);
  await auth.signIn(owner.email, password);
  assert.equal((await auth.executeRpc(owner.id, "claim_invite")).error, null);
  assert.equal((await auth.membershipForUser(owner.id)).organizationId, organizationId);
  assert.equal((await auth.membershipForUser(owner.id)).role, "owner");
  assert.equal((await auth.userById(owner.id)).email_confirmed_at, null);
});

test("invitation remains unclaimed until mailbox verification and preserves its role", async () => {
  const { owner, organizationId } = await workspace();
  const guest = await user("guest@example.invalid", false);
  assert.equal(
    (
      await request(owner.id, "pending_invites", "insert", {
        organization_id: organizationId,
        email: guest.email,
        role: "admin",
      })
    ).error,
    null,
  );
  assert.equal((await auth.executeRpc(guest.id, "claim_invite")).error?.code, "42501");
  assert.equal(fixture.snapshot().pending_invites.length, 1);
  await auth.markVerifiedEmail(guest.id);
  assert.equal((await auth.executeRpc(guest.id, "claim_invite")).error, null);
  assert.equal((await auth.membershipForUser(guest.id)).role, "admin");
  assert.equal(fixture.snapshot().pending_invites.length, 0);
});

test("unknown table/action/RPC and immutable fields fail without writes", async () => {
  const { owner, company } = await workspace();
  const before = fixture.values.get(fixture.key);
  for (const [table, action, payload] of [
    ["users", "select"],
    ["companies", "upsert"],
    ["companies", "update", { password_hash: "x" }],
    ["companies", "update", { organization_id: "foreign" }],
    ["companies", "insert", { id: company.id }],
  ]) {
    assert.ok((await request(owner.id, table, action, payload)).error);
  }
  assert.ok((await auth.executeRpc(owner.id, "unknown")).error);
  assert.equal(fixture.values.get(fixture.key), before);
});

test("member/admin cannot edit invitations, escalate roles or remove last owner", async () => {
  const { owner, member, organizationId } = await workspace();
  const admin = await user("admin@elmofo.com.au");
  await auth.signIn(admin.email, password);
  assert.equal(
    (
      await auth.executeRpc(owner.id, "set_member_role", {
        target_user_id: admin.id,
        new_role: "admin",
      })
    ).error,
    null,
  );
  const invite = (
    await request(owner.id, "pending_invites", "insert", {
      organization_id: organizationId,
      email: "invite@example.invalid",
      role: "member",
    })
  ).data[0];
  for (const actor of [member, admin]) {
    assert.equal(
      (await request(actor.id, "pending_invites", "update", { role: "admin" }, filter(invite.id)))
        .error?.code,
      "42501",
    );
    assert.ok(
      (
        await auth.executeRpc(actor.id, "set_member_role", {
          target_user_id: actor.id,
          new_role: "owner",
        })
      ).error,
    );
    assert.equal(
      (
        await request(actor.id, "pending_invites", "insert", {
          organization_id: organizationId,
          email: `${actor.id}@example.invalid`,
          role: "admin",
        })
      ).error?.code,
      "42501",
    );
  }
  assert.match(
    (
      await auth.executeRpc(owner.id, "set_member_role", {
        target_user_id: owner.id,
        new_role: "member",
      })
    ).error.message,
    /LAST_OWNER/,
  );
  assert.match(
    (
      await request(owner.id, "organization_members", "delete", undefined, [
        { op: "eq", column: "user_id", value: owner.id },
      ])
    ).error.message,
    /LAST_OWNER/,
  );
});

test("workspace boundaries apply to reads, updates, deletes and references", async () => {
  const { owner, company, organizationId } = await workspace();
  const outsider = await user("outsider@example.invalid");
  const state = fixture.snapshot();
  state.organizations.push({ id: "foreign", name: "Synthetic foreign" });
  state.organization_members.push({
    organization_id: "foreign",
    user_id: outsider.id,
    role: "owner",
  });
  state.companies.push({ id: "foreign-company", organization_id: "foreign", name: "Foreign" });
  state.contacts.push({
    id: "foreign-contact",
    organization_id: "foreign",
    company_id: "foreign-company",
  });
  fixture.save(state);
  assert.deepEqual(
    (await request(owner.id, "companies", "select", undefined, filter("foreign-company"))).data,
    [],
  );
  assert.deepEqual(
    (await request(owner.id, "companies", "update", { name: "Denied" }, filter("foreign-company")))
      .data,
    [],
  );
  assert.deepEqual(
    (await request(owner.id, "companies", "delete", undefined, filter("foreign-company"))).data,
    [],
  );
  assert.equal(
    (
      await request(outsider.id, "companies", "insert", {
        organization_id: organizationId,
        name: "Denied",
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await request(owner.id, "contacts", "insert", {
        organization_id: organizationId,
        company_id: "foreign-company",
        full_name: "Denied",
      })
    ).error?.code,
    "23503",
  );
  const contact = (
    await request(owner.id, "contacts", "insert", {
      organization_id: organizationId,
      company_id: company.id,
      full_name: "Synthetic",
    })
  ).data[0];
  assert.equal(
    (
      await request(
        owner.id,
        "contacts",
        "update",
        { company_id: "foreign-company" },
        filter(contact.id),
      )
    ).error?.code,
    "23503",
  );
  assert.equal(
    (
      await request(owner.id, "activities", "insert", {
        organization_id: organizationId,
        company_id: company.id,
        contact_id: "foreign-contact",
        type: "note",
        body: "Denied",
      })
    ).error?.code,
    "23503",
  );
  assert.ok(
    (
      await auth.executeRpc(owner.id, "set_member_role", {
        target_user_id: outsider.id,
        new_role: "member",
      })
    ).error,
  );
});

test("CRM dossier insert remains compatible and timestamps/authorship are server-owned", async () => {
  const { owner, company, organizationId } = await workspace();
  const dossier = await request(owner.id, "prospect_dossiers", "insert", {
    organization_id: organizationId,
    domain: "synthetic.invalid",
    company_name: "Synthetic",
    sender_website: "https://sender.invalid",
    updated_at: "forged",
  });
  assert.equal(dossier.error, null);
  assert.notEqual(dossier.data[0].updated_at, "forged");
  const activity = await request(owner.id, "activities", "insert", {
    organization_id: organizationId,
    company_id: company.id,
    type: "note",
    body: "Test",
    created_by: "forged",
  });
  assert.equal(activity.data[0].created_by, owner.id);
});

async function capturedToken(t, email) {
  const messages = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    messages.push(JSON.parse(options.body));
    return Response.json({ id: "synthetic" });
  });
  assert.equal(await verification.requestEmailVerification(email), undefined);
  const token = messages[0].text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
  return { token, messages };
}

test("real token workflow hashes storage, uses expiry, verifies only intended user and rejects replay", async (t) => {
  const target = await user("verify@elmofo.com.au", false);
  const other = await user("other@elmofo.com.au", false);
  const { token, messages } = await capturedToken(t, target.email);
  assert.deepEqual(messages[0].to, [target.email]);
  assert.match(messages[0].text, /https:\/\/spa.example.invalid\/verify-email#token=/);
  const key =
    "spa-intelligence:email-verify:token:" + createHash("sha256").update(token).digest("hex");
  assert.equal(fixture.values.get(key), target.id);
  assert.equal(fixture.expires.get(key), 1800000);
  assert.ok(!JSON.stringify([...fixture.values]).includes(token));
  await verification.confirmEmailVerification(token);
  assert.ok((await auth.userById(target.id)).email_confirmed_at);
  assert.equal((await auth.userById(other.id)).email_confirmed_at, null);
  assert.equal((await auth.membershipForUser(target.id)).role, "owner");
  await assert.rejects(verification.confirmEmailVerification(token), /Invalid or expired/);
});

test("expired, malformed and unknown tokens cannot verify a mailbox", async (t) => {
  const target = await user("verify@example.invalid", false);
  const { token } = await capturedToken(t, target.email);
  fixture.advance(1800001);
  for (const value of [token, "x", "x".repeat(43), "x".repeat(10000)])
    await assert.rejects(verification.confirmEmailVerification(value), /Invalid or expired/);
  assert.equal((await auth.userById(target.id)).email_confirmed_at, null);
});

test("provider rejection/timeout deletes tokens and sanitizes errors", async (t) => {
  const target = await user("verify@example.invalid", false);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("sensitive-provider-detail");
  });
  await assert.rejects(
    verification.requestEmailVerification(target.email),
    (error) => !error.message.includes("sensitive") && /Unable to send/.test(error.message),
  );
  assert.equal([...fixture.values.keys()].filter((k) => k.includes(":token:")).length, 0);
});

test("three-request rate window expires and unknown accounts mint no tokens", async (t) => {
  const target = await user("verify@example.invalid", false);
  const { messages } = await capturedToken(t, target.email);
  await verification.requestEmailVerification(target.email);
  await verification.requestEmailVerification(target.email);
  await assert.rejects(verification.requestEmailVerification(target.email), /Too many/);
  assert.equal(messages.length, 3);
  fixture.advance(3600001);
  await verification.requestEmailVerification(target.email);
  assert.equal(messages.length, 4);
  await verification.requestEmailVerification("unknown@example.invalid");
  assert.equal(messages.length, 4);
});

test("missing sender or unsafe origin fails closed without minting tokens", async () => {
  await user("verify@example.invalid", false);
  const saved = process.env.APP_ORIGIN;
  for (const origin of [
    "http://unsafe.invalid",
    "https://user:pass@unsafe.invalid",
    "https://spa.example.invalid/path",
  ]) {
    process.env.APP_ORIGIN = origin;
    await assert.rejects(
      verification.requestEmailVerification("verify@example.invalid"),
      /not configured/,
    );
  }
  process.env.APP_ORIGIN = saved;
  const key = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  await assert.rejects(
    verification.requestEmailVerification("verify@example.invalid"),
    /not configured/,
  );
  process.env.RESEND_API_KEY = key;
  assert.equal([...fixture.values.keys()].filter((k) => k.includes(":token:")).length, 0);
});

test("owner cannot forge owner invitations and malformed invitations fail closed", async () => {
  const { owner, organizationId } = await workspace();
  for (const role of ["owner", "unexpected", null])
    assert.equal(
      (
        await request(owner.id, "pending_invites", "insert", {
          organization_id: organizationId,
          email: "guest@example.invalid",
          role,
        })
      ).error?.code,
      "42501",
    );
  assert.equal(
    (
      await request(owner.id, "pending_invites", "insert", {
        organization_id: organizationId,
        email: "malformed",
        role: "member",
      })
    ).error?.code,
    "400",
  );
  const guest = await user("guest@example.invalid");
  const state = fixture.snapshot();
  state.pending_invites.push({
    id: "invalid",
    organization_id: "missing",
    email: guest.email,
    role: "member",
  });
  fixture.save(state);
  assert.equal((await auth.executeRpc(guest.id, "claim_invite")).error?.code, "42501");
  assert.equal(await auth.membershipForUser(guest.id), null);
});

test("concurrent token confirmations succeed once", async (t) => {
  const target = await user("verify@example.invalid", false);
  const { token } = await capturedToken(t, target.email);
  const outcomes = await Promise.allSettled([
    verification.confirmEmailVerification(token),
    verification.confirmEmailVerification(token),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
});

test("non-2xx mail response does not expose response body and rolls back token", async (t) => {
  const target = await user("verify@example.invalid", false);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("sensitive-provider-body", { status: 403 }),
  );
  await assert.rejects(verification.requestEmailVerification(target.email), /Unable to send/);
  assert.equal([...fixture.values.keys()].filter((k) => k.includes(":token:")).length, 0);
});
