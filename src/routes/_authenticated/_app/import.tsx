import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { Building2, Lightbulb, ShoppingCart, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntelligenceResult } from "@/components/spa/IntelligenceResult";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import { researchSpaVentureStaged } from "@/lib/spa/research.functions";

export const Route = createFileRoute("/_authenticated/_app/import")({
  head: () => ({ meta: [{ title: "Ventures & Innovation — SPA Intelligence" }] }),
  component: Ventures,
});

type BusinessContext = "spa" | "solaronline" | "elmofo";

const BUSINESSES: Record<BusinessContext, {
  name: string;
  url: string;
  eyebrow: string;
  description: string;
  icon: typeof Building2;
}> = {
  spa: {
    name: "Solar Power Australia",
    url: "https://solarpoweraustralia.com.au/",
    eyebrow: "Core business",
    description: "Commercial, industrial, remote-power, BESS, hybrid-energy and specialist energy-system innovation.",
    icon: Building2,
  },
  solaronline: {
    name: "Solar Online",
    url: "https://solaronline.com.au/",
    eyebrow: "Online & channel",
    description: "Product, e-commerce, distribution, integration, supply-chain and new renewable-energy offer innovation.",
    icon: ShoppingCart,
  },
  elmofo: {
    name: "ELMOFO",
    url: "https://elmofo.com.au/",
    eyebrow: "EV & engineering",
    description: "EV conversion, motorsport electrification, specialist batteries, prototype engineering and technology commercialisation.",
    icon: Zap,
  },
};

function Ventures() {
  const research = useServerFn(researchSpaVentureStaged);
  const [businessContext, setBusinessContext] = useState<BusinessContext>("spa");
  const [query, setQuery] = useState(BUSINESSES.spa.url);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = BUSINESSES[businessContext];

  function selectBusiness(next: BusinessContext) {
    const current = query.trim();
    const isBusinessDefault = Object.values(BUSINESSES).some((business) => business.url === current);
    setBusinessContext(next);
    if (!current || isBusinessDefault) setQuery(BUSINESSES[next].url);
    setResult(null);
    setError(null);
  }

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await research({ data: { query, businessContext } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 border-b border-border pb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">SPA Intelligence / ventures</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Ventures & Innovation</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Research new products, technologies, partnerships, adjacent markets and commercialisation opportunities through the lens of any of Brett's three businesses. Select the business first, then research its own pipeline or any external company, technology or venture target.
        </p>
      </header>

      <section className="border border-border bg-card p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Select business context</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(Object.entries(BUSINESSES) as [BusinessContext, (typeof BUSINESSES)[BusinessContext]][]).map(([id, business]) => {
            const Icon = business.icon;
            const active = businessContext === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectBusiness(id)}
                className={`text-left border p-4 transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50 hover:bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {business.eyebrow}
                  </span>
                </div>
                <h2 className="mt-3 text-base font-semibold">{business.name}</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{business.description}</p>
              </button>
            );
          })}
        </div>

        <form onSubmit={run} className="mt-5 border-t border-border pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-primary">Innovation lens: {selected.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{selected.description}</div>
            </div>
          </div>

          <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Company / partner / technology / product / venture target
          </label>
          <div className="mt-2 flex flex-col gap-2 md:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Research a company, technology, product, partner or domain for ${selected.name}`}
              className="h-11 flex-1"
            />
            <Button type="submit" disabled={busy || query.trim().length < 2} className="h-11">
              <Lightbulb className="mr-2 h-4 w-4" />
              {busy ? "Researching…" : "Research innovation opportunity"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The selected business changes the research lens and commercial interpretation. The system should not force ELMOFO, solar or e-commerce assumptions into another business unless current evidence makes the overlap relevant.
          </p>
        </form>
      </section>

      {busy && (
        <div className="mt-4">
          <ResearchProgress detail={`Researching current innovation evidence, projects, products, partnerships and commercialisation signals for ${selected.name}.`} />
        </div>
      )}
      {error && <div className="mt-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {result && <IntelligenceResult result={result} title={`${selected.name} ventures & innovation dossier`} />}
    </div>
  );
}
