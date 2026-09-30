# Security Policy

## Supported version

This project is pre-1.0. Security fixes are applied to the latest `main` branch.

## Reporting a vulnerability

Do **not** publish exploit details, credentials or private data in a public issue.

If GitHub shows **Report a vulnerability** in the Security tab, use it. Otherwise open a minimal issue titled **Security contact request** with no exploit details so a private contact path can be arranged.

## Secret handling

Never commit:

- `.env` files;
- OpenRouter keys;
- credential-bearing Redis URLs;
- `SESSION_SECRET`;
- production exports or customer/contact data.

If a secret is committed, deleting it later is not enough. Rotate the credential and remove it from Git history before public release when appropriate.

## Known security limitations

- Session bearer tokens are currently stored in browser local storage. XSS could expose them.
- Workspace invites are matched by email without built-in email verification.
- State mutation serialization is process-local and assumes one app instance.
- The website reader follows outbound HTTP redirects and needs stronger SSRF/DNS-rebinding protection before untrusted public use.
- No independent security audit has been completed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
