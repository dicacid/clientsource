<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Single-org CRM: all tenancy enforced in Postgres (one_org_only index, RLS helpers, RPCs); client never inserts orgs/members — why: security must not rely on UI.
- Protected pages live under src/routes/_authenticated/_app/ (membership gate); onboarding sits outside _app — why: first-run flow needs a session but no membership.
- Website normalization rule exists twice (SQL normalize_website + src/lib/website.ts) and must stay identical — why: CSV matching and CHECK constraint.
- Prospect finder: AI + public-site reading run only in server functions (src/lib/prospect/*.server.ts), gated by workspace membership; emails must come from scraped pages — why: no invented contacts, keys stay server-side.
- Prospect engine is sender-agnostic: no sender-domain branching; operator-approved claims come in as approved_claims, stored per normalized sender domain in the browser; discovery excludes only the sender domain and this run's domains — why: one workspace serves many businesses without cross-contamination.
