# Contributing to Prospect Finder B2B

Thanks for contributing. This guide is written for both experienced developers and people opening their first pull request.

## Before you start

Read [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Important project rules:

- Never commit secrets or real customer data.
- Do not add Supabase as a runtime dependency.
- Keep auth, membership checks, AI calls and public-site fetching on the server.
- Do not hard-code your own business, domain, campaign claims or customers into the generic prospecting engine.
- Do not invent contacts or email addresses.
- Do not edit `src/routeTree.gen.ts` by hand.

## First contribution

1. Fork the repository.
2. Clone your fork.
3. Create a branch:
   ```bash
   git switch -c fix/short-description
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Start local Redis:
   ```bash
   docker compose up -d redis
   ```
6. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
7. Add a random `SESSION_SECRET`.
8. Run:
   ```bash
   npm run dev
   ```

## Before opening a pull request

```bash
npm run lint
npm run build
```

If your change affects auth, persistence, invites, prospect research or AI behavior, include exact manual test steps.

The project does not yet have a comprehensive automated test suite. Adding one is a high-value contribution.

## Pull requests

Explain:

- what changed;
- why it changed;
- how it was tested;
- screenshots for visible UI changes;
- security or migration implications.

Keep pull requests focused and reasonably small.

## Issues

For bugs include expected behavior, actual behavior, reproduction steps, browser/runtime details and relevant logs with secrets removed.

For features, describe the user problem before prescribing an implementation.

Never post API keys, session secrets, credential-bearing Redis URLs, customer lists or vulnerability exploit details in a public issue.

## Security-sensitive files

Extra review is appropriate for:

- `src/integrations/render/state.server.ts`
- `src/integrations/render/auth-middleware.ts`
- `src/lib/session.ts`
- `src/lib/prospect/*`

See [SECURITY.md](SECURITY.md).
