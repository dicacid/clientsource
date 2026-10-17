# SPA Intelligence security release proposal

Date: 18 October 2026 (Australia/Sydney)
Repository: `dicacid/clientsource`
Review branch: `security/spa-hardening-20261018`
Reviewed starting commit: `dc545c81947e4779b701a9d4b3f5ad91fc4e3a78`

**Recommendation: retain as a review candidate. Production release is blocked by the gates below. No merge, deployment, infrastructure change, real email, or customer-data modification was performed.**

## Scope and review findings

Reviewed the ten hardening commits after the historical baseline `3115171fbe5d16cf7bf9fcbe32d18f574eac736a`, including the health response reduction, CRM write allow-list/reference checks and verified-email membership gates. The historical baseline/deploy recorded in the earlier review has not been revalidated as the current live deployment.

Read-only Render metadata in this session confirmed that `spa-intelligence` (`srv-daukeo59fdbs739aevc0`) uses `dicacid/clientsource`, auto-deploys commits from `spa-intelligence-demo`, has one instance, and has PR previews disabled. This review branch is separate. Service environment values, datastore credentials and customer records were not read.

The review found and repaired these concrete gaps:

- Verification delivery was a stub, with no usable confirmation or onboarding screen.
- The onboarding resolver tried claiming invitations for every account. Its new verification gate could therefore block legitimate, unverified legacy members despite retaining their membership rows.
- Invitation updates used the generic write path without role checks, allowing escalation of invitation privileges. Invitation editing now fails closed; the existing create/delete paths enforce roles. Inserts also validate invitation roles and email syntax, and claiming rejects dangling or invalid invitations.
- The new dossier insert allow-list rejected `updated_at`, which the actual prospect UI sends. Dossier insert/update accepts that compatibility field but assigns the timestamp on the server. Activity authorship remains assigned by the server; other tables cannot accept that field.

## Final behavior

New users can sign in but cannot join or create a workspace until verifying their mailbox. Onboarding offers a resend button and a refresh after verification. Approved company domains join automatically after verification; explicit invitations retain their assigned admin/member role. Existing membership and role records remain effective without backfilling a false verification timestamp or removing access.

The resend server function requires authentication and takes the recipient from the authenticated account, ignoring caller-supplied email. The implementation uses the existing Resend API convention, not a new provider. Configuration is server-only:

| Setting                   | Use                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`          | Required mail-provider credential; never included in browser output.                                                              |
| `EMAIL_VERIFICATION_FROM` | Sender address; falls back to existing `PASSWORD_RESET_FROM`.                                                                     |
| `APP_ORIGIN`              | Canonical HTTPS origin only, without credentials, path, query or fragment. Falls back to `https://spa-intelligence.onrender.com`. |
| `SPA_AUTO_ACCESS_DOMAINS` | Existing configurable domain allow-list; empty disables new automatic memberships. No value was changed.                          |

Tokens contain 32 random bytes. Only their SHA-256 digest is used as the Redis token key; token records expire after 30 minutes. `GETDEL` consumes each token once. A Redis transaction atomically increments the account's request count and sets its one-hour expiry using `EXPIRE NX`; at most three requests are accepted within that window. The datastore must support `GETDEL` and `EXPIRE NX` (confirm this before release). A failed/timeout mail request deletes its token and exposes a generic error, without logging provider bodies. The provider request times out after ten seconds. Delivery is implemented but was tested only with a mocked provider, with no actual messages sent.

Links carry the token in the URL fragment. The confirmation page removes the fragment on mount and requires an explicit button press before submitting a POST. Merely fetching the page does not consume a token. The page declares no-referrer and noindex metadata and loads no external logo. Confirmation neither signs a user in nor creates membership directly. A different browser can confirm the email, then sign in to resume onboarding. Links expire and cannot be reused; a datastore failure after consumption requires requesting another email.

## Validation and evidence

Fresh checkout in scratch, locked dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund`. Validation commands used a cleared environment (`env -i`) with only PATH, a temporary HOME, NODE_ENV and explicit synthetic build markers. No production credentials, `.env` files or datastore URLs were supplied. No dependency/lockfile changes were made.

Runtime: Node `v24.19.0`, npm `11.9.0`. Repository CI is configured for Node 22; this session did not execute GitHub Actions or verify the production Node version.

| Check                                       | Result                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original branch `npm test`                  | 48 passed, 12 failed, of 60; existing company-access tests still assumed automatic access without verification.                                                     |
| Final `npm test`                            | 79 passed, 0 failed.                                                                                                                                                |
| `npm run typecheck`                         | Passed, exit 0.                                                                                                                                                     |
| `npm run build`                             | Passed, exit 0, including its own 79-test run and production client/server build.                                                                                   |
| `npm run lint`                              | Failed, exit 1: 1,557 errors and 15 warnings.                                                                                                                       |
| Untouched starting commit ESLint comparison | 1,657 errors and 15 warnings; no new diagnostics by file/rule/message/multiplicity. 100 existing formatting errors removed from edited files.                       |
| Focused workflow lint                       | Passed for verification backend/server functions, membership resolver, onboarding, auth and confirmation page. State module retains pre-existing `any` diagnostics. |
| `git diff --check`                          | Passed.                                                                                                                                                             |
| Local built HTTP/SSR smoke                  | `/auth` and `/verify-email` returned 200 with expected content. `/health` returned 500 with no datastore configured; healthy datastore operation is unverified.     |
| Browser bundle scan                         | No synthetic secret markers or `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_VERIFICATION_FROM` identifiers found in emitted public JS/HTML/JSON/maps.                 |
| Browser interaction/visual checks           | Blocked: Chromium executable absent; attempted download returned an invalid ZIP. No claim of hydration, responsive layout or end-to-end browser verification.       |

Synthetic tests exercise real password/session/state/token logic with an in-process Redis command fixture. Coverage includes unverified enrolment denial, legacy members, invitation claims and roles, foreign-workspace reads/updates/deletes/inserts, foreign keys, unknown tables/actions/RPCs, immutable fields, last-owner protections, dossier compatibility, server-owned authorship, hashed token storage, expiry, replay/concurrent confirmation, request limits, delivery failure cleanup and safe origin configuration.

Additional boundary tests run the actual authorization middleware, server validators and onboarding resolver using a minimal server-function dispatch harness. Missing, forged and expired bearer tokens fail, and authenticated resend cannot redirect mail to a supplied address. This harness does not test TanStack's HTTP transport or CSRF implementation. Fixture expiry/transactions model Redis behavior; no real Redis process was used. Existing source-contract tests remain supplemental.

The generated route tree was regenerated by the build, not manually edited. Source and validation summaries are committed together; temporary full logs/build products are excluded from Git.

## Required release gates, in order

1. Resolve the full-repository lint failure before calling the release green. This branch introduces no additional diagnostic instances; the existing debt is still a failing check. Any decision to accept that debt requires a separately recorded release exception.
2. Run CI with the repository's Node 22 configuration. Test against a disposable Redis instance with distinct synthetic state/token namespaces, confirming actual TTL, atomic transaction and concurrent `GETDEL` behavior. Never point fixture tests at production Redis.
3. Confirm the approved sender/domain and existing mail configuration without exposing values. Any missing production configuration requires explicit approval before changing it. Test delivery, fragments surviving email-client link handling, invalid/expired/replayed links, resend, new automatic-domain users and invited external users using approved synthetic recipients and disposable data.
4. Complete desktop/mobile browser tests: signup, verification prompt, confirmation, refresh, legacy member sign-in, invitation role preservation, protected-page denial, CRM dossier persistence, tenders and approval workflows. Check actual CSRF behavior and public response headers/CSP. No live customer accounts may be used as fixtures.
5. Confirm the actual deployed SHA, rollback target, datastore attachment, backup/restore readiness and compatible Redis command support through approved read-only inspection. The mutation queue remains process-local; do not increase replica count as part of this release.
6. Obtain explicit approval naming the exact reviewed candidate commit, production target `spa-intelligence-demo`, allowed mail/config changes (if any), rollout checks and rollback criteria. Only then may an approved release operator merge/cherry-pick and deploy.

## Proposed rollout after approval only

Release the complete reviewed range beginning after `3115171fbe5d16cf7bf9fcbe32d18f574eac736a`, plus this continuation, to the confirmed production base after checking divergence. Do not merge into `main` as a substitute for the actual SPA production branch. Recheck the candidate diff for secrets and unrelated changes immediately before release.

No destructive migration is included. Verification writes a previously absent `email_verified_at` only when a valid token is confirmed. Existing members retain access. During the approved rollout, observe health, new-user enrolment, legacy sign-in, invitation claims, CRM writes and mail failures. Stop rollout for unexpected denials, elevated errors, wrong workspace/role assignment or mail failure.

For rollback, use the confirmed pre-release code target and verify the resulting deployment. Do not automatically restore the datastore: doing so could overwrite legitimate customer work. Verification timestamps and token keys are not undone by a code rollback. Reverting to the historical pre-hardening baseline also restores its unverified-domain-access vulnerability and therefore requires an explicit risk decision; prefer a targeted forward fix if feasible. Bearer sessions are not revoked by a code rollback.

## Residual limits

Sign-out still clears client/cookie state without server-side bearer revocation. Tokens remain valid until expiration, including after password reset; this was observed in existing source, not repaired or presented as solved. Browser local-storage session behavior, live headers/CSP, live mail, backup recovery, full browser flow and distributed concurrency remain unverified. This proposal does not certify the entire application as secure.
