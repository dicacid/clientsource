<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to Lovable. Avoid rewriting published Git history
> while that connection is active unless you intentionally plan to reconnect it.
<!-- LOVABLE:END -->

## Architecture rules

- Do not add Supabase as a runtime dependency.
- Persistent state and app-native auth live in `src/integrations/render/`. The folder name is historical; persistence is Redis-compatible.
- Protected pages/functions must enforce auth and workspace membership on the server.
- Passwords remain server-side and are stored only as salted scrypt hashes.
- `SESSION_SECRET`, datastore credentials and AI keys must never reach browser bundles, route payloads or logs.
- The state mutation queue is process-local. Do not claim horizontal-scaling safety without distributed concurrency control.
- Prospect AI and public-site reads run only on the server and behind workspace membership.
- Never invent contact names or email addresses.
- Keep the prospect engine sender-agnostic. Do not hard-code a contributor's business or campaign into generic logic.
- `src/routeTree.gen.ts` is generated. Do not edit it manually.
- Treat outbound website fetching as security-sensitive and keep it bounded.
