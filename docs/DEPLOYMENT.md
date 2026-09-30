# Deployment

Prospect Finder B2B needs:

- Node.js 20+;
- a Redis-compatible datastore;
- environment variables;
- outbound HTTPS access.

## Build and start

```bash
npm install
npm run build
node .output/server/index.mjs
```

## Render

1. Create a Render Key Value service in the same region as the web service.
2. Enable persistence and use a no-eviction policy where available.
3. Create a Node web service connected to this repository.
4. Use:

Build:
```text
npm install && npm run build
```

Start:
```text
node .output/server/index.mjs
```

Environment:
```text
REDIS_URL=<internal Key Value URL>
SESSION_SECRET=<32+ random bytes>
OPENROUTER_API_KEY=<optional>
```

Keep one web instance with the current persistence model.

Verify `/health` after deployment.

## Other hosts

Any Node host with a reachable Redis-compatible datastore can use the same build/start commands.

## OpenRouter billing

OpenRouter billing is separate from hosting billing. Shared/public deployments should add rate limits, request-size limits and provider-side spending controls.
