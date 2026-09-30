import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IntelligenceResult } from "@/components/spa/IntelligenceResult";
import { researchSpaCompany } from "@/lib/spa/research.functions";

export const Route = createFileRoute("/_authenticated/_app/companies")({
  head: () => ({ meta: [{ title: "Competitors — SPA Intelligence" }] }),
  component: Competitors,
});

function Competitors() {
  const research = useServerFn(researchSpaCompany);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    const targets = input.split(/\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
    if (!targets.length) return;
    setBusy(true); setError(null); setResults([]);
    const next: any[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        setProgress(`Researching competitor ${i + 1} of ${targets.length}: ${targets[i]}`);
        const r = await research({ data: { query: targets[i]!, mode: "competitor", businessContext: "spa", capabilityOverrides: "" } });
        next.push(r); setResults([...next]);
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); setProgress(""); }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Commercial intelligence / competitors</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Competitor Intelligence</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Analyse public positioning, projects, current signals and capabilities. The output focuses on evidence-based implications for SPA, not simplistic winner/loser claims.</p>
      </header>

      <form onSubmit={run} className="border border-border bg-card p-4">
        <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Competitor domains or names · one per line · up to five</label>
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={"competitor-one.com.au\ncompetitor-two.com.au"} className="mt-2 min-h-28 font-mono text-sm" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Only public information is used. Private competitor data is never inferred.</span>
          <Button type="submit" disabled={busy || !input.trim()}><Building2 className="mr-2 h-4 w-4" />{busy ? "Researching…" : "Analyse competitors"}</Button>
        </div>
      </form>

      {progress && <div className="mt-4 border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">{progress}</div>}
      {error && <div className="mt-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {results.map((r, i) => <IntelligenceResult key={i} result={r} title="Competitor dossier" />)}
      {!busy && !results.length && !error && <div className="mt-8 grid min-h-48 place-items-center border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Enter a competitor Brett knows and build a live public-intelligence dossier.</div>}
    </div>
  );
}
