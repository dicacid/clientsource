import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BarChart3, ExternalLink, PackageSearch, Plus, Radar, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import { analyseSpaCompetitor, discoverCompetitorsByProduct, discoverSpaCompetitors } from "@/lib/spa/research.functions";
import { addCompetitor, deleteCompetitor, getCompetitorRegistry } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/companies")({
  head: () => ({ meta: [{ title: "Competitor Intelligence — SPA Intelligence" }] }),
  component: CompetitorIntelligence,
});

type Competitor = {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  category: "direct" | "adjacent" | "large-scale";
  whyCompetitor: string;
  overlapAreas: string[];
  sourceUrls: string[];
  positioning?: string;
  moatPreview?: string[];
  watchSignals?: string[];
  discoveredAt: string;
  updatedAt: string;
  lastAnalysedAt: string | null;
  analysis: any | null;
};

type ProductMatch = {
  name: string;
  website: string | null;
  location: string | null;
  relationship: "seller" | "distributor" | "integrator" | "manufacturer" | "service_provider" | "other";
  category: Competitor["category"];
  matchedProducts: string[];
  whyRelevant: string;
  positioning: string;
  sourceUrls: string[];
};

const LABELS: Record<Competitor["category"], string> = {
  direct: "Direct",
  adjacent: "Adjacent",
  "large-scale": "Large-scale",
};

function SourceLink({ href, label = "Source" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {label}<ExternalLink className="h-3 w-3" />
    </a>
  );
}

function AnalysisPanel({ result }: { result: any }) {
  const a = result?.analysis;
  if (!a) return null;

  return (
    <section className="mt-6 border border-border bg-card">
      <div className="border-b border-border p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Deep competitor analysis</div>
        <h2 className="mt-1 text-2xl font-semibold">{a.company}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{a.positioning}</p>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-3">
        {[
          ["Customer segments", a.customer_segments],
          ["Geographic focus", a.geographic_focus],
          ["Overlap with SPA", a.overlap_with_spa],
        ].map(([title, rows]: any) => (
          <div key={title} className="bg-background p-4">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{title}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(rows ?? []).map((x: string) => <span key={x} className="border border-border px-2 py-1 text-xs">{x}</span>)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><h3 className="font-semibold">Moat hypotheses</h3></div>
          <div className="space-y-3">
            {(a.moat_hypotheses ?? []).map((m: any, i: number) => (
              <article key={i} className="border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <strong className="text-sm">{m.moat}</strong>
                  <div className="flex gap-1.5 font-mono text-[9px] uppercase text-muted-foreground">
                    <span className="border border-border px-1.5 py-0.5">{m.confidence}</span>
                    <span className="border border-border px-1.5 py-0.5">{m.classification}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{m.evidence}</p>
                {m.source_url && <div className="mt-2"><SourceLink href={m.source_url} /></div>}
              </article>
            ))}
            {!a.moat_hypotheses?.length && <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">No defensible moat was supported strongly enough to return.</div>}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="font-semibold">Differentiators and constraints</h3></div>
          <div className="space-y-3">
            {(a.differentiators ?? []).map((d: any, i: number) => (
              <article key={"d" + i} className="border border-border p-4">
                <strong className="text-sm">{d.item}</strong>
                {d.source_url && <div className="mt-2"><SourceLink href={d.source_url} /></div>}
              </article>
            ))}
            {(a.vulnerabilities_or_constraints ?? []).map((v: any, i: number) => (
              <article key={"v" + i} className="border border-amber-500/25 bg-amber-500/5 p-4">
                <strong className="text-sm">Constraint: {v.item}</strong>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{v.evidence}</p>
                {v.source_url && <div className="mt-2"><SourceLink href={v.source_url} /></div>}
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-5 border-t border-border p-5 lg:grid-cols-2">
        <section>
          <h3 className="font-semibold">Current projects and signals</h3>
          <div className="mt-3 space-y-3">
            {(a.current_projects_or_signals ?? []).map((x: any, i: number) => (
              <article key={i} className="border-l-2 border-primary/40 pl-3">
                <p className="text-sm">{x.item}</p>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {x.evidence_date && <span>{x.evidence_date}</span>}
                  {x.source_url && <SourceLink href={x.source_url} />}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section>
          <h3 className="font-semibold">Implications for SPA</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
            {(a.strategic_implications_for_spa ?? []).map((x: string, i: number) => <li key={i} className="border-l-2 border-primary/40 pl-3">{x}</li>)}
          </ul>
        </section>
      </div>
    </section>
  );
}

function CompetitorIntelligence() {
  const getRegistry = useServerFn(getCompetitorRegistry);
  const discover = useServerFn(discoverSpaCompetitors);
  const discoverByProduct = useServerFn(discoverCompetitorsByProduct);
  const analyse = useServerFn(analyseSpaCompetitor);
  const add = useServerFn(addCompetitor);
  const remove = useServerFn(deleteCompetitor);

  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [analysingAll, setAnalysingAll] = useState(false);
  const [progressDetail, setProgressDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manualWebsite, setManualWebsite] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCategory, setManualCategory] = useState<Competitor["category"]>("direct");
  const [addingManual, setAddingManual] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productRegion, setProductRegion] = useState("Australia");
  const [productMatches, setProductMatches] = useState<ProductMatch[]>([]);
  const [productNotes, setProductNotes] = useState<string[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [addingProduct, setAddingProduct] = useState<string | null>(null);

  async function runDiscovery(initial = false) {
    setDiscovering(true);
    setError(null);
    setProgressDetail(initial ? "Finding and logging SPA competitors from current Australian public sources." : "Refreshing the competitor landscape.");
    try {
      const result = await discover({ data: { businessContext: "spa", region: "Australia" } });
      setCompetitors(result.competitors as Competitor[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
      setProgressDetail("");
    }
  }

  async function addManualCompetitor(e: FormEvent) {
    e.preventDefault();
    if (!manualWebsite.trim() && !manualName.trim()) return;
    setAddingManual(true);
    setError(null);
    try {
      const rows = await add({
        data: {
          name: manualName,
          website: manualWebsite,
          category: manualCategory,
          whyCompetitor: "Added manually to the SPA competitor watchlist for investigation.",
        },
      });
      setCompetitors(rows as Competitor[]);
      setManualWebsite("");
      setManualName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingManual(false);
    }
  }

  async function runProductSearch(e: FormEvent) {
    e.preventDefault();
    if (productQuery.trim().length < 2) return;
    setProductSearching(true);
    setError(null);
    setProductMatches([]);
    setProductNotes([]);
    setProgressDetail(`Tracing who sells, distributes, integrates or offers “${productQuery.trim()}” in ${productRegion.trim() || "Australia"}.`);
    try {
      const result = await discoverByProduct({
        data: {
          product: productQuery.trim(),
          region: productRegion.trim() || "Australia",
          businessContext: "spa",
        },
      });
      setProductMatches(result.matches as ProductMatch[]);
      setProductNotes(result.searchNotes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProductSearching(false);
      setProgressDetail("");
    }
  }

  async function addProductMatch(match: ProductMatch) {
    setAddingProduct(match.name);
    setError(null);
    try {
      const rows = await add({
        data: {
          name: match.name,
          website: match.website ?? "",
          category: match.category,
          whyCompetitor: match.whyRelevant,
          overlapAreas: match.matchedProducts,
          sourceUrls: match.sourceUrls,
          positioning: match.positioning,
          watchSignals: [`Monitor product/channel activity around ${productQuery.trim() || "the searched offer"}.`],
        },
      });
      setCompetitors(rows as Competitor[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingProduct(null);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const rows = (await getRegistry()) as Competitor[];
        setCompetitors(rows);
        if (!rows.length) await runDiscovery(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function analyseOne(row: Competitor) {
    setAnalysingId(row.id);
    setError(null);
    setProgressDetail(`Analysing ${row.name}: positioning, projects, differentiators, moats, constraints and implications for SPA.`);
    try {
      const result = await analyse({ data: { competitorId: row.id } });
      setSelected(result);
      setCompetitors((rows) => rows.map((x) => x.id === row.id ? { ...x, analysis: result, lastAnalysedAt: result.researchedAt } : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysingId(null);
      setProgressDetail("");
    }
  }

  async function analyseAll() {
    if (!competitors.length) return;
    setAnalysingAll(true);
    setError(null);
    try {
      for (let i = 0; i < competitors.length; i++) {
        const row = competitors[i]!;
        setAnalysingId(row.id);
        setProgressDetail(`Competitor ${i + 1} of ${competitors.length}: ${row.name}.`);
        const result = await analyse({ data: { competitorId: row.id } });
        setSelected(result);
        setCompetitors((rows) => rows.map((x) => x.id === row.id ? { ...x, analysis: result, lastAnalysedAt: result.researchedAt } : x));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysingId(null);
      setAnalysingAll(false);
      setProgressDetail("");
    }
  }

  async function removeOne(row: Competitor) {
    if (!window.confirm(`Remove ${row.name} from the competitor watchlist?`)) return;
    try {
      setCompetitors((await remove({ data: { id: row.id } })) as Competitor[]);
      if (selected?.competitor?.id === row.id) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const counts = useMemo(() => ({
    direct: competitors.filter((x) => x.category === "direct").length,
    adjacent: competitors.filter((x) => x.category === "adjacent").length,
    large: competitors.filter((x) => x.category === "large-scale").length,
    analysed: competitors.filter((x) => !!x.lastAnalysedAt).length,
  }), [competitors]);

  if (loading && !competitors.length && !discovering) {
    return <div className="mx-auto max-w-7xl"><ResearchProgress detail="Loading competitor intelligence." /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Commercial intelligence / competitor landscape</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Competitor Intelligence</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            SPA Intelligence can discover competitors automatically, but it is not locked to automation. Add a known company or website yourself, or trace a specific product, model, technology or offer to find other companies selling, distributing or integrating it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => runDiscovery(false)} disabled={discovering || analysingAll || !!analysingId}>
            <RefreshCw className="mr-2 h-4 w-4" />{discovering ? "Discovering…" : "Refresh landscape"}
          </Button>
          <Button onClick={analyseAll} disabled={!competitors.length || discovering || analysingAll || !!analysingId}>
            <Radar className="mr-2 h-4 w-4" />{analysingAll ? "Analysing…" : "Analyse all"}
          </Button>
        </div>
      </header>

      <section className="mb-5 grid gap-4 xl:grid-cols-2">
        <form onSubmit={addManualCompetitor} className="border border-border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Manual watchlist entry</div>
          <h2 className="mt-1 text-lg font-semibold">Add a competitor yourself</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Paste a competitor website or just enter a company name. It is added to the watchlist immediately, then you can run the same deep analysis as an automatically discovered competitor.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="manual-website" className="text-xs font-medium">Website or domain</label>
              <Input
                id="manual-website"
                value={manualWebsite}
                onChange={(e) => setManualWebsite(e.target.value)}
                placeholder="https://competitor.com.au"
                className="mt-1 h-11"
              />
            </div>
            <div>
              <label htmlFor="manual-name" className="text-xs font-medium">Company name <span className="text-muted-foreground">(optional)</span></label>
              <Input
                id="manual-name"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Competitor name"
                className="mt-1 h-11"
              />
            </div>
            <div>
              <label htmlFor="manual-category" className="text-xs font-medium">Relationship</label>
              <Select value={manualCategory} onValueChange={(v) => setManualCategory(v as Competitor["category"])}>
                <SelectTrigger id="manual-category" className="mt-1 h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Direct competitor</SelectItem>
                  <SelectItem value="adjacent">Adjacent / channel overlap</SelectItem>
                  <SelectItem value="large-scale">Large-scale provider</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" className="mt-3 w-full md:w-auto" disabled={addingManual || (!manualWebsite.trim() && !manualName.trim())}>
            <Plus className="mr-2 h-4 w-4" />{addingManual ? "Adding…" : "Add to watchlist"}
          </Button>
        </form>

        <form onSubmit={runProductSearch} className="border border-border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Product-led competitor search</div>
          <h2 className="mt-1 text-lg font-semibold">Who else sells this?</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Enter a specific product, model, technology or service. SPA Intelligence traces sellers, distributors, integrators and competing offers instead of requiring you to know their websites first.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <div>
              <label htmlFor="product-query" className="text-xs font-medium">Product / model / technology / service</label>
              <Input
                id="product-query"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="e.g. a battery model, BESS platform, inverter or remote-power skid"
                className="mt-1 h-11"
              />
            </div>
            <div>
              <label htmlFor="product-region" className="text-xs font-medium">Market / region</label>
              <Input
                id="product-region"
                value={productRegion}
                onChange={(e) => setProductRegion(e.target.value)}
                placeholder="Australia"
                className="mt-1 h-11"
              />
            </div>
          </div>
          <Button type="submit" className="mt-3 w-full md:w-auto" disabled={productSearching || productQuery.trim().length < 2}>
            <PackageSearch className="mr-2 h-4 w-4" />{productSearching ? "Searching…" : "Find competing sellers & offers"}
          </Button>
        </form>
      </section>

      {!!productMatches.length && (
        <section className="mb-5 border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Product search results</div>
            <h2 className="mt-1 font-semibold">Companies connected to “{productQuery}”</h2>
            {!!productNotes.length && <p className="mt-1 text-xs text-muted-foreground">{productNotes.join(" · ")}</p>}
          </div>
          <div className="divide-y divide-border">
            {productMatches.map((match) => (
              <article key={`${match.name}-${match.website ?? match.sourceUrls[0] ?? "match"}`} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_140px_160px] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{match.name}</h3>
                    <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{match.relationship.replace("_", " ")}</span>
                    <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{LABELS[match.category]}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{match.location || "Location not confirmed"}</div>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{match.whyRelevant}</p>
                  {!!match.matchedProducts.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {match.matchedProducts.map((x) => <span key={x} className="border border-primary/25 bg-primary/5 px-2 py-1 text-[10px]">{x}</span>)}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {match.website && <SourceLink href={match.website} label="Website" />}
                    {match.sourceUrls.slice(0, 3).map((url, i) => <SourceLink key={url} href={url} label={`Product evidence ${i + 1}`} />)}
                  </div>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">{match.positioning || "Positioning not yet analysed."}</div>
                <Button size="sm" onClick={() => addProductMatch(match)} disabled={!!addingProduct || discovering || analysingAll || !!analysingId}>
                  <Plus className="mr-2 h-3.5 w-3.5" />{addingProduct === match.name ? "Adding…" : "Add to watchlist"}
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Direct", counts.direct],
          ["Adjacent", counts.adjacent],
          ["Large-scale", counts.large],
          ["Deep analyses", counts.analysed],
        ].map(([label, value]) => (
          <div key={label} className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {(discovering || analysingAll || !!analysingId || productSearching) && <div className="mb-5"><ResearchProgress detail={progressDetail || "Competitor intelligence research is running."} /></div>}
      {error && <div className="mb-5 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <section className="border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1.4fr)_130px_160px_110px] gap-3 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground max-lg:hidden">
          <div>Competitor</div><div>Category</div><div>Overlap</div><div>Action</div>
        </div>
        <div className="divide-y divide-border">
          {competitors.map((row) => (
            <article key={row.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.4fr)_130px_160px_110px] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{row.name}</h3>
                  {row.lastAnalysedAt && <span className="border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-400">analysed</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{row.location || "Location being verified"}</div>
                <p className="mt-2 max-w-3xl text-sm leading-5 text-muted-foreground">{row.positioning || row.whyCompetitor}</p>
                {!!row.moatPreview?.length && (
                  <div className="mt-3 border-l-2 border-primary/40 pl-3">
                    <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">Moat preview</div>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {row.moatPreview.slice(0, 3).map((x) => <li key={x}>• {x}</li>)}
                    </ul>
                  </div>
                )}
                {!!row.watchSignals?.length && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {row.watchSignals.slice(0, 3).map((x) => <span key={x} className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Watch: {x}</span>)}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-3">
                  {row.website && <SourceLink href={row.website} label="Website" />}
                  {(row.sourceUrls ?? []).slice(0, 2).map((url, i) => <SourceLink key={url} href={url} label={`Evidence ${i + 1}`} />)}
                </div>
              </div>
              <div><span className="border border-border px-2 py-1 font-mono text-[10px] uppercase">{LABELS[row.category]}</span></div>
              <div className="flex flex-wrap gap-1">{(row.overlapAreas ?? []).slice(0, 4).map((x) => <span key={x} className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{x}</span>)}</div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => analyseOne(row)} disabled={!!analysingId || discovering}>{analysingId === row.id ? "Working…" : row.lastAnalysedAt ? "Refresh" : "Analyse"}</Button>
                <Button size="icon" variant="ghost" onClick={() => removeOne(row)} aria-label={`Remove ${row.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </article>
          ))}
          {!competitors.length && !discovering && <div className="p-8 text-center text-sm text-muted-foreground">No competitor landscape is logged yet. Use Refresh landscape.</div>}
        </div>
      </section>

      <AnalysisPanel result={selected} />
    </div>
  );
}
