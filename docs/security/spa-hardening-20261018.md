# SPA Intelligence security hardening review — 2026-10-18

## Production baseline and rollback

- Render service: spa-intelligence (srv-daukeo59fdbs739aevc0)
- Repository: dicacid/clientsource, auto-deployed branch spa-intelligence-demo
- Verified live baseline commit: 3115171fbe5d16cf7bf9fcbe32d18f574eac736a
- Render deploy: dep-db9p1k3m8hqs73aneko0
- This review branch is **not** the production branch.
- Release gate: obtain approval before merging/cherry-picking onto the auto-deploy branch.
- Code rollback: revert the approved production hardening commit(s) on spa-intelligence-demo or restore the baseline commit through a reviewed branch update; verify Render deploy and /health, /auth, protected routes, tenders and approval workflows. Code rollback does not restore changed data, invalidate tokens, or reverse schema migrations.

## Verified in source

- src/integrations/render/server.functions.ts: dbRequest and rpcRequest use requireRenderUser middleware.
- src/integrations/render/auth-middleware.ts: validates bearer token via verifySessionToken.
- src/integrations/render/state.server.ts: executeDbRequest explicitly allow-lists table and action names; scopedRows filters reads by member organization; insertRows checks organization_id; updateRows and deleteRows select scoped candidates. executeRpc recognizes explicit function names and restricts set_member_role to owners.
- src/start.ts: explicit createCsrfMiddleware for server functions.
- src/lib/health.functions.ts: original public output includes datastore, tender routing and AI environment indicators; this branch minimizes the response.
- src/integrations/render/state.server.ts: signUp creates a user without proof of mailbox ownership; publicUser sets email_confirmed_at equal to created_at. ensureCompanyMembership grants company-domain users membership on sign-in, and membershipForUser may grant it to existing sessions. This is **not** email verification.
- src/integrations/render/state.server.ts: updateRows permits arbitrary keys for tables other than profiles, except id, organization_id, created_at and user_id. In particular, it does not validate every writable column or constrain changes to contact company_id. This is a concrete authorization/integrity hardening gap requiring regression tests and a compatible field policy before production release.
- src/integrations/render/state.server.ts: HMAC bearer tokens expire after 30 days; verifySessionToken checks signature and expiration but does not appear to consult a per-session revocation list. Sign-out clears the cookie; it does not by itself revoke an already-issued bearer token.
- src/integrations/render/redis.server.ts: REDIS_URL is required; actual URL and linked instance have not been read or exposed.
- Render lists clientsource-state as Starter with journal_snapshot and noeviction; edge-ops-state is Free with persistence off. Mapping REDIS_URL to the instance is not yet confirmed.

## Unverified

- End-to-end auth, workspace isolation, and user-role tests against synthetic fixtures.
- Whether current production HTTP responses have security headers and a compatible CSP.
- Exact live Redis attachment, backup and restore history.
- Current browser storage behavior and migration compatibility.
- Sign-in, prospect, tender, approval and outbound email smoke tests.

## Release gates

1. Add and run synthetic-fixture regression tests for table/column/action/RPC validation, role boundaries and cross-workspace mutations.
2. Implement a verified-email enrolment flow with a transition plan for existing legitimate users; do not silently lock out users.
3. Restrict writable fields and cross-table foreign-key changes, checking all actual client write paths.
4. Inventory CSP requirements and verify browser headers against real responses.
5. Run npm test, npm run typecheck and npm run build in an isolated environment; confirm production smoke tests.
6. Approve production release explicitly. No service-plan, DNS, billing, datastore or secret changes as part of this branch.
