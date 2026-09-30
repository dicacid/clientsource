# Architecture

## Overview

```text
Browser
  |
  | TanStack Start routes + server functions
  v
Node/Nitro app
  |                 \
  |                  \ optional
  v                   v
Redis-compatible      OpenRouter
datastore
```

Prospect research also makes bounded server-side requests to public company websites.

## Authentication

App-native authentication lives mainly in `src/integrations/render/state.server.ts`.

- Passwords use salted scrypt hashes.
- Signed sessions use HMAC-SHA256 and `SESSION_SECRET`.
- Protected server functions resolve session and workspace membership.
- The first user can create the workspace and becomes owner.
- The last owner cannot be removed or demoted.

Browser sessions currently use a signed bearer token in local storage. Moving to HttpOnly cookies is a planned hardening change.

## Persistence

The application stores one versioned JSON state document in Redis-compatible storage.

A process-local write queue serializes mutations within one Node process. That is not a distributed lock. Run one web instance unless you replace the mutation strategy.

## Prospect Finder

`src/lib/prospect/` contains:

- `web.server.ts` — bounded public-web reading and email extraction;
- `ai.server.ts` — optional OpenRouter access;
- `prospect.functions.ts` — sender analysis, target discovery, research and drafting.

The engine should remain sender-agnostic. Business-specific approved claims are operator data, not source-code defaults.

## Public website fetching

Outbound reads are server-side, time-limited and content-size limited. They do not log in or bypass access controls.

Arbitrary outbound fetching is security-sensitive; stronger private-IP/loopback/DNS-rebinding checks are still needed before untrusted public use.

## Lovable

The repository remains connected to Lovable and uses `@lovable.dev/vite-tanstack-config` at build time. Lovable is not in the production runtime data path.
