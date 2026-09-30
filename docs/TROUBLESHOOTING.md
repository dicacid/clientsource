# Troubleshooting

## App cannot start

Confirm `.env` contains `REDIS_URL` and `SESSION_SECRET`. For local development:

```text
REDIS_URL=redis://localhost:6379
```

Start Redis with:

```bash
docker compose up -d redis
```

## Prospect Finder says OpenRouter is not configured

Set `OPENROUTER_API_KEY` in the **server** environment and restart/redeploy.

## OpenRouter 401 / key rejected

The provider rejected the credential. Replace it with a valid key and redeploy.

## OpenRouter 402 / out of credits

OpenRouter billing is separate from Render or another host. Check the provider account associated with the key.

## Build fails after route edits

Do not edit `src/routeTree.gen.ts` manually. Fix the source route and rerun `npm run build`.

## Render shows an old version

Confirm the Render service is connected to the intended GitHub repository/branch and that its deployment commit matches GitHub.

Lovable and Render are separate deployment targets even when they read the same repository.

## Before asking for help

Include commit SHA, environment, exact command, relevant error text and reproduction steps. Remove secrets and customer data first.
