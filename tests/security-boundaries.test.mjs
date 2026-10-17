import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { securityFixture } from "./helpers/security-fixture.mjs";

const fixture = await securityFixture();
let headers = new Headers();
let currentUser;
const boundary = Symbol.for("spa.test.boundaries");
globalThis[boundary] = {
  request: () => new Request("https://spa.example.invalid", { headers }),
  client: {
    auth: { getUser: async () => ({ data: { user: await fixture.auth.userById(currentUser) } }) },
    rpc: (fn, args) => fixture.auth.executeRpc(currentUser, fn, args),
    from(table) {
      let filters = [];
      return {
        select() {
          return this;
        },
        eq(column, value) {
          filters.push({ op: "eq", column, value });
          return this;
        },
        maybeSingle: () =>
          fixture.auth.executeDbRequest(currentUser, {
            table,
            action: "select",
            filters,
            mode: "maybeSingle",
          }),
      };
    },
  },
};
const asModule = (code) => "data:text/javascript," + encodeURIComponent(code);
// This models server-function dispatch only. It is not an HTTP/browser test
// of TanStack's implementation. Middleware and validators run their real code.
const framework = asModule(`
 export function createMiddleware() { return { server: fn => fn }; }
 export function createServerFn() {
   let middlewares = [], validate = value => value;
   return {
     middleware(value) { middlewares = value; return this; },
     inputValidator(value) { validate = value; return this; },
     handler(fn) { return async (input = {}) => {
       const run = (i, context) => i < middlewares.length
         ? middlewares[i]({ context, next: ({ context: added }) => run(i + 1, { ...context, ...added }) })
         : fn({ context, data: validate(input.data) });
       return run(0, {});
     }; }
   };
 }
`);
const server = asModule(
  `export function getRequest() { return globalThis[Symbol.for("spa.test.boundaries")].request(); }`,
);
const client = asModule(
  `export const renderDb = globalThis[Symbol.for("spa.test.boundaries")].client;`,
);
const unused =
  asModule(`export function clearSessionCookie() {} export function setSessionCookie() {}
 export function confirmPasswordReset() {} export function requestPasswordReset() {}`);
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@tanstack/react-start") return { url: framework, shortCircuit: true };
    if (specifier === "@tanstack/react-start/server") return { url: server, shortCircuit: true };
    if (specifier === "@/integrations/render/client") return { url: client, shortCircuit: true };
    if (["./session.server", "./password-reset.server"].includes(specifier))
      return { url: unused, shortCircuit: true };
    if (context.parentURL?.startsWith(root.href) && specifier.startsWith(".")) {
      const url = new URL(specifier, context.parentURL);
      if (!url.pathname.endsWith(".ts")) url.pathname += ".ts";
      return next(url.href, context);
    }
    return next(specifier, context);
  },
});
const functions = await import(new URL("integrations/render/server.functions.ts", root));
const { resolveMembership } = await import(new URL("lib/session.ts", root));
hooks.deregister();

const password = "Synthetic-password-123!";
test("verification request rejects missing, forged and expired bearer authentication", async () => {
  const u = (await fixture.auth.signUp("test@example.invalid", password, "Test")).user;
  const session = await fixture.auth.signIn(u.email, password);
  for (const value of [null, "Bearer forged.token"]) {
    headers = new Headers(value ? { authorization: value } : {});
    await assert.rejects(
      functions.requestEmailVerificationRequest({ data: { email: "attacker@example.invalid" } }),
      /Unauthorized/,
    );
  }
  // A correctly signed but expired session also fails the real token verifier.
  const now = Date.now;
  Date.now = () => now() + 31 * 24 * 3600 * 1000;
  try {
    headers = new Headers({ authorization: `Bearer ${session.access_token}` });
    await assert.rejects(functions.requestEmailVerificationRequest(), /Unauthorized/);
  } finally {
    Date.now = now;
  }
});

test("verification request binds recipient to authenticated user, ignoring supplied email", async (t) => {
  const u = (await fixture.auth.signUp("recipient@example.invalid", password, "Test")).user;
  const session = await fixture.auth.signIn(u.email, password);
  headers = new Headers({ authorization: `Bearer ${session.access_token}` });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).to, [u.email]);
    return Response.json({ id: "synthetic" });
  });
  assert.deepEqual(
    await functions.requestEmailVerificationRequest({
      data: { email: "attacker@example.invalid" },
    }),
    { ok: true },
  );
});

test("confirmation server validator rejects unbounded/malformed input", async () => {
  for (const token of ["", "x".repeat(10000), null])
    await assert.rejects(functions.confirmEmailVerificationRequest({ data: { token } }));
});

test("onboarding resolves unverified new users to verification and preserves legacy members", async () => {
  const u = (await fixture.auth.signUp("onboarding@example.invalid", password, "Test")).user;
  currentUser = u.id;
  assert.deepEqual(await resolveMembership(), { state: "verify_email" });
  await fixture.auth.markVerifiedEmail(u.id);
  assert.deepEqual(await resolveMembership(), { state: "no_org" });
  const created = await fixture.auth.executeRpc(u.id, "create_workspace", {
    org_name: "Synthetic",
  });
  assert.equal(created.error, null);
  const state = fixture.snapshot();
  delete state.users.find((row) => row.id === u.id).email_verified_at;
  fixture.save(state);
  const result = await resolveMembership();
  assert.equal(result.state, "member");
  assert.equal(result.membership.role, "owner");
});
