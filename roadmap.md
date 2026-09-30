# Roadmap

## Working today

- [x] Single-workspace CRM with companies, contacts, activities and CSV import/export
- [x] App-native email/password authentication and role-based membership
- [x] Redis-compatible persistent state
- [x] Sender-agnostic Prospect Finder
- [x] Public-site evidence and published-email extraction
- [x] Optional OpenRouter-assisted discovery and drafting
- [x] Australia / international / both targeting
- [x] Render-compatible Node deployment and health probe
- [x] Persistent prospect intelligence dossiers with evidence and timing signals
- [x] Multi-step follow-up draft sequences
- [x] Outcome capture with lightweight targeting feedback

## High priority

- [ ] Add automated tests for auth, membership, CRUD and prospect guardrails
- [ ] Move browser sessions to HttpOnly, Secure, SameSite cookies
- [ ] Replace email-only invite claiming with verified invite tokens or email verification
- [ ] Add SSRF/private-network/DNS-rebinding protection to outbound website fetching
- [ ] Add distributed-safe persistence for horizontal scaling
- [ ] Add backup/restore tooling
- [ ] Make the domestic country configurable

## Contributor-friendly improvements

- [ ] Seed/demo data
- [ ] First-run developer diagnostics
- [ ] Mocked OpenRouter integration tests
- [ ] Accessibility and keyboard improvements
- [ ] AI provider adapters
- [ ] State-schema migration framework
- [ ] Rich relationship graph across contacts, referrals and related organisations
