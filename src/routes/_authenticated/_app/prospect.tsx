import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Loader2, Mail, Plus, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/crm/shared";
import { useWorkspace } from "@/lib/workspace";
import { EMAIL_RE } from "@/lib/constants";
import { normalizeWebsite } from "@/lib/website";
import { friendlyError } from "@/lib/errors";
import {
  analyzeBusiness,
  discoverTargets,
  researchAndDraft,
  type Analysis,
  type ContactResult,
  type Target,
} from "@/lib/prospect/prospect.functions";

export const Route = createFileRoute("/_authenticated/_app/prospect")({
  head: () => ({
    meta: [
      { title: "Prospect finder — Pipeline" },
      { name: "description", content: "Analyze your website, discover matching companies and draft personalized outreach." },
      { property: "og:title", content: "Prospect finder — Pipeline" },
      { property: "og:description", content: "Analyze your website, discover matching companies and draft personalized outreach." },
    ],
  }),
  component: ProspectPage,
});

type Row = Target & {
  state: "queued" | "working" | "done" | "error";
  result?: ContactResult;
  error?: string;
  saved?: boolean;
};

const STORE = "pipeline.prospect.sender";

function ProspectPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeBusiness);
  const discover = useServerFn(discoverTargets);
  const research = useServerFn(researchAndDraft);

  const [name, setName] = useState("");
  const [email, setEmail] = useState(ws.email);
  const [website, setWebsite] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "discovering" | "researching" | "done">("idle");
  const [analysis, setAnalysis] = useState<{ website: string; analysis: Analysis } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (s.name) setName(s.name);
      if (s.email) setEmail(s.email);
      if (s.website) setWebsite(s.website);
    } catch {
      /* ignore */
    }
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", ws.userId)
      .maybeSingle()
      .then(({ data }) => data?.full_name && setName((n) => n || data.full_name!));
  }, [ws.userId]);

  const sender = { name: name.trim(), email: email.trim() };

  async function runResearch(targets: Target[], a: { website: string; analysis: Analysis }) {
    setPhase("researching");
    const queue = [...targets.keys()];
    const worker = async () => {
      for (;;) {
        const i = queue.shift();
        if (i === undefined) return;
        setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "working" } : x)));
        try {
          const result = await research({ data: { target: targets[i]!, analysis: a.analysis, website: a.website, sender } });
          setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "done", result } : x)));
        } catch (e) {
          setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
          if (/credits|busy/i.test((e as Error).message)) queue.length = 0;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setPhase("done");
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!sender.name) return setError("Enter your name.");
    if (!EMAIL_RE.test(sender.email)) return setError("Enter a valid email.");
    if (!normalizeWebsite(website)) return setError("Enter your website, like cadenceops.app");
    localStorage.setItem(STORE, JSON.stringify({ ...sender, website }));
    setRows([]);
    setAnalysis(null);
    try {
      setPhase("analyzing");
      const a = await analyze({ data: { website } });
      setAnalysis(a);
      setPhase("discovering");
      const { targets } = await discover({ data: { website: a.website, analysis: a.analysis, exclude: [] } });
      if (!targets.length) {
        setPhase("done");
        return setError("No live matching companies found this round. Try “Find more”.");
      }
      setRows(targets.map((t) => ({ ...t, state: "queued" })));
      await runResearch(targets, a);
    } catch (err) {
      setError((err as Error).message);
      setPhase(analysis ? "done" : "idle");
    }
  }

  async function findMore() {
    if (!analysis) return;
    setError(null);
    setPhase("discovering");
    try {
      const { targets } = await discover({
        data: { website: analysis.website, analysis: analysis.analysis, exclude: rows.map((r) => r.domain) },
      });
      if (!targets.length) {
        setPhase("done");
        return toast.message("No new companies found this round.");
      }
      const offset = rows.length;
      setRows((r) => [...r, ...targets.map((t) => ({ ...t, state: "queued" as const }))]);
      // Research only the new ones.
      setPhase("researching");
      const idx = targets.map((_, k) => offset + k);
      const worker = async () => {
        for (;;) {
          const i = idx.shift();
          if (i === undefined) return;
          const t = targets[i - offset]!;
          setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "working" } : x)));
          try {
            const result = await research({ data: { target: t, analysis: analysis.analysis, website: analysis.website, sender } });
            setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "done", result } : x)));
          } catch (e) {
            setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("done");
    }
  }

  async function retry(i: number) {
    if (!analysis) return;
    const t = rows[i]!;
    setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "working", error: undefined } : x)));
    try {
      const result = await research({ data: { target: t, analysis: analysis.analysis, website: analysis.website, sender } });
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "done", result } : x)));
    } catch (e) {
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
    }
  }

  function updateDraft(i: number, patch: Partial<ContactResult>) {
    setRows((r) => r.map((x, j) => (j === i && x.result ? { ...x, result: { ...x.result, ...patch } } : x)));
  }

  async function save(i: number) {
    const row = rows[i]!;
    const res = row.result!;
    const site = normalizeWebsite(row.domain);
    let companyId: string | null = null;
    if (site) {
      const { data } = await supabase.from("companies").select("id").eq("organization_id", ws.organizationId).eq("website", site).maybeSingle();
      companyId = data?.id ?? null;
    }
    if (!companyId) {
      const { data, error } = await supabase
        .from("companies")
        .insert({
          organization_id: ws.organizationId,
          name: row.name,
          website: site,
          industry: row.industry || null,
          country: row.country || null,
          employee_range: row.employee_range || null,
          status: "researching",
          notes: row.why_fit || null,
        })
        .select("id")
        .single();
      if (error) return toast.error(friendlyError(error));
      companyId = data.id;
    }
    let contactId: string | null = null;
    if (res.contact_name || res.email) {
      const { data, error } = await supabase
        .from("contacts")
        .insert({
          organization_id: ws.organizationId,
          company_id: companyId,
          full_name: res.contact_name ?? `${row.name} team`,
          job_title: res.contact_title,
          email: res.email,
          status: "new",
          notes: res.source_url ? `Found on ${res.source_url}` : null,
        })
        .select("id")
        .single();
      if (error) return toast.error(friendlyError(error));
      contactId = data.id;
    }
    const { error } = await supabase.from("activities").insert({
      organization_id: ws.organizationId,
      company_id: companyId,
      contact_id: contactId,
      type: "note",
      body: `Draft outreach\nSubject: ${res.subject}\n\n${res.body}`,
      created_by: ws.userId,
    });
    if (error) return toast.error(friendlyError(error));
    setRows((r) => r.map((x, j) => (j === i ? { ...x, saved: true } : x)));
    qc.invalidateQueries();
    toast.success(`${row.name} saved to your CRM`);
  }

  const busy = phase === "analyzing" || phase === "discovering" || phase === "researching";
  const doneCount = rows.filter((r) => r.state === "done").length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Prospect finder" sub="Your website in → matching companies, their decision-maker, and a ready-to-send email out." />

      <form onSubmit={start} className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Your name</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-email">Your email</Label>
          <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-site">Your business website</Label>
          <Input id="p-site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="cadenceops.app" />
        </div>
        <Button type="submit" disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Find prospects
        </Button>
      </form>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {phase !== "idle" && (
        <ol className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
          <Step label="1. Analyze website" state={phase === "analyzing" ? "active" : analysis ? "done" : "todo"} />
          <Step label="2. Discover companies" state={phase === "discovering" ? "active" : rows.length ? "done" : "todo"} />
          <Step
            label={`3. Find contacts & draft (${doneCount}/${rows.length})`}
            state={phase === "researching" ? "active" : phase === "done" && rows.length ? "done" : "todo"}
          />
        </ol>
      )}

      {phase === "analyzing" && <Skeleton className="mt-6 h-40" />}

      {analysis && (
        <section className="mt-6 rounded-lg border bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">What {analysis.analysis.business_name} is</div>
          <p className="mt-1 text-lg font-medium">{analysis.analysis.one_liner}</p>
          <p className="mt-2 text-sm text-muted-foreground">{analysis.analysis.what_it_does}</p>
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <Chips title="Ideal customers" items={analysis.analysis.ideal_customers} />
            <Chips title="Industries" items={analysis.analysis.target_industries} />
            <Chips title="Decision-makers" items={analysis.analysis.target_titles} />
          </div>
        </section>
      )}

      {phase === "discovering" && !rows.length && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {rows.length > 0 && (
        <section className="mt-6 space-y-4">
          {rows.map((r, i) => (
            <ProspectCard
              key={r.domain}
              row={r}
              onChange={(p) => updateDraft(i, p)}
              onSave={() => save(i)}
              onRetry={() => retry(i)}
            />
          ))}
          {phase === "done" && (
            <Button variant="outline" onClick={findMore} className="gap-2">
              <Plus className="h-4 w-4" /> Find more companies
            </Button>
          )}
        </section>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        Companies are suggested by AI and checked to have a live website. Contacts and emails come only from each company's public web pages. Nothing is
        sent from this app — review each email and send it from your own mail app. Follow local rules for cold outreach (e.g. GDPR/CAN-SPAM) and honor
        opt-out replies.
      </p>
    </div>
  );
}

function Step({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded px-2 py-1 ${
        state === "done" ? "bg-primary/15 text-primary" : state === "active" ? "bg-accent text-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      {state === "active" ? <Loader2 className="h-3 w-3 animate-spin" /> : state === "done" ? <Check className="h-3 w-3" /> : null}
      {label}
    </li>
  );
}

function Chips({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((x) => (
          <span key={x} className="rounded bg-muted px-2 py-0.5 text-xs">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProspectCard({
  row,
  onChange,
  onSave,
  onRetry,
}: {
  row: Row;
  onChange: (p: Partial<ContactResult>) => void;
  onSave: () => void;
  onRetry: () => void;
}) {
  const res = row.result;
  const mailto = res
    ? `mailto:${encodeURIComponent(res.email ?? "")}?subject=${encodeURIComponent(res.subject)}&body=${encodeURIComponent(res.body)}`
    : "#";

  async function copy() {
    if (!res) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${res.subject}\n\n${res.body}`);
      toast.success("Email copied");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  }

  return (
    <article className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {row.name}{" "}
            <a href={`https://${row.domain}`} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
              {row.domain} <ExternalLink className="h-3 w-3" />
            </a>
          </h3>
          <p className="text-xs text-muted-foreground">
            {[row.industry, row.country, row.employee_range && `${row.employee_range} people`].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-sm">{row.why_fit}</p>
        </div>
      </div>

      {(row.state === "queued" || row.state === "working") && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {row.state === "queued" ? "Waiting…" : "Reading their site and writing your email…"}
        </div>
      )}

      {row.state === "error" && (
        <div className="mt-4 flex items-center gap-3 text-sm text-destructive">
          {row.error}
          <Button size="sm" variant="outline" onClick={onRetry} className="gap-1">
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {res && row.state === "done" && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Point of contact</div>
              <div>{res.contact_name ? `${res.contact_name}${res.contact_title ? ` — ${res.contact_title}` : ""}` : "No named person on site"}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-muted-foreground">
                Email {res.email_type === "person" ? "(personal, from site)" : res.email_type === "generic" ? "(company inbox, from site)" : "(none published)"}
              </div>
              <Input
                value={res.email ?? ""}
                onChange={(e) => onChange({ email: e.target.value || null })}
                placeholder="Add an email"
                className="h-8 font-mono text-xs"
                aria-label={`Email for ${row.name}`}
              />
              {res.emails_found.length > 1 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {res.emails_found.slice(0, 6).map((e) => (
                    <button key={e} type="button" onClick={() => onChange({ email: e })} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent">
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Input value={res.subject} onChange={(e) => onChange({ subject: e.target.value })} aria-label="Subject" className="font-medium" />
          <Textarea value={res.body} onChange={(e) => onChange({ body: e.target.value })} rows={9} aria-label="Email body" className="text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button asChild className="gap-2">
              <a href={mailto}>
                <Mail className="h-4 w-4" /> Open in email app
              </a>
            </Button>
            <Button variant="outline" onClick={copy} className="gap-2">
              <Copy className="h-4 w-4" /> Copy
            </Button>
            <Button variant="ghost" onClick={onSave} disabled={row.saved} className="gap-2">
              {row.saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {row.saved ? "Saved to CRM" : "Save to CRM"}
            </Button>
            {res.source_url && (
              <a href={res.source_url} target="_blank" rel="noreferrer" className="self-center text-xs text-muted-foreground hover:text-primary">
                Source page
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
