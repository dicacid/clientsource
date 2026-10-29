import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Calculator, CircleAlert, Download, ExternalLink, Loader2, Radar, RefreshCw, Search, ShieldCheck, Sun, Zap } from "lucide-react";
import type { PulseSignal, SourceCheck } from "@/lib/energy/market";

export const Route = createFileRoute("/energy")({
  head: () => ({
    meta: [
      { title: "Energy Market Lab | Live commercial energy intelligence" },
      { name: "description", content: "Source-verified market policy radar and commercial solar scenario calculations." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EnergyMarketLab,
});
type Pulse = { checkedAt: string; checks: SourceCheck[]; signals: PulseSignal[]; live: boolean; note: string };
type Inputs = {
  sizeKw: number; production: number; onsite: number; gridRate: number;
  exportRate: number; capex: number; annualCost: number; incentive: number;
};
const initial: Inputs = { sizeKw: 250, production: 1400, onsite: 80, gridRate: 0.28, exportRate: 0.05, capex: 300000, annualCost: 4000, incentive: 0 };
const sectors = ["All sectors", "Commercial", "Warehousing", "Manufacturing", "Agriculture", "Logistics", "Installers", "Residential", "Distributors"];
const currencies = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
function money(n: number) { return currencies.format(n); }
function date(s: string) { const t = Date.parse(s); return Number.isFinite(t) ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "Australia/Sydney" }).format(new Date(t)) : "Unknown"; }
function time(s: string) { const t = Date.parse(s); return Number.isFinite(t) ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(t)) + " AEDT" : "Unavailable"; }
function calc(v: Inputs) {
  if (Object.values(v).some((n) => !Number.isFinite(n)) || v.sizeKw <= 0 || v.sizeKw > 100000 ||
      v.production < 0 || v.production > 3000 || v.onsite < 0 || v.onsite > 100 ||
      v.gridRate < 0 || v.exportRate < 0 || v.capex < 0 || v.annualCost < 0 || v.incentive < 0) return null;
  const generation = v.sizeKw * v.production;
  const onsiteKwh = generation * v.onsite / 100;
  const gross = onsiteKwh * v.gridRate + (generation - onsiteKwh) * v.exportRate;
  const net = gross - v.annualCost;
  const cost = Math.max(0, v.capex - v.incentive);
  return { generation, onsiteKwh, gross, net, cost, payback: net > 0 ? cost / net : null };
}
function EnergyMarketLab() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sector, setSector] = useState("All sectors");
  const [region, setRegion] = useState("All regions");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>(initial);
  const [company, setCompany] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/energy/pulse", { cache: "no-store" });
      const value = await response.json() as Pulse;
      setPulse(value);
      if (!response.ok) setError("No official source passed live verification. See source checks below and retry.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access the live source endpoint.");
      setPulse(null);
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const filtered = useMemo(() => (pulse?.signals ?? []).filter((s) => (
    (sector === "All sectors" || s.audiences.includes(sector)) &&
    (region === "All regions" || s.jurisdiction === "Australia" || s.jurisdiction === region) &&
    (!query.trim() || [s.title, s.evidence, s.commercialAngle, s.audiences.join(" ")].join(" ").toLowerCase().includes(query.trim().toLowerCase()))
  )), [pulse, sector, region, query]);
  const active = filtered.find((s) => s.id === selected) ?? filtered[0] ?? null;
  const numbers = useMemo(() => calc(inputs), [inputs]);
  function edit(name: keyof Inputs, raw: string) {
    setInputs((v) => ({ ...v, [name]: raw.trim() ? Number(raw) : NaN }));
  }
  function download() {
    const report = { createdAt: new Date().toISOString(), name: "Energy Market Lab research brief", operatorProfile: company.trim() || null,
      filters: { sector, region, query }, sourcesChecked: pulse?.checks ?? [], findings: filtered,
      caseStudy: { assumptions: inputs, output: numbers, disclaimer: "Scenario only: NOT a quotation or guarantee. Inputs are operator assumptions. Incentive value is not calculated or verified. Excludes depreciation, tax, degradation, connection fees and finance." },
      caveat: "Only matching known policy items on three preselected official pages are monitored. Strategic interpretations are hypotheses. This is not a complete market or legislative monitor." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "energy-market-brief.json"; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <main className="min-h-screen bg-[#090e17] text-slate-100">
      <div className="mx-auto max-w-[1300px] px-4 py-7 sm:px-7 sm:py-9">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10"><Zap size={24} className="text-cyan-300" /></div>
            <div><div className="font-mono text-[11px] font-semibold uppercase tracking-[0.21em] text-cyan-300">Energy Market Lab</div><div className="mt-1 text-xs text-slate-400">Commercial intelligence • Independent research preview</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 text-sm hover:bg-white/10 disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh live sources</button>
            <button type="button" onClick={download} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-300"><Download className="h-4 w-4" /> Export evidence</button>
          </div>
        </header>
        <section className="grid gap-6 py-8 lg:grid-cols-[1.45fr_1fr] lg:items-center">
          <div><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 font-mono text-[11px] text-cyan-200"><Radar className="h-3.5 w-3.5" /> POLICY → CUSTOMER NEED → COMMERCIAL ACTION</div>
            <h1 className="max-w-[720px] text-3xl font-semibold tracking-tight sm:text-5xl">Find the energy opportunities <span className="text-cyan-300">before the market moves.</span></h1>
            <p className="mt-4 max-w-[660px] text-sm leading-7 text-slate-300">Checks live Australian government pages, verifies known policy changes against published wording and translates them into testable customer segments and business moves. Model the economics using your own assumptions.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs text-slate-400">Verified signals</div><div className="mt-2 text-3xl font-semibold">{pulse?.signals.length ?? (loading ? "…" : 0)}</div><div className="mt-2 text-xs text-cyan-300">Official source matches</div></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="text-xs text-slate-400">Sources checked</div><div className="mt-2 text-3xl font-semibold">{pulse?.checks.length ?? (loading ? "…" : 0)}</div><div className="mt-2 text-xs text-slate-400">Three official sources configured</div></div>
            <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-center gap-2 text-xs text-slate-400"><Activity size={14} /> Retrieval status</div><div className="mt-2 text-sm font-medium">{loading ? "Reading official pages…" : error ? "Live checks incomplete" : pulse?.live ? "Verified source evidence available" : "No verified items returned"}</div><div className="mt-1 text-xs text-slate-400">{pulse ? time(pulse.checkedAt) : "No verified scan timestamp yet"}</div></div>
          </div>
        </section>
        {error && <div role="alert" className="mb-5 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"><CircleAlert className="h-5 w-5 shrink-0" /> {error}</div>}
        <section className="rounded-xl border border-white/10 bg-[#101927] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-semibold"><Search size={18} className="text-cyan-300" /> Market opportunity radar</h2><span className="text-xs text-slate-400">Evidence links on every verified signal</span></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-400">Customer segment<select value={sector} onChange={(e) => setSector(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-white/20 bg-[#182333] px-3 text-base text-white">{sectors.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="text-xs text-slate-400">Jurisdiction<select value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-white/20 bg-[#182333] px-3 text-base text-white">{["All regions","NSW","WA"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="text-xs text-slate-400">Search verified evidence<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. battery, warehouse" className="mt-1 block min-h-11 w-full rounded-lg border border-white/20 bg-[#182333] px-3 text-base text-white placeholder:text-slate-500" /></label>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {filtered.map((s) => (
              <button type="button" onClick={() => setSelected(s.id)} key={s.id} className={"min-h-48 rounded-lg border p-4 text-left transition " + (active?.id === s.id ? "border-cyan-400/70 bg-cyan-400/10" : "border-white/10 bg-[#121f2e] hover:border-white/30")}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">SOURCE VERIFIED</span><span className="text-xs text-slate-400">{s.jurisdiction}</span></div>
                <h3 className="text-base font-semibold leading-snug">{s.title}</h3>
                <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300">{s.evidence}</p>
                <div className="mt-4 text-xs font-medium text-cyan-300">Explore business angle →</div>
              </button>
            ))}
            {!loading && !filtered.length && <div className="col-span-full rounded-lg border border-dashed border-white/20 px-5 py-10 text-center text-sm text-slate-400">No verified matches for these filters. Change the filters or refresh official sources. No opportunities have been invented.</div>}
            {loading && <div className="col-span-full flex min-h-44 items-center justify-center gap-2 text-sm text-slate-300"><Loader2 className="h-5 w-5 animate-spin" /> Checking live government sources…</div>}
          </div>
          {active && <div className="mt-4 rounded-lg border border-cyan-500/20 bg-[#0c1522] p-5">
            <div className="mb-3 flex flex-wrap gap-2"><span className="rounded-md bg-white/10 px-2.5 py-1 text-xs uppercase text-slate-300">{active.stage.replace("_", " ")}</span><span className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-slate-300">Policy date: {date(active.effectiveDate)}</span></div>
            <h3 className="text-lg font-semibold">Where the commercial opportunity is</h3><p className="mt-2 text-sm leading-6 text-slate-200">{active.commercialAngle}</p>
            <h4 className="mt-5 text-sm font-semibold text-cyan-300">Recommended first move</h4><p className="mt-2 text-sm leading-6 text-slate-300">{active.nextAction}</p>
            <p className="mt-4 text-xs text-slate-400">Strategy is an inference from verified regulatory evidence, not a verified customer order or revenue forecast.</p>
            <a className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-cyan-300 underline underline-offset-4" href={active.sourceUrl} target="_blank" rel="noreferrer">Read original government source <ExternalLink size={15} /></a>
          </div>}
        </section>
        <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-white/10 bg-[#101927] p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Calculator className="text-cyan-300" size={19} /> Solar business-case engine</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">Actual calculations from editable assumptions. No claimed market prices or invented government rebates. Enter a verified incentive value only if known.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">{([
              ["sizeKw", "System capacity (kW)", "1"],
              ["production", "Annual yield (kWh/kW)", "10"],
              ["onsite", "Self-consumption (%)", "1"],
              ["gridRate", "Avoided tariff (AUD/kWh)", "0.01"],
              ["exportRate", "Export value (AUD/kWh)", "0.01"],
              ["capex", "Installed cost (AUD)", "1000"],
              ["annualCost", "Annual O&M (AUD)", "100"],
              ["incentive", "Verified incentive (AUD)", "1000"],
            ] as const).map(([key, label, step]) => <label key={key} className="text-xs text-slate-300">{label}<input type="number" step={step} value={Number.isNaN(inputs[key]) ? "" : inputs[key]} onChange={(e) => edit(key, e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-white/20 bg-[#182333] px-3 text-base text-white" /></label>)}</div>
            {!numbers && <p role="alert" className="mt-4 text-sm text-amber-300">Correct the inputs. Capacity must be positive; yearly yield 0–3,000; self-use 0–100%; other values non-negative.</p>}
            <button type="button" onClick={() => setInputs(initial)} className="mt-4 inline-flex min-h-11 items-center text-sm text-cyan-300 underline">Reset example assumptions</button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#101927] p-5"><h2 className="flex items-center gap-2 text-lg font-semibold"><Sun size={20} className="text-cyan-300" /> Commercial return scenario</h2>
            <p className="mt-2 text-xs text-slate-400">Live recalculation when assumptions change. Illustrative only.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["Annual generation", numbers ? integer.format(numbers.generation) + " kWh" : "—"],
                ["Onsite energy", numbers ? integer.format(numbers.onsiteKwh) + " kWh" : "—"],
                ["Annual gross value", numbers ? money(numbers.gross) : "—"],
                ["Net capital cost", numbers ? money(numbers.cost) : "—"],
              ].map(([label, value]) => <div key={label} className="rounded-lg border border-white/10 bg-[#182333] p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-2 break-words text-xl font-semibold">{value}</div></div>)}
            </div>
            <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-5"><div className="text-sm text-slate-300">Simple payback period</div><div className="mt-2 text-4xl font-semibold text-cyan-300">{numbers?.payback === null || !numbers ? "Not achievable" : numbers.payback.toFixed(1) + " years"}</div><div className="mt-2 text-xs text-slate-300">Annual net benefit: {numbers ? money(numbers.net) : "—"}</div></div>
            <p className="mt-4 text-xs leading-5 text-slate-400">Not a quote, bankable model or regulatory eligibility determination. Excludes borrowing, tax, export constraints, demand charges, losses, degradation and maintenance escalation.</p>
          </div>
        </section>
        <section className="mt-5 rounded-xl border border-white/10 bg-[#101927] p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="text-cyan-300" size={19} /> Source audit and commercial context</h2>
          <p className="mt-2 text-sm text-slate-400">Source status is based on actual network responses, not a simulated green light. This monitor currently checks three selected regulatory webpages, not the entire energy market.</p>
          <label className="mt-5 block max-w-xl text-xs text-slate-300">Optional company / delivery capability for your exported brief<textarea rows={2} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Commercial PV engineering, battery design, remote power, EPC in NSW" maxLength={3000} className="mt-1 block w-full rounded-lg border border-white/20 bg-[#182333] px-3 py-3 text-base text-white placeholder:text-slate-500" /></label>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">{(pulse?.checks ?? []).map((c) => <div key={c.id} className="rounded-lg border border-white/10 p-4"><div className="mb-2 flex justify-between gap-2"><strong className="text-sm uppercase">{c.id}</strong><span className={"text-xs " + (c.status === "verified" ? "text-emerald-300" : "text-amber-300")}>{c.status.replace("_", " ")}</span></div><p className="text-xs leading-5 text-slate-400">{c.note}</p><p className="mt-2 text-xs text-slate-500">HTTP {c.httpStatus ?? "unavailable"} · {time(c.checkedAt)}</p><a href={c.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs text-cyan-300 underline">Official page <ArrowUpRight size={14} /></a></div>)}</div>
        </section>
        <footer className="py-8 text-xs leading-6 text-slate-500">Energy Market Lab by Revealing Mind AI · Independent technical demonstration · Official source links above · No affiliation with government agencies. No API key, customer records or payment data is collected by this screen. Regulatory dates must be rechecked before execution.</footer>
      </div>
    </main>
  );
}
