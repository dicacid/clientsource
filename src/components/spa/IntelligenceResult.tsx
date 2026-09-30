import { Copy, ExternalLink, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

const CLASS_STYLES: Record<string, string> = {
  OBSERVED_FACT: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  SOURCE_CLAIM: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  INFERENCE: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  COMMERCIAL_HYPOTHESIS: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  UNKNOWN: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  CONFIRMED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  "LIKELY / ADJACENT": "border-amber-500/30 bg-amber-500/10 text-amber-300",
  "NEEDS VERIFICATION": "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

export function IntelBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <span className={`inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${CLASS_STYLES[value] ?? "border-border bg-muted text-muted-foreground"}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function SourceLink({ href, label = "Source" }: { href?: string | null; label?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {label}<ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <div className="border-b border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function IntelligenceResult({ result, title = "Commercial dossier" }: { result: any; title?: string }) {
  if (!result?.dossier) return null;
  const d = result.dossier;
  const brief = [
    d.organisation,
    d.what_the_company_does,
    d.possible_first_approach,
    d.next_action,
    "",
    "Sources:",
    ...(d.evidence ?? []).map((e: any) => `- ${e.source_url}`),
  ].filter(Boolean).join("\n");

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{title}</div>
          <h2 className="mt-1 text-2xl font-semibold">{d.organisation || "Research result"}</h2>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {d.industry && <span>{d.industry}</span>}
            {d.official_website && <SourceLink href={d.official_website} label="Official website" />}
            <span>Model: <code>{result.modelUsed}</code></span>
            <span>{new Date(result.researchedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(brief)}><Copy className="mr-1 h-3.5 w-3.5" />Copy brief</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-3.5 w-3.5" />Print / PDF</Button>
        </div>
      </div>

      {result.directRetrieval && (
        <div className={`border px-3 py-2 text-sm ${result.directRetrieval.status === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <strong>Direct website retrieval: {String(result.directRetrieval.status).replaceAll("_", " ")}</strong>
          <span className="ml-2 text-muted-foreground">{result.directRetrieval.message}</span>
          {result.directRetrieval.diagnostic?.httpStatus && <span className="ml-2 font-mono text-xs">HTTP {result.directRetrieval.diagnostic.httpStatus}</span>}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Company overview">
          <p className="text-sm leading-6">{d.what_the_company_does || "No supported description found."}</p>
          {!!d.locations?.length && <p className="mt-3 text-xs text-muted-foreground">Locations: {d.locations.join(", ")}</p>}
        </Panel>

        <Panel title="Why now / next action">
          <p className="text-sm leading-6">{d.next_action || "No supported next action yet."}</p>
          {d.follow_up_strategy && <p className="mt-3 text-sm text-muted-foreground">{d.follow_up_strategy}</p>}
        </Panel>
      </div>

      {!!d.current_projects?.length && (
        <Panel title="Current projects">
          <div className="space-y-3">
            {d.current_projects.map((x: any, i: number) => (
              <div key={i} className="border-l-2 border-primary/40 pl-3">
                <div className="flex flex-wrap items-center gap-2"><IntelBadge value={x.classification} />{x.evidence_date && <span className="font-mono text-[10px] text-muted-foreground">{x.evidence_date}</span>}</div>
                <p className="mt-1 text-sm">{x.item}</p><SourceLink href={x.source_url} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.recent_developments?.length && (
        <Panel title="Recent developments">
          <div className="space-y-3">
            {d.recent_developments.map((x: any, i: number) => (
              <div key={i} className="border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2"><IntelBadge value={x.classification} />{x.evidence_date && <span className="font-mono text-[10px] text-muted-foreground">{x.evidence_date}</span>}</div>
                <p className="mt-1 text-sm">{x.item}</p><SourceLink href={x.source_url} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.capability_matches?.length && (
        <Panel title="SPA capability match">
          <div className="grid gap-3 md:grid-cols-2">
            {d.capability_matches.map((x: any, i: number) => (
              <div key={i} className="border border-border p-3">
                <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{x.capability}</strong><IntelBadge value={x.provenance} /></div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{x.rationale}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.opportunity_hypotheses?.length && (
        <Panel title="Opportunity hypotheses">
          <div className="space-y-4">
            {d.opportunity_hypotheses.map((x: any, i: number) => (
              <div key={i} className="border-l-2 border-orange-500/50 pl-3">
                <IntelBadge value={x.classification} />
                <p className="mt-1 text-sm font-medium">{x.hypothesis}</p>
                <p className="mt-1 text-xs text-muted-foreground"><strong>Why now:</strong> {x.why_now}</p>
                <p className="mt-1 text-xs text-muted-foreground"><strong>Validate:</strong> {x.validation_needed}</p>
                <SourceLink href={x.source_url} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.people?.length && (
        <Panel title="People / decision makers">
          <div className="divide-y divide-border">
            {d.people.map((x: any, i: number) => (
              <div key={i} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div><strong className="text-sm">{x.name}</strong><div className="text-xs text-muted-foreground">{x.title}</div>{x.contact && <div className="mt-1 font-mono text-xs">{x.contact}</div>}</div>
                <div className="flex items-center gap-2"><IntelBadge value={x.classification} /><SourceLink href={x.source_url} /></div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.tenders?.length && (
        <Panel title="Relevant tenders">
          <div className="space-y-3">
            {d.tenders.map((x: any, i: number) => (
              <div key={i} className="border border-border p-3">
                <strong className="text-sm">{x.title}</strong>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">Ref: {x.reference || "not published"} · Closing: {x.closing_date || "not found"}</div>
                <div className="mt-2"><SourceLink href={x.source_url} /></div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!d.competitor_implications?.length && (
        <Panel title="What this means for SPA">
          <ul className="space-y-2 text-sm">{d.competitor_implications.map((x: string, i: number) => <li key={i} className="border-l-2 border-primary/50 pl-3">{x}</li>)}</ul>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Questions SPA should ask">
          {!!d.questions_spa_should_ask?.length ? <ul className="space-y-2 text-sm">{d.questions_spa_should_ask.map((x: string, i: number) => <li key={i}>• {x}</li>)}</ul> : <p className="text-sm text-muted-foreground">No questions generated.</p>}
        </Panel>
        <Panel title="Risks / unknowns">
          {!!d.risks_unknowns?.length ? <ul className="space-y-2 text-sm">{d.risks_unknowns.map((x: string, i: number) => <li key={i}>• {x}</li>)}</ul> : <p className="text-sm text-muted-foreground">No explicit unknowns returned.</p>}
        </Panel>
      </div>

      <Panel title="Possible first approach">
        <p className="whitespace-pre-wrap text-sm leading-6">{d.possible_first_approach || "No approach prepared."}</p>
      </Panel>

      {!!d.evidence?.length && (
        <Panel title="Evidence ledger">
          <div className="space-y-3">
            {d.evidence.map((x: any, i: number) => (
              <div key={i} className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0 md:grid-cols-[150px_1fr_auto]">
                <IntelBadge value={x.classification} />
                <p className="text-sm">{x.statement}</p>
                <div className="text-right"><SourceLink href={x.source_url} />{x.evidence_date && <div className="font-mono text-[10px] text-muted-foreground">{x.evidence_date}</div>}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {result.usage && (
        <div className="font-mono text-[10px] text-muted-foreground">
          API usage returned by provider: {JSON.stringify(result.usage)}
        </div>
      )}
    </div>
  );
}
