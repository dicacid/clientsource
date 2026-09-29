import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPANY_STATUSES, label, localDate } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { EmptyState, PageHeader, StatusBadge } from "@/components/crm/shared";

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Pipeline" },
      { name: "description", content: "Pipeline overview and upcoming follow-ups." },
      { property: "og:title", content: "Dashboard — Pipeline" },
      { property: "og:description", content: "Pipeline overview and upcoming follow-ups." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const today = localDate();
  const in7 = localDate(7);

  const q = useQuery({
    queryKey: ["dashboard", ws.organizationId, today],
    queryFn: async () => {
      const org = ws.organizationId;
      const head = { count: "exact" as const, head: true };
      const [companies, contacts, ...statuses] = await Promise.all([
        supabase.from("companies").select("id", head).eq("organization_id", org),
        supabase.from("contacts").select("id", head).eq("organization_id", org),
        ...COMPANY_STATUSES.map((s) => supabase.from("companies").select("id", head).eq("organization_id", org).eq("status", s)),
      ]);
      const due = await supabase
        .from("contacts")
        .select("id, full_name, next_follow_up, status, companies(name)", { count: "exact" })
        .eq("organization_id", org)
        .gte("next_follow_up", today)
        .lte("next_follow_up", in7)
        .not("status", "in", "(customer,lost)")
        .order("next_follow_up")
        .limit(20);
      for (const r of [companies, contacts, ...statuses, due]) if (r.error) throw r.error;
      return {
        companies: companies.count ?? 0,
        contacts: contacts.count ?? 0,
        funnel: COMPANY_STATUSES.map((s, i) => ({ status: s, count: statuses[i]!.count ?? 0 })),
        due: due.data ?? [],
        dueCount: due.count ?? 0,
      };
    },
  });

  async function seed() {
    const { error } = await supabase.rpc("seed_sample_data");
    if (error) return toast.error(friendlyError(error));
    toast.success("Sample data loaded");
    qc.invalidateQueries();
  }

  const canSeed = ws.role === "owner" || ws.role === "admin";
  const max = Math.max(1, ...(q.data?.funnel.map((f) => f.count) ?? [1]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dashboard"
        sub={`Today is ${today} (your local date)`}
        actions={
          canSeed && q.data && q.data.companies === 0 ? (
            <Button variant="outline" onClick={seed}>
              Load sample data
            </Button>
          ) : null
        }
      />
      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-64 sm:col-span-2" />
        </div>
      ) : q.error ? (
        <p className="text-destructive">{friendlyError(q.error)}</p>
      ) : q.data!.companies === 0 ? (
        <EmptyState
          title="No companies yet."
          action={
            canSeed ? (
              <Button onClick={seed}>Load sample data</Button>
            ) : (
              <Button asChild>
                <Link to="/companies">Add a company</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat k="Companies" v={q.data!.companies} />
          <Stat k="Contacts" v={q.data!.contacts} />
          <section className="rounded-lg border bg-card p-5 sm:col-span-2">
            <h2 className="mb-4 text-sm font-semibold">Pipeline</h2>
            <div className="space-y-2">
              {q.data!.funnel.map((f) => (
                <div key={f.status} className="grid grid-cols-[110px_1fr_40px] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{label(f.status)}</span>
                  <div className="h-5 rounded bg-muted">
                    <div className="h-5 rounded bg-primary/80" style={{ width: `${(f.count / max) * 100}%` }} />
                  </div>
                  <span className="text-right font-mono">{f.count}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border bg-card p-5 sm:col-span-2">
            <h2 className="mb-4 text-sm font-semibold">
              Follow-ups due {today} → {in7} <span className="font-mono text-primary">({q.data!.dueCount})</span>
            </h2>
            {q.data!.due.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due this week.</p>
            ) : (
              <ul className="divide-y">
                {q.data!.due.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{c.full_name}</span>
                      <span className="text-muted-foreground"> · {(c.companies as { name: string } | null)?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={c.status} />
                      <span className="font-mono text-xs">{c.next_follow_up}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mt-1 font-mono text-3xl">{v}</div>
    </div>
  );
}
