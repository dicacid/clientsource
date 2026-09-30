import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IntelligenceResult } from "@/components/spa/IntelligenceResult";
import { SPA_CAPABILITIES } from "@/lib/spa/capabilities";
import { researchSpaCompany } from "@/lib/spa/research.functions";
import { addApprovalItem } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/prospect")({
  head: () => ({
    meta: [
      { title: "Prospects — SPA Intelligence" },
      { name: "description", content: "Evidence-backed organisation research grounded in Solar Power Australia capabilities." },
    ],
  }),
  component: ProspectPage,
});

function capabilitySeed() {
  return SPA_CAPABILITIES.map((c) => `${c.capability} [${c.confidence}]: ${c.evidence}`).join("\n");
}

function ProspectPage() {
  const research = useServerFn(researchSpaCompany);
  const createApproval = useServerFn(addApprovalItem);
  const [query, setQuery] = useState("");
  const [businessContext, setBusinessContext] = useState<"spa" | "solaronline" | "elmofo">("spa");
  const [capabilities, setCapabilities] = useState(capabilitySeed);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);

  useEffect(() => {
    const prefill = localStorage.getItem("spa-intelligence.prospect.prefill");
    if (prefill) {
      setQuery(prefill);
      localStorage.removeItem("spa-intelligence.prospect.prefill");
    }
  }, []);

  const capabilityCounts = useMemo(() => ({
    confirmed: SPA_CAPABILITIES.filter((c) => c.confidence === "CONFIRMED").length,
    adjacent: SPA_CAPABILITIES.filter((c) => c.confidence === "LIKELY / ADJACENT").length,
    verify: SPA_CAPABILITIES.filter((c) => c.confidence === "NEEDS VERIFICATION").length,
  }), []);

  async function sendToApproval() {
    if (!result?.dossier?.organisation) return;
    try {
      await createApproval({ data: { title: result.dossier.organisation, kind: "prospect", payload: result } });
      setApprovalMessage("Added to Approval Queue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function run(e?: FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await research({
        data: {
          query: query.trim(),
          mode: businessContext === "elmofo" ? "venture" : "prospect",
          businessContext,
          capabilityOverrides: capabilities,
        },
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Commercial intelligence / prospect</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Research an organisation</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Enter a company name, domain or public website. SPA Intelligence separates sourced facts from inference, then matches the evidence against an editable SPA capability profile.
        </p>
      </header>

      <form onSubmit={run} className="border border-border bg-card">
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_210px_auto]">
          <div>
            <label htmlFor="prospect-query" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Company / domain / website</label>
            <Input
              id="prospect-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="BHP or https://example.com.au"
              autoFocus
              className="h-11"
            />
          </div>
          <div>
            <label htmlFor="business-context" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Business context</label>
            <select
              id="business-context"
              value={businessContext}
              onChange={(e) => setBusinessContext(e.target.value as typeof businessContext)}
              className="h-11 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="spa">Solar Power Australia</option>
              <option value="solaronline">Solar Online</option>
              <option value="elmofo">ELMOFO / innovation</option>
            </select>
          </div>
          <Button type="submit" disabled={busy || query.trim().length < 2} className="self-end h-11 px-6">
            <Search className="mr-2 h-4 w-4" />{busy ? "Researching…" : "Build dossier"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-400" />{capabilityCounts.confirmed} confirmed capabilities</span>
            <span>{capabilityCounts.adjacent} adjacent</span>
            <span>{capabilityCounts.verify} need verification</span>
          </div>
          <button type="button" onClick={() => setShowCapabilities((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <SlidersHorizontal className="h-3.5 w-3.5" />{showCapabilities ? "Hide capability profile" : "Edit capability profile"}
          </button>
        </div>

        {showCapabilities && (
          <div className="border-t border-border p-4">
            <div className="mb-2 text-xs text-muted-foreground">
              These statements are passed to the research engine with their provenance. Edit them for the session; unverified capability is never promoted to confirmed.
            </div>
            <Textarea value={capabilities} onChange={(e) => setCapabilities(e.target.value)} className="min-h-64 font-mono text-xs leading-5" />
          </div>
        )}
      </form>

      {busy && (
        <div className="mt-4 border border-primary/30 bg-primary/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Live research running</div>
          <p className="mt-1 text-sm text-muted-foreground">
            The server is executing direct-site retrieval, current public-web research, evidence classification, SPA capability matching and dossier assembly. One failed source will not abort the run.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 border border-destructive/40 bg-destructive/5 p-4">
          <strong className="text-sm text-destructive">Research failed</strong>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => run()}>Retry</Button>
        </div>
      )}

      {result ? (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-3 print:hidden">
            <div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Manual approval point</div><p className="mt-1 text-sm">Research is prepared. Brett decides whether this proceeds.</p></div>
            <Button onClick={sendToApproval} disabled={!!approvalMessage}>{approvalMessage || "Create approval item"}</Button>
          </div>
          <IntelligenceResult result={result} />
        </>
      ) : !busy && !error && (
        <div className="mt-8 grid min-h-48 place-items-center border border-dashed border-border p-8 text-center">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">No dossier loaded</div>
            <p className="mt-2 text-sm text-muted-foreground">Ask Brett for a company. Enter it above and run the research live.</p>
          </div>
        </div>
      )}
    </div>
  );
}
