import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ExternalLink, Factory, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import { researchSpaIndustryStaged } from "@/lib/spa/research.functions";

export const Route = createFileRoute("/_authenticated/_app/contacts")({
  head: () => ({ meta: [{ title: "Industries — SPA Intelligence" }] }),
  component: IndustryIntelligence,
});

function IndustryIntelligence() {
  const research = useServerFn(researchSpaIndustryStaged);
  const navigate = useNavigate();
  const [industry, setIndustry] = useState("Mining");
  const [region, setRegion] = useState("Australia");
  const [focus, setFocus] = useState("Remote Power / BESS");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setData(await research({ data: { industry, region, focus, businessContext: "spa" } })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  function convert(org: any) {
    localStorage.setItem("spa-intelligence.prospect.prefill", JSON.stringify(org));
    navigate({ to: "/prospect" });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Commercial intelligence / market lens</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Industry Intelligence</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Investigate a market instead of a single organisation, then convert any supported organisation into the full prospect workflow.</p>
      </header>

      <form onSubmit={run} className="grid gap-4 border border-border bg-card p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="text-xs text-muted-foreground">Industry<Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="mt-1.5 text-foreground" /></label>
        <label className="text-xs text-muted-foreground">Region<Input value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1.5 text-foreground" /></label>
        <label className="text-xs text-muted-foreground">Opportunity / technology focus<Input value={focus} onChange={(e) => setFocus(e.target.value)} className="mt-1.5 text-foreground" /></label>
        <Button type="submit" disabled={busy || !industry.trim() || !region.trim() || !focus.trim()} className="self-end"><Factory className="mr-2 h-4 w-4" />{busy ? "Researching…" : "Research market"}</Button>
      </form>

      {busy && <div className="mt-4"><ResearchProgress detail="Searching current public companies, projects, announcements and tender signals for this market filter." /></div>}
      {error && <div className="mt-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {data && <div className="mt-6 space-y-5">
        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Relevant organisations</div>
          <div className="divide-y divide-border">
            {(data.organisations ?? []).map((o: any, i: number) => <article key={i} className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="max-w-3xl"><h3 className="font-semibold">{o.name}</h3><p className="mt-1 text-xs text-muted-foreground">{o.location || "Location not stated"}</p><p className="mt-2 text-sm">{o.why_relevant}</p><a href={o.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">Evidence <ExternalLink className="h-3 w-3" /></a></div>
              <Button size="sm" variant="outline" onClick={() => convert(o)}><Target className="mr-1 h-3.5 w-3.5" />Convert to prospect</Button>
            </article>)}
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Projects / signals</div>
          <div className="divide-y divide-border">{(data.signals ?? []).map((s: any, i: number) => <article key={i} className="p-4"><div className="flex flex-wrap justify-between gap-3"><div><strong>{s.organisation}</strong><div className="font-mono text-[10px] uppercase text-muted-foreground">{s.location || "Location not stated"}{s.evidence_date ? ` · ${s.evidence_date}` : ""}</div></div><a href={s.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary">Evidence ↗</a></div><p className="mt-2 text-sm">{s.signal}</p><p className="mt-2 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground"><strong className="text-foreground">Potential SPA fit:</strong> {s.spa_fit}</p><div className="mt-2 font-mono text-[10px] uppercase text-amber-300">{s.classification}</div></article>)}</div>
        </section>

        {!!data.tenders?.length && <section className="border border-border bg-card"><div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Tender intelligence</div><div className="divide-y divide-border">{data.tenders.map((t: any, i: number) => <article key={i} className="p-4"><strong>{t.title}</strong><p className="mt-1 text-xs text-muted-foreground">{t.issuer} · Ref {t.reference || "not published"} · Closing {t.closing_date || "not found"} · {t.location || "Location not stated"}</p><p className="mt-2 text-sm text-muted-foreground">{t.spa_fit}</p><a href={t.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary">Original source ↗</a></article>)}</div></section>}

        <div className="font-mono text-[10px] text-muted-foreground">Model used: {data.modelUsed} · Research: {new Date(data.researchedAt).toLocaleString()}</div>
      </div>}

      {!data && !busy && !error && <div className="mt-8 grid min-h-48 place-items-center border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Defaults are loaded for the required demo test: Mining · Australia · Remote Power / BESS.</div>}
    </div>
  );
}
