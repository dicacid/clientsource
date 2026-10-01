import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  FileText,
  History,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getTenderRecord,
  queueTenderActionApproval,
  updateTenderNotes,
  updateTenderWorkflowStatus,
} from "@/lib/spa/tenders.functions";
import type { TenderRecord } from "@/lib/spa/tenders.server";

export const Route = createFileRoute("/_authenticated/_app/tenders/$tenderId")({
  head: () => ({ meta: [{ title: "Tender Detail — SPA Intelligence" }] }),
  component: TenderDetail,
});

const BUSINESS_LABELS = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
} as const;

const STATUSES = [
  "New",
  "Review",
  "Interested",
  "Pursue",
  "Bid / Response in progress",
  "Submitted",
  "Won",
  "Lost",
  "No bid",
  "Dismissed",
  "Expired",
] as const;

function formatDate(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  }).format(date);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <div className="border-b border-border px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TenderDetail() {
  const { tenderId } = Route.useParams();
  const getRecord = useServerFn(getTenderRecord);
  const setStatus = useServerFn(updateTenderWorkflowStatus);
  const saveNotes = useServerFn(updateTenderNotes);
  const queueApproval = useServerFn(queueTenderActionApproval);

  const [record, setRecord] = useState<TenderRecord | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const next = await getRecord({ data: { id: tenderId } }) as TenderRecord;
    setRecord(next);
    setNotes(next.notes ?? "");
  }

  useEffect(() => {
    void reload()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenderId]);

  const factualEvidence = useMemo(
    () => (record?.evidence ?? []).filter((item) => item.classification === "OBSERVED_FACT" || item.classification === "SOURCE_CLAIM"),
    [record],
  );
  const interpretation = useMemo(
    () => (record?.evidence ?? []).filter((item) => item.classification === "INFERENCE" || item.classification === "COMMERCIAL_HYPOTHESIS"),
    [record],
  );

  async function changeStatus(status: typeof STATUSES[number]) {
    if (!record) return;
    setError(null);
    try {
      const updated = await setStatus({ data: { id: record.id, status } }) as TenderRecord;
      setRecord(updated);
      setMessage("Workflow status saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveInternalNotes() {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await saveNotes({ data: { id: record.id, notes } }) as TenderRecord;
      setRecord(updated);
      setMessage("Internal notes saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addApproval() {
    if (!record) return;
    setQueueing(true);
    setError(null);
    try {
      await queueApproval({
        data: {
          id: record.id,
          action: "Review and approve any proposed issuer contact or tender submission",
        },
      });
      setMessage("External-action review added to the Approval Queue. Nothing was sent or submitted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueing(false);
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading tender detail…</div>;
  if (error && !record) return <div className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>;
  if (!record) return <div className="text-sm text-muted-foreground">Tender not found.</div>;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5">
        <Link to="/tenders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Tender Intelligence
        </Link>
      </div>

      <header className="mb-6 border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-4xl">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">{record.sourceName} / {record.referenceNumber || "reference not published"}</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{record.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{record.issuer || "Issuer not published"} · {record.location || record.state || "Location not published"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={record.workflowStatus}
              onChange={(e) => void changeStatus(e.target.value as typeof STATUSES[number])}
              className="h-10 border border-input bg-background px-3 text-sm"
            >
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <a href={record.canonicalSourceUrl} target="_blank" rel="noreferrer">
              <Button variant="outline"><ExternalLink className="mr-2 h-4 w-4" />Official source</Button>
            </a>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {record.assignedBusinessContexts.map((business) => (
            <span key={business} className="border border-primary/30 bg-primary/5 px-2 py-1 text-xs">{BUSINESS_LABELS[business]}</span>
          ))}
          <span className="border border-border px-2 py-1 text-xs">Relevance {record.relevanceScore}/100</span>
          <span className="border border-border px-2 py-1 text-xs">{record.closingWindow.replaceAll("_", " ")}</span>
        </div>
      </header>

      {message && <div className="mb-4 border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300">{message}</div>}
      {error && <div className="mb-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <Section title="Overview">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Issuer</dt><dd className="mt-1">{record.issuer || "Not published"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Opportunity type</dt><dd className="mt-1">{record.opportunityType || "Not classified by source"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Category</dt><dd className="mt-1">{record.category || "Not published"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Documented contract value</dt><dd className="mt-1">{record.documentedContractValue || "Not published"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Published</dt><dd className="mt-1">{formatDate(record.publishedDate)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Closing</dt><dd className="mt-1">{formatDate(record.normalizedCloseTimestamp)}</dd></div>
            </dl>
            {record.summary && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{record.summary}</p>}
          </Section>

          <Section title="Business relevance & capability matches">
            <div className="space-y-4">
              {record.businessFits.map((fit) => (
                <div key={fit.business} className="border-l-2 border-border pl-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">{fit.businessName}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{fit.score}/100 signal</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {fit.capabilityMatches.length
                      ? fit.capabilityMatches.map((item) => <span key={item} className="border border-border px-2 py-1 text-[10px]">{item}</span>)
                      : <span className="text-xs text-muted-foreground">No strong verified capability-language match.</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-xs font-medium">Score contributors</div>
              <div className="mt-2 space-y-2">
                {record.scoreFactors.map((factor) => (
                  <div key={factor.factor} className="grid gap-1 text-xs sm:grid-cols-[170px_70px_minmax(0,1fr)]">
                    <span>{factor.factor}</span>
                    <span className="font-mono">{factor.points}/{factor.maxPoints}</span>
                    <span className="text-muted-foreground">{factor.explanation}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">{record.relevanceExplanation}</p>
            </div>
          </Section>

          <Section title="Factual evidence">
            {factualEvidence.length ? (
              <div className="space-y-3">
                {factualEvidence.map((item, index) => (
                  <div key={index} className="border-l-2 border-primary/30 pl-3">
                    <div className="font-mono text-[9px] uppercase tracking-wide text-primary">{item.classification}</div>
                    <p className="mt-1 text-sm leading-5">{item.statement}</p>
                    {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline">Source <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No factual evidence items stored.</p>}
          </Section>

          <Section title="Commercial interpretation">
            {interpretation.length || record.commercialHypotheses.length ? (
              <div className="space-y-3">
                {interpretation.map((item, index) => (
                  <div key={"e-" + index} className="border-l-2 border-amber-500/40 pl-3">
                    <div className="font-mono text-[9px] uppercase tracking-wide text-amber-400">{item.classification}</div>
                    <p className="mt-1 text-sm">{item.statement}</p>
                  </div>
                ))}
                {record.commercialHypotheses.map((item, index) => (
                  <div key={"h-" + index} className="border-l-2 border-amber-500/40 pl-3">
                    <div className="font-mono text-[9px] uppercase tracking-wide text-amber-400">COMMERCIAL_HYPOTHESIS</div>
                    <p className="mt-1 text-sm">{item}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No commercial hypotheses have been generated from the verified evidence.</p>}
          </Section>

          <Section title="Source & document links">
            <div className="space-y-2 text-sm">
              <a href={record.canonicalSourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline"><ExternalLink className="h-4 w-4" />Canonical source</a>
              {record.tenderDocumentLinks.map((url, index) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline"><FileText className="h-4 w-4" />Tender document {index + 1}</a>
              ))}
              {!record.tenderDocumentLinks.length && <p className="text-xs text-muted-foreground">No direct document links were published in the retrievable source response.</p>}
            </div>
          </Section>

          <Section title="Change history">
            {record.materialChangeHistory.length ? (
              <div className="space-y-3">
                {[...record.materialChangeHistory].reverse().map((change, index) => (
                  <div key={index} className="grid gap-1 border-l-2 border-border pl-3 text-xs sm:grid-cols-[150px_150px_minmax(0,1fr)]">
                    <span className="text-muted-foreground">{formatDate(change.at)}</span>
                    <span className="font-medium">{change.field}</span>
                    <span className="break-words text-muted-foreground">{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No material changes have been detected since discovery.</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Key dates">
            <div className="space-y-3 text-sm">
              <div className="flex gap-2"><CalendarClock className="mt-0.5 h-4 w-4 text-primary" /><div><div className="text-xs text-muted-foreground">Published</div><div>{formatDate(record.publishedDate)}</div></div></div>
              <div className="flex gap-2"><CalendarClock className="mt-0.5 h-4 w-4 text-primary" /><div><div className="text-xs text-muted-foreground">Closing</div><div>{formatDate(record.normalizedCloseTimestamp)}</div><div className="text-[10px] text-muted-foreground">{record.timezone}</div></div></div>
              <div className="text-xs text-muted-foreground">First discovered {formatDate(record.firstDiscovered)}</div>
              <div className="text-xs text-muted-foreground">Last checked {formatDate(record.lastChecked)}</div>
            </div>
          </Section>

          <Section title="Risks / unknowns">
            {record.risksUnknowns.length ? (
              <ul className="space-y-2 text-sm">{record.risksUnknowns.map((item) => <li key={item}>• {item}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">No AI-derived risks are stored yet. Treat unpublished requirements as unknown.</p>}
          </Section>

          <Section title="Questions Brett should ask">
            {record.questionsToAsk.length ? (
              <ul className="space-y-2 text-sm">{record.questionsToAsk.map((item) => <li key={item}>• {item}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">No tender-specific questions have been generated yet.</p>}
          </Section>

          <Section title="Suggested next action">
            <p className="text-sm leading-6">{record.suggestedNextAction}</p>
            <Button className="mt-4 w-full" onClick={addApproval} disabled={queueing}>
              <ShieldCheck className="mr-2 h-4 w-4" />{queueing ? "Adding…" : "Send external action to Approval Queue"}
            </Button>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">This only creates an internal approval item. It does not contact the issuer or submit a response.</p>
          </Section>

          <Section title="Internal notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              className="w-full resize-y border border-input bg-background p-3 text-sm outline-none focus:border-primary"
              placeholder="Internal assessment, eligibility questions, bid notes…"
            />
            <Button variant="outline" className="mt-2 w-full" onClick={saveInternalNotes} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save notes"}
            </Button>
          </Section>

          <Section title="Source history">
            <div className="space-y-3">
              {record.sourceHistory.map((source, index) => (
                <div key={index} className="flex gap-2 text-xs">
                  <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div>
                    <div className="font-medium">{source.sourceName}</div>
                    <div className="text-muted-foreground">First seen {formatDate(source.firstSeen)}</div>
                    <div className="text-muted-foreground">Last seen {formatDate(source.lastSeen)} · {source.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {record.aiModelUsed && (
            <div className="border border-border bg-card p-3 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              Last AI enrichment: {record.aiModelUsed} · {formatDate(record.aiEnrichedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
