import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  FileSearch,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResearchProgress } from "@/components/spa/ResearchProgress";
import {
  getTenderRecords,
  getTenderScanProgress,
  getTenderScanRuns,
  runTenderScanNow,
} from "@/lib/spa/tenders.functions";
import type { TenderRecord, TenderScanAudit, TenderScanProgress } from "@/lib/spa/tenders.server";

export const Route = createFileRoute("/_authenticated/_app/tenders")({
  head: () => ({ meta: [{ title: "Tender Intelligence — SPA Intelligence" }] }),
  component: TenderIntelligence,
});

const BUSINESS_LABELS = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
} as const;

function prettyClosing(value: TenderRecord["closingWindow"]) {
  const labels = {
    within_48_hours: "Within 48 hours",
    within_7_days: "Within 7 days",
    within_14_days: "Within 14 days",
    later: "Later",
    unknown: "Unknown",
    expired: "Expired",
  };
  return labels[value];
}

function formatDate(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  }).format(date);
}

function TenderIntelligence() {
  const list = useServerFn(getTenderRecords);
  const scan = useServerFn(runTenderScanNow);
  const getProgress = useServerFn(getTenderScanProgress);
  const getRuns = useServerFn(getTenderScanRuns);

  const [records, setRecords] = useState<TenderRecord[]>([]);
  const [runs, setRuns] = useState<TenderScanAudit[]>([]);
  const [progress, setProgress] = useState<TenderScanProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [business, setBusiness] = useState("all");
  const [source, setSource] = useState("all");
  const [issuer, setIssuer] = useState("all");
  const [state, setState] = useState("all");
  const [category, setCategory] = useState("all");
  const [relevance, setRelevance] = useState("all");
  const [status, setStatus] = useState("all");
  const [closing, setClosing] = useState("all");
  const [discovered, setDiscovered] = useState("all");

  async function refresh() {
    const [nextRecords, nextRuns] = await Promise.all([list(), getRuns()]);
    setRecords(nextRecords as TenderRecord[]);
    setRuns(nextRuns as TenderScanAudit[]);
  }

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
        setProgress(await getProgress() as TenderScanProgress | null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runScan() {
    setScanning(true);
    setError(null);
    let timer: number | undefined;
    try {
      timer = window.setInterval(() => {
        void getProgress()
          .then((value) => setProgress(value as TenderScanProgress | null))
          .catch(() => undefined);
      }, 850);
      await scan();
      setProgress(await getProgress() as TenderScanProgress | null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try { setProgress(await getProgress() as TenderScanProgress | null); } catch { /* ignore */ }
    } finally {
      if (timer) window.clearInterval(timer);
      setScanning(false);
    }
  }

  const values = useMemo(() => ({
    sources: [...new Set(records.map((x) => x.sourceName).filter(Boolean))].sort(),
    issuers: [...new Set(records.map((x) => x.issuer).filter((x): x is string => !!x))].sort(),
    states: [...new Set(records.map((x) => x.state).filter((x): x is string => !!x))].sort(),
    categories: [...new Set(records.map((x) => x.category).filter((x): x is string => !!x))].sort(),
  }), [records]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = Date.now();
    return records.filter((row) => {
      if (query) {
        const haystack = [
          row.title, row.issuer, row.referenceNumber, row.category, row.location,
          row.sourceName, row.summary, ...row.capabilityMatches,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (business !== "all" && !row.assignedBusinessContexts.includes(business as any)) return false;
      if (source !== "all" && row.sourceName !== source) return false;
      if (issuer !== "all" && row.issuer !== issuer) return false;
      if (state !== "all" && row.state !== state) return false;
      if (category !== "all" && row.category !== category) return false;
      if (status !== "all" && row.workflowStatus !== status) return false;
      if (closing !== "all" && row.closingWindow !== closing) return false;
      if (relevance === "high" && row.relevanceScore < 60) return false;
      if (relevance === "medium" && (row.relevanceScore < 30 || row.relevanceScore >= 60)) return false;
      if (relevance === "low" && row.relevanceScore >= 30) return false;
      if (discovered !== "all") {
        const days = Number(discovered);
        if (Number.isFinite(days) && new Date(row.firstDiscovered).getTime() < now - days * 86400000) return false;
      }
      return true;
    });
  }, [records, search, business, source, issuer, state, category, relevance, status, closing, discovered]);

  const counters = useMemo(() => ({
    new: records.filter((x) => x.workflowStatus === "New").length,
    high: records.filter((x) => x.relevanceScore >= 60 && x.workflowStatus !== "Expired").length,
    soon: records.filter((x) => x.closingWindow === "within_48_hours" || x.closingWindow === "within_7_days").length,
    review: records.filter((x) => x.workflowStatus === "Review" || x.workflowStatus === "Interested").length,
    pursuing: records.filter((x) => x.workflowStatus === "Pursue" || x.workflowStatus === "Bid / Response in progress").length,
    submitted: records.filter((x) => x.workflowStatus === "Submitted").length,
    expired: records.filter((x) => x.workflowStatus === "Expired" || x.closingWindow === "expired").length,
  }), [records]);

  const latestRun = runs[0] ?? null;

  if (loading) {
    return <div className="mx-auto max-w-7xl"><ResearchProgress detail="Loading tender intelligence." /></div>;
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Commercial intelligence / procurement</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tender Intelligence</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Official-source procurement monitoring for Solar Power Australia, Solar Online and ELMOFO. Relevance is an explainable capability-fit score, not a probability of winning.
          </p>
        </div>
        <Button onClick={runScan} disabled={scanning}>
          <RefreshCw className={"mr-2 h-4 w-4 " + (scanning ? "animate-spin" : "")} />
          {scanning ? "Tender scan running…" : "Run Tender Scan Now"}
        </Button>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["New", counters.new],
          ["High relevance", counters.high],
          ["Closing soon", counters.soon],
          ["Under review", counters.review],
          ["Pursuing", counters.pursuing],
          ["Submitted", counters.submitted],
          ["Expired", counters.expired],
        ].map(([label, value]) => (
          <div key={label} className="border border-border bg-card p-4">
            <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      {(scanning || (progress && !["Complete", "Failed"].includes(progress.stage))) && (
        <div className="mb-5">
          <ResearchProgress detail={
            progress
              ? progress.stage + " — " + progress.message + " " + progress.completedSources + "/" + progress.totalSources + " sources; " + progress.discovered + " records retrieved."
              : "Starting tender scan."
          } />
        </div>
      )}

      {error && (
        <div className="mb-5 flex gap-2 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {latestRun && (
        <section className="mb-5 border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Latest scan audit</div>
              <div className="mt-1 text-sm">
                <span className="font-semibold capitalize">{latestRun.status}</span>
                {" · "}{latestRun.newTenders} new
                {" · "}{latestRun.updatedTenders} changed
                {" · "}{latestRun.unchangedTenders} unchanged
                {" · "}{latestRun.duplicatesRemoved} duplicates removed
                {" · "}{latestRun.aiEnrichments} AI enrichments
              </div>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">{formatDate(latestRun.endedAt)}</div>
          </div>
          {!!latestRun.sourceFailures.length && (
            <div className="mt-3 border-l-2 border-amber-500/50 pl-3 text-xs text-muted-foreground">
              {latestRun.sourceFailures.map((failure) => (
                <div key={failure.source}><span className="font-medium text-foreground">{failure.source}:</span> {failure.error}</div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mb-5 border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Search & filters</h2>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{filtered.length} shown / {records.length} stored</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, issuer, reference, category or capability…" className="pl-9" />
          </label>
          <select value={business} onChange={(e) => setBusiness(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All businesses</option>
            <option value="spa">Solar Power Australia</option>
            <option value="solaronline">Solar Online</option>
            <option value="elmofo">ELMOFO</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All sources</option>
            {values.sources.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={issuer} onChange={(e) => setIssuer(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All issuers</option>
            {values.issuers.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All states / locations</option>
            {values.states.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All categories</option>
            {values.categories.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All relevance</option>
            <option value="high">High (60+)</option>
            <option value="medium">Medium (30–59)</option>
            <option value="low">Low (&lt;30)</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">All workflow states</option>
            {["New","Review","Interested","Pursue","Bid / Response in progress","Submitted","Won","Lost","No bid","Dismissed","Expired"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={closing} onChange={(e) => setClosing(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">Any closing date</option>
            <option value="within_48_hours">Within 48 hours</option>
            <option value="within_7_days">Within 7 days</option>
            <option value="within_14_days">Within 14 days</option>
            <option value="later">Later</option>
            <option value="unknown">Unknown</option>
            <option value="expired">Expired</option>
          </select>
          <select value={discovered} onChange={(e) => setDiscovered(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
            <option value="all">Any discovery date</option>
            <option value="1">Discovered today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
      </section>

      <section className="border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1.6fr)_180px_150px_110px_130px_150px] gap-3 border-b border-border px-4 py-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground max-xl:hidden">
          <div>Tender / issuer</div><div>Business fit</div><div>Location / close</div><div>Relevance</div><div>Status</div><div>Source</div>
        </div>
        <div className="divide-y divide-border">
          {filtered.map((row) => (
            <article key={row.id} className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1.6fr)_180px_150px_110px_130px_150px] xl:items-start">
              <div className="min-w-0">
                <Link to="/tenders/$tenderId" params={{ tenderId: row.id }} className="font-semibold hover:text-primary">{row.title}</Link>
                <div className="mt-1 text-xs text-muted-foreground">{row.issuer || "Issuer not published"}{row.referenceNumber ? " · " + row.referenceNumber : ""}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {row.capabilityMatches.slice(0, 4).map((match) => <span key={match} className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{match}</span>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {row.assignedBusinessContexts.length
                  ? row.assignedBusinessContexts.map((item) => <span key={item} className="border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px]">{BUSINESS_LABELS[item]}</span>)
                  : <span className="text-xs text-muted-foreground">No strong fit</span>}
              </div>
              <div>
                <div className="text-xs">{row.location || row.state || "Location unknown"}</div>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarClock className="h-3 w-3" />{prettyClosing(row.closingWindow)}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{formatDate(row.normalizedCloseTimestamp)}</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{row.relevanceScore}</div>
                <div className="font-mono text-[9px] uppercase text-muted-foreground">fit / 100</div>
              </div>
              <div><span className="border border-border px-2 py-1 text-[10px]">{row.workflowStatus}</span></div>
              <div>
                <div className="text-xs">{row.sourceName}</div>
                <a href={row.canonicalSourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">Official source <ExternalLink className="h-3 w-3" /></a>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="p-10 text-center">
              <FileSearch className="mx-auto h-7 w-7 text-muted-foreground" />
              <div className="mt-2 text-sm font-medium">{records.length ? "No tenders match these filters." : "No tenders stored yet."}</div>
              <p className="mt-1 text-xs text-muted-foreground">{records.length ? "Adjust the filters above." : "Run Tender Scan Now to query the enabled official sources."}</p>
            </div>
          )}
        </div>
      </section>

      <div className="mt-4 flex items-start gap-2 border border-border bg-card p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Tender Intelligence never submits a bid, emails an issuer or commits a business commercially. External actions must go through approval.
      </div>
    </div>
  );
}
