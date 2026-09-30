import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/crm/shared";
import { useWorkspace } from "@/lib/workspace";
import type { EvidenceItem, OpportunitySignal, OutreachStep } from "@/lib/prospect/prospect.functions";

export const Route = createFileRoute("/_authenticated/_app/prospects")({
  head: () => ({
    meta: [
      { title: "Prospect intelligence — Prospect Finder B2B" },
      { name: "description", content: "Persistent prospect dossiers, opportunity signals, outreach and outcomes." },
    ],
  }),
  component: ProspectIntelligencePage,
});

type Dossier = {
  id: string;
  organization_id: string;
  domain: string;
  company_name: string;
  sender_website: string;
  industry: string | null;
  country: string | null;
  employee_range: string | null;
  why_fit: string | null;
  opportunity_score: number;
  qualification_summary: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  email_type: string;
  source_url: string | null;
  evidence_map: EvidenceItem[];
  trigger_signals: OpportunitySignal[];
  outreach_sequence: OutreachStep[];
  subject: string;
  body: string;
  stage: string;
  outcome: string;
  company_id: string | null;
  contact_id: string | null;
  last_researched_at: string;
  updated_at: string;
  created_at: string;
};

const STAGES = ["researched", "crm", "contacted", "follow_up", "replied", "qualified", "customer", "closed"] as const;
const OUTCOMES = ["unknown", "no_reply", "replied", "interested", "not_relevant", "customer"] as const;

function ProspectIntelligencePage() {
  const ws = useWorkspace();
  const [rows, setRows] = useState<Dossier[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await renderDb
      .from("prospect_dossiers")
      .select("*")
      .eq("organization_id", ws.organizationId)
      .order("opportunity_score", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Dossier[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [ws.organizationId]);

  async function patch(id: string, values: Partial<Dossier>) {
    const next = { ...values, updated_at: new Date().toISOString() };
    const { error } = await renderDb.from("prospect_dossiers").update(next).eq("id", id);
    if (error) return toast.error(error.message);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stage !== "all" && row.stage !== stage) return false;
      if (!needle) return true;
      return [row.company_name, row.domain, row.industry, row.country, row.contact_name, row.contact_email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, stage]);

  const hot = rows.filter((r) => r.opportunity_score >= 70).length;
  const replied = rows.filter((r) => ["replied", "interested", "customer"].includes(r.outcome)).length;
  const customers = rows.filter((r) => r.outcome === "customer" || r.stage === "customer").length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Prospect intelligence"
        sub="Persistent dossiers: evidence, timing signals, decision-makers, outreach sequence and real outcomes."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Metric label="researched" value={rows.length} />
        <Metric label="score 70+" value={hot} />
        <Metric label="positive replies" value={replied} />
        <Metric label="customers" value={customers} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, domain, contact…" className="max-w-sm" />
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGES.map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void load()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading dossiers…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No dossiers match this view. Research prospects first and they will appear here automatically.
        </div>
      ) : (
        <section className="space-y-4">
          {filtered.map((row) => <DossierCard key={row.id} row={row} onPatch={(values) => patch(row.id, values)} />)}
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="font-mono text-2xl font-semibold text-primary">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function DossierCard({ row, onPatch }: { row: Dossier; onPatch: (values: Partial<Dossier>) => Promise<void> }) {
  const mailto = `mailto:${encodeURIComponent(row.contact_email ?? "")}?subject=${encodeURIComponent(row.subject)}&body=${encodeURIComponent(row.body)}`;

  async function copyInitial() {
    try {
      await navigator.clipboard.writeText(`Subject: ${row.subject}\n\n${row.body}`);
      toast.success("Initial outreach copied");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  }

  return (
    <article className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{row.company_name}</h2>
            <a href={`https://${row.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
              {row.domain} <ExternalLink className="h-3 w-3" />
            </a>
            {row.company_id && <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">in CRM</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {[row.industry, row.country, row.employee_range && `${row.employee_range} people`].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-sm">{row.qualification_summary || row.why_fit}</p>
        </div>
        <div className="rounded-md bg-primary/10 px-4 py-2 text-center">
          <div className="font-mono text-2xl font-semibold text-primary">{row.opportunity_score}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">score / 100</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">Decision-maker</div>
          <div className="text-sm">{row.contact_name || "No named contact"}{row.contact_title ? ` · ${row.contact_title}` : ""}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.contact_email || "No published email"}</div>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Stage</div>
          <Select value={row.stage} onValueChange={(value) => void onPatch({ stage: value })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Outcome</div>
          <Select value={row.outcome} onValueChange={(value) => void onPatch({ outcome: value })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{OUTCOMES.map((value) => <SelectItem key={value} value={value}>{pretty(value)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {(row.trigger_signals?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-md border bg-background/40 p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Why now</div>
          <ul className="mt-2 space-y-1.5">
            {row.trigger_signals.map((signal, index) => (
              <li key={index} className="text-sm">
                <a href={signal.source_url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">{signal.signal}</a>
                <span className="text-muted-foreground"> · {signal.why_now} · {signal.confidence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-3 rounded-md border bg-background/40 p-3">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Evidence dossier · {row.evidence_map?.length ?? 0} signals
        </summary>
        <div className="mt-3 space-y-2">
          {(row.evidence_map ?? []).map((item, index) => (
            <div key={index} className="border-l-2 border-primary/40 pl-3 text-sm">
              <div className="text-[11px] text-muted-foreground">{item.classification} · {item.confidence} confidence · {item.capability_status}</div>
              <p>{item.observed_fact}</p>
              <p className="text-xs text-muted-foreground">→ {item.likely_operational_friction}{item.consequence ? ` · ${item.consequence}` : ""}</p>
            </div>
          ))}
        </div>
      </details>

      {(row.outreach_sequence?.length ?? 0) > 0 && (
        <details className="mt-3 rounded-md border bg-background/40 p-3">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Follow-up sequence · {row.outreach_sequence.length} drafts
          </summary>
          <div className="mt-3 space-y-3">
            {row.outreach_sequence.map((step) => (
              <div key={step.step} className="rounded bg-muted/50 p-3">
                <div className="text-xs font-medium">Step {step.step} · day {step.delay_days} · {step.angle}</div>
                <div className="mt-1 text-sm font-medium">{step.subject}</div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {row.contact_email ? (
          <Button asChild className="gap-2"><a href={mailto}><Mail className="h-4 w-4" /> Open initial email</a></Button>
        ) : (
          <Button disabled className="gap-2"><Mail className="h-4 w-4" /> No email published</Button>
        )}
        <Button variant="outline" onClick={copyInitial} className="gap-2"><Copy className="h-4 w-4" /> Copy initial</Button>
        {row.source_url && (
          <a href={row.source_url} target="_blank" rel="noreferrer" className="self-center text-xs text-muted-foreground hover:text-primary">Primary source</a>
        )}
        <span className="ml-auto self-center text-[11px] text-muted-foreground">researched {formatDate(row.last_researched_at)}</span>
      </div>
    </article>
  );
}

function pretty(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function formatDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleDateString();
}
