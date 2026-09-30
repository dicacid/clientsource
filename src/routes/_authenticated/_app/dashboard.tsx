import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ExternalLink, Radar, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import { researchSpaIndustryStaged } from "@/lib/spa/research.functions";
import { getResearchHistory } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  head: () => ({ meta: [{ title: "Opportunity Radar — SPA Intelligence" }] }),
  component: OpportunityRadar,
});

function Source({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Evidence <ExternalLink className="h-3 w-3" /></a>;
}

function OpportunityRadar() {
  const scan = useServerFn(researchSpaIndustryStaged);
  const history = useServerFn(getResearchHistory);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await history();
        const latest = rows.find((row: any) => row.researchType === "opportunity-radar");
        if (latest?.result) setData(latest.result);
      } catch {
        /* A missing history record should never block a fresh scan. */
      }
    })();
  }, []);

  async function run() {
    setBusy(true); setError(null); setData(null);
    try {
      setData(await scan({ data: { industry: "Mining, resources and remote industrial infrastructure", region: "Australia", focus: "Remote power, BESS, hybrid energy, diesel displacement, electrification and industrial solar", businessContext: "spa", purpose: "opportunity-radar" } }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">SPA Intelligence / flagship</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Opportunity Radar</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">What should Brett pay attention to? This scan searches current public signals and keeps evidence separate from commercial inference.</p>
        </div>
        <Button onClick={run} disabled={busy}><Radar className="mr-2 h-4 w-4" />{busy ? "Scanning…" : data ? "Refresh Australian opportunity scan" : "Run Australian opportunity scan"}</Button>
      </header>

      {busy && <div className="mb-5"><ResearchProgress detail="Searching current Australian organisations, project signals and tenders, then matching them against SPA capabilities." /></div>}
      {error && <div className="mb-5 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      {!data && !busy ? (
        <div className="grid min-h-72 place-items-center border border-dashed border-border p-8 text-center">
          <div>
            <Search className="mx-auto h-7 w-7 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">No fabricated dashboard statistics</h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">Run a live scan to populate this screen with public evidence, or research a company directly in Prospects.</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/prospect">Research a company</Link></Button>
          </div>
        </div>
      ) : data && (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="border border-border bg-card p-4"><div className="font-mono text-[10px] uppercase text-muted-foreground">Organisations found</div><div className="mt-1 text-3xl font-semibold">{data.organisations?.length ?? 0}</div></div>
            <div className="border border-border bg-card p-4"><div className="font-mono text-[10px] uppercase text-muted-foreground">Current signals</div><div className="mt-1 text-3xl font-semibold">{data.signals?.length ?? 0}</div></div>
            <div className="border border-border bg-card p-4"><div className="font-mono text-[10px] uppercase text-muted-foreground">Tender notices found</div><div className="mt-1 text-3xl font-semibold">{data.tenders?.length ?? 0}</div></div>
          </div>

          <section className="border border-border bg-card">
            <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">New opportunities / signals</div>
            <div className="divide-y divide-border">
              {(data.signals ?? []).map((s: any, i: number) => (
                <article key={i} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h3 className="font-semibold">{s.organisation}</h3><div className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">{s.location || "Location not stated"}{s.evidence_date ? ` · ${s.evidence_date}` : ""}</div></div>
                    <Source href={s.source_url} />
                  </div>
                  <p className="mt-3 text-sm">{s.signal}</p>
                  <div className="mt-3 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground"><strong className="text-foreground">Potential SPA fit:</strong> {s.spa_fit}</div>
                  <div className="mt-2 font-mono text-[10px] uppercase text-amber-300">{s.classification || "classification not supplied"}</div>
                </article>
              ))}
              {!data.signals?.length && <div className="p-6 text-sm text-muted-foreground">No supported current signals were returned for this scan.</div>}
            </div>
          </section>

          {!!data.tenders?.length && <section className="border border-border bg-card">
            <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Tenders / procurement</div>
            <div className="divide-y divide-border">{data.tenders.map((t: any, i: number) => <article key={i} className="p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{t.title}</h3><p className="mt-1 text-xs text-muted-foreground">{t.issuer} · Ref {t.reference || "not published"} · Closing {t.closing_date || "not found"}</p></div><Source href={t.source_url} /></div><p className="mt-3 text-sm text-muted-foreground"><strong className="text-foreground">SPA fit:</strong> {t.spa_fit}</p></article>)}</div>
          </section>}

          <div className="font-mono text-[10px] text-muted-foreground">Model used: {data.modelUsed} · Research: {new Date(data.researchedAt).toLocaleString()}{data.verification ? ` · Verified live organisations: ${data.verification.verifiedLiveOrganisations}/${data.verification.discoveredOrganisations}` : ""}</div>
        </div>
      )}
    </div>
  );
}
