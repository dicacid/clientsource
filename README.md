# Pipeline — private B2B prospecting workspace

A small internal CRM for one sales team: target companies, contacts, a pipeline and a manual activity log.
It is **not** a lead database, enrichment tool or email sender.

## Stack

React 19 + Vite + TypeScript + Tailwind v4, dark UI, Supabase Auth (email + password), Supabase JS client only.
Routing and protected routes use **TanStack Router** (file-based, `src/routes/`) — the hosting platform's fixed router,
used in place of React Router. Protected pages live under `src/routes/_authenticated/`, which redirects to `/auth`
without a session. No Edge Functions, no service-role key in the frontend, no `auth.admin` calls.

## Setup

1. Create a Supabase project.
2. In **Authentication → Providers → Email**, enable email/password and **keep "Confirm email" ON**.
   The confirmation email is sent by Supabase, not by this app.
3. Run every file in `supabase/migrations/` in order (SQL editor or `supabase db push`).
4. Copy `.env.example` to `.env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   (Inside Lovable these are provided automatically as `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`.)
5. `npm install && npm run dev`.

## First run

After sign-in the app:

1. Shows "Confirm your email, then sign in again." if the email is unconfirmed (no workspace button).
2. Calls `claim_invite()`.
3. Enters the app if the user is a member.
4. If no organization exists: one screen, "Create your workspace" → `create_workspace(name)`.
5. If an organization exists and the user is not a member: "Ask the owner to invite this email." (no create button).

A second, uninvited signup can neither create nor see the workspace.

## Security model

- Exactly one organization, enforced in the database: `create unique index one_org_only on organizations ((true))`.
  Even if a policy were wrong, a second row in `organizations` is impossible.
- `insert/delete` on `organizations` and `insert/update` on `organization_members` are revoked from clients.
  Rows are created only by `create_workspace()` and `claim_invite()`; roles change only via `set_member_role()`.
- Every public table has RLS, authenticated-only policies, no anon policies.
- Helpers `is_org_member`, `is_org_admin`, `is_org_owner`, `shares_org` are `security definer`, `search_path = public`,
  execute revoked from `public`/`anon`, granted to `authenticated`.
- A trigger rejects deleting or demoting the last owner.
- Contacts reference companies by `(organization_id, company_id)` with `ON DELETE RESTRICT`: a company with
  contacts cannot be deleted, and a contact can never point at another org's company.
- Activities reference contacts with `ON DELETE SET NULL (contact_id)`: deleting a contact keeps the activity.
- Websites are normalized by the same rule in SQL (`normalize_website()`, also a CHECK constraint) and TypeScript
  (`src/lib/website.ts`): trim → empty=null → lowercase → strip scheme → strip `www.` → cut at `/ ? #` →
  strip trailing dot → reject if empty/no dot → store `https://host`.
- Dashboard uses head-count queries only; there are no views.

## RLS test (run in the SQL editor)

The SQL editor runs as `postgres`, which **bypasses RLS**, and `auth.uid()` is null there. The script below switches
to the `authenticated` role and fakes a JWT. User A is the owner, user B is a confirmed non-member, only one org exists.
Replace the uuids, run it, and it rolls back.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<user-a-uuid>","role":"authenticated"}', true);
select count(*) as a_companies from companies;
select set_config('request.jwt.claims', '{"sub":"<user-b-uuid>","role":"authenticated"}', true);
select count(*) as b_sees_a from companies;
-- b_sees_a must be 0
insert into companies (organization_id, name, status)
values ('<org-a-uuid>', 'should fail', 'new');
-- that insert must fail
select create_workspace('x');
-- that call must raise
rollback;
```

Run statements one at a time (or each in its own transaction) since a failing statement aborts the transaction.
A second `create_workspace()` from user A must also raise (`ALREADY_MEMBER`). The unique index `one_org_only` is what
makes a second organization impossible even if a policy is wrong.

## CSV

Parsed client-side with Papa Parse, previewed, inserted only after confirm. Max 2,000 rows, batches of 500, per-row
errors (a failing batch is retried row by row). Only whitelisted columns are read; `organization_id` always comes from
the session. Company columns: `name, website, industry, country, employee_range, status, notes`. Contact columns:
`full_name, job_title, email, phone, company_name, company_website, status, next_follow_up, notes` — matched by
normalized website, then exact case-insensitive name; unmatched rows are skipped. Export writes the current filtered
view and prefixes cells starting with `= + - @` with `'`.

## File tree

```text
supabase/migrations/          all schema, RLS, helpers, RPCs, seed function
src/lib/website.ts            shared website normalizer
src/lib/csv.ts                parse / export / formula escaping
src/lib/session.ts            claim_invite + membership resolution, sign-out
src/lib/errors.ts             friendly RLS / last-owner / restrict-delete messages
src/lib/constants.ts          enums, local-date helper
src/lib/workspace.ts          current membership hook
src/components/crm/           forms, company drawer, shared UI
src/routes/auth.tsx           sign in / sign up
src/routes/_authenticated/route.tsx        session gate
src/routes/_authenticated/onboarding.tsx   first-run flow
src/routes/_authenticated/_app.tsx         membership gate + layout
src/routes/_authenticated/_app/dashboard.tsx
src/routes/_authenticated/_app/companies.tsx
src/routes/_authenticated/_app/contacts.tsx
src/routes/_authenticated/_app/members.tsx
src/routes/_authenticated/_app/import.tsx
```

## Not in this build

Email sending, enrichment, scraping, third-party APIs, Edge Functions, and invite emails.
If email is ever added, consent and unsubscribe come first. There is no send button.
