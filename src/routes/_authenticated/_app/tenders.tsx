import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Clock3, ExternalLink, FileSearch, Filter, RefreshCw, Search, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { classifyClosing, highRelevance, type TenderRecord, type TenderWorkflowStatus } from "@/lib/spa/tenders";
import {
  getTenderAudits,
  getTenderRecords,
  getTenderScanState,
  startTenderScan,
} from "@/lib/spa/tender.functions";
import type { TenderScanRun } from "@/lib/spa/tender.server";

export const Route = createFileRoute("/_authenticated/_app/tenders")({
  head: () => ({ meta: [{ title: "Tender Intelligence — SPA Intelligence" }] }),
  component: TenderIntelligence,
});

const BUSINESS_LABEL: Record<string, string> = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
};

const STATUSES: TenderWorkflowStatus[] = [
  "New", "Review", "Interested", "Pursue", "Bid / Response in progress",
  "Submitted", "Won", "Lost", "No bid", "Dismissed", "Expired",
];

function fmtDate(value: string | null) {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(parsed));
}

function bandLabel(record: TenderRecord) {
  const band = classifyClosing(record.normalizedCloseTimestamp);
  if (band === "within_48h") return "Closes within 48h";
  if (band === "within_7d") return "Closes within 7 days";
  if (band === "within_14d") return "Closes within 14 days";
  if (band === "expired") return "Expired";
  if (band === "unknown") return "Closing date unknown";
  return "Later";
}

function ScanProgress({ run }: { run: TenderScanRun | null }) {
  if (!run) return null;
  const stages = ["Starting", "Checking sources", "Retrieving opportunities", "Verifying", "Deduplicating", "Analysing relevance", "Saving", "Complete"];
  const active = Math.max(0, stages.indexOf(run.stage));
  const percent = Math.round(((active + (run.stage === "Complete" ? 1 : 0.35)) / stages.length) * 100);
  return (
    <div className="border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            Tender scan · {run.state}
          </div>
          <div className="mt-1 text-sm font-medium">{run.stage}</div>
        </div>
        <div className="font-mono text-xs text-muted-foreground">{Math.min(100, percent)}%</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-border">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
        <div>Sources: {run.sourceSuccesses}/{run.sourcesAttempted || "—"} succeeded</div>
        <div>Discovered: {run.opportunitiesDiscovered}</div>
        <div>New / updated: {run.newTenders} / {run.updatedTenders}</div>
        <div>AI enrichments: {run.aiEnrichments}</div>
      </div>
      {!!run.errors.length && (
        <div className="mt-3 border-l-2 border-amber-500/50 pl-3 text-xs text-amber-300">
          {run.errors.slice(-3).map((error) => <div key={error}>{error}</div>)}
        </div>
      )}
    </div>
  );
}

function TenderIntelligence() {
  const list = useServerFn(getTenderRecords);
  const getAudits = useServerFn(getTenderAudits);
  const getScan = useServerFn(getTenderScanState);
  const scanNow = useServerFn(startTenderScan);

  const [records, setRecords] = useState<TenderRecord[]>([]);
  const [audits, setAudits] = useState<TenderScanRun[]>([]);
  const [scan, setScan] = useState<TenderScanRun | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [business, setBusiness] = useState("all");
  const [source, setSource] = useState("all");
  const [issuer, setIssuer] = useState("");
  const [state, setState] = useState("all");
  const [category, setCategory] = useState("");
  const [relevance, setRelevance] = useState("all");
  const [workflow, setWorkflow] = useState("all");
  const [closing, setClosing] = useState("all");
  const [discoveredAfter, setDiscoveredAfter] = useState("");

  async function load() {
    const [rows, history, current] = await Promise.all([list(), getAudits(), getScan()]);
    setRecords(rows as TenderRecord[]);
    setAudits(history as TenderScanRun[]);
    setScan(current as TenderScanRun | null);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false));
  }, []);

  async function runScan() {
    if (running) return;
    setRunning(true);
    setError(null);
    const poll = window.setInterval(() => {
      void getScan().then((current) => setScan(current as TenderScanRun | null)).catch(() => undefined);
    }, 800);
    try {
      const completed = await scanNow();
      setScan(completed as TenderScanRun);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearInterval(poll);
      setRunning(false);
    }
  }

  const sources = useMemo(() => [...new Set(records.map((r) => r.sourceName))].sort(), [records]);
  const states = useMemo(() => [...new Set(records.map((r) => r.state).filter(Boolean) as string[])].sort(), [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const issuerNeedle = issuer.trim().toLowerCase();
    const categoryNeedle = category.trim().toLowerCase();
    const discoveredAt = discoveredAfter ? Date.parse(discoveredAfter) : null;
    return records.filter((record) => {
      if (q && ![
        record.tenderTitle, record.issuer, record.referenceNumber, record.summary,
        record.location, record.category, record.sourceName,
      ].some((value) => String(value ?? "").toLowerCase().includes(q))) return false;
      if (business !== "all" && !record.assignedBusinessContexts.includes(business as any)) return false;
      if (source !== "all" && record.sourceName !== source) return false;
      if (issuerNeedle && !record.issuer.toLowerCase().includes(issuerNeedle)) return false;
      if (state !== "all" && record.state !== state) return false;
      if (categoryNeedle && !String(record.category ?? record.opportunityType).toLowerCase().includes(categoryNeedle)) return false;
      if (workflow !== "all" && record.workflowStatus !== workflow) return false;
      if (relevance === "high" && !highRelevance(record.relevanceScore)) return false;
      if (relevance === "medium" && !(record.relevanceScore >= 40 && record.relevanceScore < 65)) return false;
      if (relevance === "low" && record.relevanceScore >= 40) return false;
      if (closing !== "all" && classifyClosing(record.normalizedCloseTimestamp) !== closing) return false;
      if (discoveredAt && Date.parse(record.firstDiscovered) < discoveredAt) return false;
      return true;
    });
  }, [records, query, business, source, issuer, state, category, relevance, workflow, closing, discoveredAfter]);

  const counts = useMemo(() => ({
    new: records.filter((r) => r.workflowStatus === "New").length,
    high: records.filter((r) => highRelevance(r.relevanceScore) && r.workflowStatus !== "Dismissed" && r.workflowStatus !== "Expired").length,
    closingSoon: records.filter((r) => ["within_48h", "within_7d"].includes(classifyClosing(r.normalizedCloseTimestamp))).length,
    review: records.filter((r) => r.workflowStatus === "Review").length,
    pursuing: records.filter((r) => ["Interested", "Pursue", "Bid / Response in progress"].includes(r.workflowStatus)).length,
    submitted: records.filter((r) => r.workflowStatus === "Submitted").length,
    expired: records.filter((r) => r.workflowStatus === "Expired" || classifyClosing(r.normalizedCloseTimestamp) === "expired").length,
  }), [records]);

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Procurement intelligence / verified opportunities</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tender Intelligence</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Discover, verify, deduplicate, route and monitor Australian procurement opportunities across Solar Power Australia, Solar Online and ELMOFO. Relevance scores measure fit, not probability of winning.
          </p>
        </div>
        <Button onClick={runScan} disabled={running}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Tender scan running…" : "Run Tender Scan Now"}
        </Button>
      </header>

      {(running || scan?.state === "running") && <div className="mb-5"><ScanProgress run={scan} /></div>}
      {!running && scan && <div className="mb-5"><ScanProgress run={scan} /></div>}
      {error && <div className="mb-5 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {[
          ["New", counts.new],
          ["High relevance", counts.high],
          ["Closing soon", counts.closingSoon],
          ["Under review", counts.review],
          ["Pursuing", counts.pursuing],
          ["Submitted", counts.submitted],
          ["Expired", counts.expired],
        ].map(([label, value]) => (
          <div key={label} className="border border-border bg-card p-4">
            <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <section className="mb-5 border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Filters</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, issuer, reference, location…" className="h-11 pl-9" />
          </div>
          <select value={business} onChange={(e) => setBusiness(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All businesses</option>
            <option value="spa">Solar Power Australia</option>
            <option value="solaronline">Solar Online</option>
            <option value="elmofo">ELMOFO</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All sources</option>
            {sources.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer contains…" className="h-11" />
          <select value={state} onChange={(e) => setState(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All states / locations</option>
            {states.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category / type contains…" className="h-11" />
          <select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All relevance</option>
            <option value="high">High, 65+</option>
            <option value="medium">Medium, 40–64</option>
            <option value="low">Low, under 40</option>
          </select>
          <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All workflow states</option>
            {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={closing} onChange={(e) => setClosing(e.target.value)} className="h-11 border border-input bg-background px-3 text-sm">
            <option value="all">All closing dates</option>
            <option value="within_48h">Within 48 hours</option>
            <option value="within_7d">Within 7 days</option>
            <option value="within_14d">Within 14 days</option>
            <option value="later">Later</option>
            <option value="unknown">Unknown</option>
            <option value="expired">Expired</option>
          </select>
          <Input type="date" value={discoveredAfter} onChange={(e) => setDiscoveredAfter(e.target.value)} className="h-11" title="Discovered on or after" />
        </div>
      </section>

      <section className="border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Canonical tender register</div>
            <div className="mt-1 text-sm text-muted-foreground">{filtered.length} shown of {records.length} stored</div>
          </div>
          {audits[0] && (
            <div className="text-right text-xs text-muted-foreground">
              Last scan: {audits[0].state} · {audits[0].newTenders} new · {audits[0].updatedTenders} changed
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading Tender Intelligence…</div>
        ) : !filtered.length ? (
          <div className="p-8 text-center">
            <FileSearch className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-3 font-medium">No tenders match the current view.</div>
            <div className="mt-1 text-sm text-muted-foreground">Run a scan or clear filters.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((record) => (
              <article key={record.id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.7fr)_220px_145px_160px_150px] xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/tenders/$tenderId" params={{ tenderId: record.id }} className="font-semibold hover:text-primary">
                      {record.tenderTitle}
                    </Link>
                    {highRelevance(record.relevanceScore) && <span className="border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-[9px] uppercase text-primary">high relevance</span>}
                    {record.workflowStatus === "Dismissed" && <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">dismissed</span>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {record.issuer} {record.referenceNumber ? `· ${record.referenceNumber}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {record.assignedBusinessContexts.length
                      ? record.assignedBusinessContexts.map((context) => (
                          <span key={context} className="border border-primary/25 bg-primary/5 px-2 py-1 text-[10px]">
                            {BUSINESS_LABEL[context]}
                          </span>
                        ))
                      : <span className="border border-border px-2 py-1 text-[10px] text-muted-foreground">No supported business fit yet</span>}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{record.location || record.state || "Location not confirmed"} · {record.opportunityType}</div>
                </div>

                <div>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Closing</div>
                  <div className="mt-1 text-sm">{fmtDate(record.normalizedCloseTimestamp)}</div>
                  <div className={`mt-1 text-xs ${["within_48h", "within_7d"].includes(classifyClosing(record.normalizedCloseTimestamp)) ? "text-amber-300" : "text-muted-foreground"}`}>
                    <Clock3 className="mr-1 inline h-3 w-3" />{bandLabel(record)}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Relevance</div>
                  <div className="mt-1 text-2xl font-semibold">{record.relevanceScore}</div>
                  <div className="text-[10px] text-muted-foreground">fit score / 100</div>
                </div>

                <div>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Workflow</div>
                  <div className="mt-1 text-sm">{record.workflowStatus}</div>
                  {record.risksUnknowns.length > 0 && <div className="mt-1 text-[10px] text-amber-300"><ShieldAlert className="mr-1 inline h-3 w-3" />{record.risksUnknowns.length} unknown/risk item(s)</div>}
                </div>

                <div>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">Source</div>
                  <a href={record.canonicalSourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    {record.sourceName}<ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="mt-2">
                    <Link to="/tenders/$tenderId" params={{ tenderId: record.id }} className="text-xs font-medium hover:text-primary">Open intelligence →</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
