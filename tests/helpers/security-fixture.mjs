import { registerHooks } from "node:module";

// In-process Redis command fixture. No network, credentials, real mail or real
// user records. The production state/auth/token functions remain unchanged.
export async function securityFixture() {
  const key = "spa-intelligence:test:security";
  process.env.STATE_KEY = key;
  process.env.SESSION_SECRET = "synthetic-only-session-secret-at-least-32-characters";
  process.env.RESEND_API_KEY = "synthetic-mail-key";
  process.env.EMAIL_VERIFICATION_FROM = "security@example.invalid";
  process.env.APP_ORIGIN = "https://spa.example.invalid";
  delete process.env.SPA_AUTO_ACCESS_DOMAINS;
  let now = 0;
  const values = new Map();
  const expires = new Map();
  const client = {
    async get(k) {
      if (expires.has(k) && expires.get(k) <= now) {
        values.delete(k);
        expires.delete(k);
      }
      return values.get(k) ?? null;
    },
    async set(k, value, options) {
      values.set(k, value);
      if (options?.EX) expires.set(k, now + options.EX * 1000);
    },
    async del(k) {
      values.delete(k);
      expires.delete(k);
    },
    async getDel(k) {
      const value = expires.has(k) && expires.get(k) <= now ? null : (values.get(k) ?? null);
      values.delete(k);
      expires.delete(k);
      return value;
    },
    multi() {
      let rateKey;
      let ttl;
      return {
        incr(k) {
          rateKey = k;
          return this;
        },
        expire(k, seconds, mode) {
          if (k !== rateKey || mode !== "NX") throw new Error("Unexpected rate transaction");
          ttl = seconds;
          return this;
        },
        async exec() {
          const count = Number((await client.get(rateKey)) || 0) + 1;
          values.set(rateKey, String(count));
          if (!expires.has(rateKey)) expires.set(rateKey, now + ttl * 1000);
          return [count, 1];
        },
      };
    },
  };
  const symbol = Symbol.for("spa-intelligence.test.security.redis");
  globalThis[symbol] = client;
  const stub =
    "data:text/javascript," +
    encodeURIComponent(`export function createRedisConnection() {
    const client = globalThis[Symbol.for("spa-intelligence.test.security.redis")];
    return async () => client;
  }`);
  const root = new URL("../../src/", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith(root.href) && specifier === "./redis.server")
        return { url: stub, shortCircuit: true };
      if (context.parentURL?.startsWith(root.href) && specifier.startsWith(".")) {
        const url = new URL(specifier, context.parentURL);
        if (!url.pathname.endsWith(".ts")) url.pathname += ".ts";
        return next(url.href, context);
      }
      return next(specifier, context);
    },
  });
  const auth = await import(new URL("integrations/render/state.server.ts", root));
  const verification = await import(
    new URL("integrations/render/email-verification.server.ts", root)
  );
  hooks.deregister();
  delete globalThis[symbol];
  return {
    auth,
    verification,
    values,
    expires,
    key,
    reset() {
      values.clear();
      expires.clear();
      now = 0;
    },
    advance(ms) {
      now += ms;
    },
    snapshot() {
      return JSON.parse(values.get(key));
    },
    save(state) {
      values.set(key, JSON.stringify(state));
    },
  };
}
