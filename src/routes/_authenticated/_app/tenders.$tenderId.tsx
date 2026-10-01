import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ArrowLeft, ExternalLink, Save, Send, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { addApprovalItem } from "@/lib/spa/store.functions";
import {
  getTenderRecord,
  updateTenderNotes,
  updateTenderWorkflow,
} from "@/lib/spa/tender.functions";
import { classifyClosing, type TenderRecord, type TenderWorkflowStatus } from "@/lib/spa/tenders";

export const Route = createFileRoute("/_authenticated/_app/tenders/$tenderId")({
  head: () => ({ meta: [{ title: "Tender Detail — SPA Intelligence" }] }),
  component: TenderDetail,
});

const WORKFLOW_STATES: TenderWorkflowStatus[] = [
  "New", "Review", "Interested", "Pursue", "Bid / Response in progress",
  "Submitted", "Won", "Lost", "No bid", "Dismissed", "Expired",
];

const BUSINESS_LABEL: Record<string, string> = {
  spa: "Solar Power Australia",
  solaronline: "Solar Online",
  elmofo: "ELMOFO",
};

function fmt(value: string | null) {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(parsed));
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(parsed));
}

function TenderDetail() {
  const { tenderId } = Route.useParams();
  const getRecord = useServerFn(getTenderRecord);
  const setWorkflow = useServerFn(updateTenderWorkflow);
  const setNotes = useServerFn(updateTenderNotes);
  const queueApproval = useServerFn(addApprovalItem);

  const [record, setRecord] = useState<TenderRecord | null>(null);
  const [notes, setNotesValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalQueued, setApprovalQueued] = useState(false);

  useEffect(() => {
    void getRecord({ data: { id: tenderId } })
      .then((value) => {
        setRecord(value as TenderRecord);
        setNotesValue((value as TenderRecord).notes ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [tenderId]);

  async function changeStatus(workflowStatus: TenderWorkflowStatus) {
    if (!record) return;
    setError(null);
    try {
      setRecord(await setWorkflow({ data: { id: record.id, workflowStatus } }) as TenderRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveNotes() {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await setNotes({ data: { id: record.id, notes } }) as TenderRecord;
      setRecord(updated);
      setNotesValue(updated.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addToApprovalQueue() {
    if (!record) return;
    setQueueing(true);
    setError(null);
    try {
      await queueApproval({
        data: {
          title: `Tender decision · ${record.tenderTitle}`,
          kind: "tender-pursuit-decision",
          payload: {
            tenderId: record.id,
            referenceNumber: record.referenceNumber,
            issuer: record.issuer,
            sourceUrl: record.canonicalSourceUrl,
            workflowStatus: record.workflowStatus,
            relevanceScore: record.relevanceScore,
            suggestedNextAction: record.suggestedNextAction,
            externalActionGuard: "No submission, email, issuer contact or commercial commitment is authorised by this queue item.",
          },
        },
      });
      setApprovalQueued(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueing(false);
    }
  }

  if (error && !record) return <div className="mx-auto max-w-5xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">{error}</div>;
  if (!record) return <div className="mx-auto max-w-5xl p-8 text-center text-sm text-muted-foreground">Loading tender intelligence…</div>;

  const closingBand = classifyClosing(record.normalizedCloseTimestamp);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <Link to="/tenders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Tender Intelligence
        </Link>
      </div>

      <header className="mb-6 border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Tender intelligence / canonical record</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{record.tenderTitle}</h1>
            <div className="mt-2 text-sm text-muted-foreground">
              {record.issuer} {record.referenceNumber ? `· ${record.referenceNumber}` : ""}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {record.assignedBusinessContexts.map((context) => (
                <span key={context} className="border border-primary/30 bg-primary/5 px-2 py-1 text-xs">
                  {BUSINESS_LABEL[context]}
                </span>
              ))}
              {!record.assignedBusinessContexts.length && (
                <span className="border border-border px-2 py-1 text-xs text-muted-foreground">No supported business assignment</span>
              )}
            </div>
          </div>
          <div className="w-full border border-border bg-card p-4 sm:w-64">
            <div className="font-mono text-[9px] uppercase text-muted-foreground">Workflow status</div>
            <select
              value={record.workflowStatus}
              onChange={(e) => void changeStatus(e.target.value as TenderWorkflowStatus)}
              className="mt-2 h-10 w-full border border-input bg-background px-2 text-sm"
            >
              {WORKFLOW_STATES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <Button variant="outline" className="mt-3 w-full" onClick={addToApprovalQueue} disabled={queueing || approvalQueued}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              {approvalQueued ? "Queued for approval" : queueing ? "Queueing…" : "Add decision to Approval Queue"}
            </Button>
          </div>
        </div>
      </header>

      {error && <div className="mb-5 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <div className="space-y-5">
          <section className="border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Overview</div>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {[
                ["Issuer", record.issuer],
                ["Opportunity type", record.opportunityType],
                ["Category", record.category || "Not confirmed"],
                ["Location", record.location || record.state || "Not confirmed"],
                ["Published", fmt(record.publishedDate)],
                ["Closing", fmt(record.normalizedCloseTimestamp)],
                ["Closing band", closingBand.replaceAll("_", " ")],
                ["Documented value", record.documentedContractValue || "Not published in retrieved evidence"],
                ["Source status", record.sourceStatus],
                ["First discovered", fmt(record.firstDiscovered)],
                ["Last checked", fmt(record.lastChecked)],
                ["Retrieval", record.retrievalMethod === "cached" ? `Dated official-source snapshot · ${fmt(record.sourceRetrievedAt ?? null)}` : record.retrievalMethod === "search" ? "Indexed official-source search" : "Direct official source"],
                ["AI enrichment", record.enrichmentModel ? `${record.enrichmentModel} · ${fmt(record.enrichedAt)}` : "Not run / not required"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="font-mono text-[9px] uppercase text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm">{value}</div>
                </div>
              ))}
            </div>
            {record.summary && <div className="border-t border-border p-4 text-sm leading-6 text-muted-foreground">{record.summary}</div>}
          </section>

          <section className="border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Business relevance</div>
            </div>
            <div className="divide-y divide-border">
              {record.businessFits.map((fit) => (
                <div key={fit.business} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{fit.name}</div>
                    <div className="font-mono text-sm">{fit.score}/100 context fit</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {fit.matchedCapabilities.map((capability) => (
                      <span key={capability} className="border border-primary/25 bg-primary/5 px-2 py-1 text-[10px]">{capability}</span>
                    ))}
                    {!fit.matchedCapabilities.length && <span className="text-xs text-muted-foreground">No evidence-backed capability match.</span>}
                  </div>
                  {!!fit.reasons.length && (
                    <ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                      {fit.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Factual evidence & interpretation</div>
            </div>
            <div className="divide-y divide-border">
              {record.evidence.map((item, index) => (
                <div key={index} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{item.classification}</span>
                    {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-primary">source<ExternalLink className="h-3 w-3" /></a>}
                  </div>
                  <div className="mt-2 text-sm leading-6">{item.statement}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            <div className="border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Commercial hypotheses</div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {record.commercialHypotheses.length
                  ? record.commercialHypotheses.map((item) => <li key={item}>• {item}</li>)
                  : <li>No AI commercial hypotheses recorded.</li>}
              </ul>
            </div>
            <div className="border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Risks / unknowns</div>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {record.risksUnknowns.length
                  ? record.risksUnknowns.map((item) => <li key={item}>• {item}</li>)
                  : <li>No unresolved risk items recorded.</li>}
              </ul>
            </div>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Questions Brett should ask</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {record.questionsToAsk.length
                ? record.questionsToAsk.map((item) => <li key={item}>• {item}</li>)
                : <li>Review the official tender documents first. Questions are not generated when the evidence does not support them.</li>}
            </ul>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Internal notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={7}
              placeholder="Internal tender notes…"
              className="mt-3 w-full resize-y border border-input bg-background p-3 text-sm outline-none focus:border-primary"
            />
            <Button className="mt-3" onClick={saveNotes} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save notes"}
            </Button>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border border-primary/25 bg-primary/5 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Opportunity fit</div>
            <div className="mt-2 text-5xl font-semibold">{record.relevanceScore}</div>
            <div className="mt-1 text-xs text-muted-foreground">relevance fit / 100, not win probability</div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{record.relevanceExplanation}</p>
            <div className="mt-4 space-y-3">
              {record.scoreFactors.map((factor) => (
                <div key={factor.factor}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span>{factor.factor}</span><span className="font-mono">{factor.score}/{factor.max}</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{factor.explanation}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Suggested next action</div>
            <p className="mt-3 text-sm leading-6">{record.suggestedNextAction}</p>
            <div className="mt-3 border-l-2 border-amber-500/50 pl-3 text-xs leading-5 text-amber-200">
              SPA Intelligence does not submit tenders, send emails, contact issuers or make commercial commitments automatically.
            </div>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Sources & documents</div>
            {record.retrievalMethod === "cached" && <p className="mt-3 text-xs leading-5 text-amber-300">Live refresh was unavailable. This record comes from an official-source snapshot retrieved {fmt(record.sourceRetrievedAt ?? null)}. Confirm current availability at the official source.</p>}
            <a href={record.canonicalSourceUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 text-sm text-primary hover:underline">
              <ExternalLink className="h-4 w-4" />Open canonical source
            </a>
            {record.tenderDocumentLinks.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-xs text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />Tender document
              </a>
            ))}
            {!record.tenderDocumentLinks.length && <div className="mt-3 text-xs text-muted-foreground">No document links were safely extracted from the public index.</div>}
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Source history</div>
            <div className="mt-3 space-y-3">
              {record.sourceHistory.map((source) => (
                <div key={source.sourceName + source.sourceSpecificId} className="text-xs">
                  <div className="font-medium">{source.sourceName}</div>
                  <div className="mt-1 text-muted-foreground">{source.sourceSpecificId}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">First {fmt(source.firstSeenAt)} · Last {fmt(source.lastSeenAt)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Material-change history</div>
            <div className="mt-3 space-y-4">
              {record.materialChangeHistory.length
                ? record.materialChangeHistory.map((change, index) => (
                    <div key={index} className="border-l border-border pl-3 text-xs">
                      <div className="font-medium">{change.field}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{fmt(change.at)} · {change.sourceName}</div>
                      <div className="mt-1 break-words text-muted-foreground">Before: {JSON.stringify(change.before)}</div>
                      <div className="mt-1 break-words">After: {JSON.stringify(change.after)}</div>
                    </div>
                  ))
                : <div className="text-xs text-muted-foreground">No material source changes detected yet.</div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
