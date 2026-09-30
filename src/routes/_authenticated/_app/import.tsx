import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Lightbulb, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntelligenceResult } from "@/components/spa/IntelligenceResult";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import { researchSpaVentureStaged } from "@/lib/spa/research.functions";

export const Route = createFileRoute("/_authenticated/_app/import")({
  head: () => ({ meta: [{ title: "Ventures & Innovation — SPA Intelligence" }] }),
  component: Ventures,
});

function Ventures() {
  const research = useServerFn(researchSpaVentureStaged);
  const [query, setQuery] = useState("https://elmofo.com.au/");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try { setResult(await research({ data: { query, businessContext: "elmofo" } })); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">SPA Intelligence / ventures</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Ventures & Innovation</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">A separate research lens for Brett's innovation activities. ELMOFO is the first venture profile; this mode targets EV engineering, conversion, motorsport, specialist batteries, partnerships and commercialisation rather than generic solar lead generation.</p>
      </header>

      <section className="grid gap-4 border border-border bg-card p-5 lg:grid-cols-[220px_1fr]">
        <div className="border border-primary/30 bg-primary/5 p-4">
          <Zap className="h-6 w-6 text-primary" />
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Venture 01</div>
          <h2 className="mt-1 text-xl font-semibold">ELMOFO</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Electric vehicle technology, conversion, prototype engineering and specialist battery opportunity lens.</p>
        </div>
        <form onSubmit={run} className="flex flex-col justify-center">
          <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Company / partner / technology / venture target</label>
          <div className="mt-2 flex flex-col gap-2 md:flex-row">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ELMOFO, manufacturer, technology company or domain" className="h-11 flex-1" />
            <Button type="submit" disabled={busy || query.trim().length < 2} className="h-11"><Lightbulb className="mr-2 h-4 w-4" />{busy ? "Researching…" : "Research innovation opportunity"}</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The commercial context is explicitly ELMOFO/innovation. Solar-only assumptions are excluded unless current evidence makes them relevant.</p>
        </form>
      </section>

      {busy && <div className="mt-4"><ResearchProgress detail="Researching current EV and innovation evidence, people, projects, partnerships and commercialisation signals." /></div>}
      {error && <div className="mt-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {result && <IntelligenceResult result={result} title="Ventures & innovation dossier" />}
    </div>
  );
}
