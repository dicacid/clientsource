# Pipeline — private B2B prospecting workspace

Internal CRM and prospecting workspace for one sales team.

## Runtime

- React 19 + TanStack Start + TypeScript + Tailwind
- Hosted on Render
- Persistent data stored in Render Key Value over the private Render network
- Email/password authentication is handled by the app itself with scrypt password hashes and signed sessions
- No external database/auth platform is required
- Prospecting AI uses OpenRouter when `OPENROUTER_API_KEY` is configured

## Render configuration

Required environment variables:

```text
REDIS_URL=redis://<render-key-value-host>:6379
SESSION_SECRET=<32+ random characters>
OPENROUTER_API_KEY=<optional, required for Prospect finder AI>
```

The production service runs:

```text
npm install && npm run build
node .output/server/index.mjs
```

## First run

1. Open `/auth`.
2. Create an account.
3. Sign in.
4. The first account can create the single workspace and becomes its owner.
5. Additional users must be added as pending invites by email before they can join.

## Security model

- Passwords are never stored in plaintext; the server stores scrypt hashes.
- Sessions are signed server-side with `SESSION_SECRET`.
- Protected server functions validate the signed session before handling requests.
- All CRM reads and writes are scoped to the signed-in user's workspace on the server.
- Only owners can promote/demote owners or admins; owners/admins can manage members.
- The last owner cannot be removed or demoted.
- Company deletion is blocked while contacts still reference it.
- Deleting a contact preserves activity history and clears the activity's contact reference.
- Website values are normalized to `https://host`.
- The Render Key Value instance is private-network only and configured with persistent journal/snapshot storage.

## Main areas

- `/prospect` — analyze a sender website, discover matching companies, research public contacts and draft outreach
- `/dashboard` — pipeline counts and follow-ups
- `/companies` — companies, filtering, editing and export
- `/contacts` — contacts, filtering, follow-ups and export
- `/import` — CSV import
- `/members` — workspace roles and pending invites
- `/settings` — AI provider status

The app does not send outreach email itself. Drafts are reviewed and opened in the user's mail client.
