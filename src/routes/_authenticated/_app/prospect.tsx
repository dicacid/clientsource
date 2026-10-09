import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Loader2, Mail, Plus, RefreshCw, Sparkles } from "lucide-react";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/crm/shared";
import { NameResearchPanel } from "@/components/crm/NameResearchPanel";
import { researchBusinessByName, type NamedBusinessResearch } from "@/lib/prospect/named-research.functions";
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
  type EvidenceItem,
  type Target,
} from "@/lib/prospect/prospect.functions";

export const Route = createFileRoute("/_authenticated/_app/prospect")({
  head: () => ({
    meta: [
      { title: "Prospect finder — Prospect Finder B2B" },
      { name: "description", content: "Analyze your website, discover matching companies and draft personalized outreach." },
      { property: "og:title", content: "Prospect finder — Prospect Finder B2B" },
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
const CLAIMS_STORE = "pipeline.prospect.claims";
// The open-source build intentionally ships with no business-specific defaults.
const DEFAULT_CLAIMS: Record<string, string> = {};
const claimKey = (site: string) => normalizeWebsite(site)?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
function readClaims(userId: string): Record<string, string> {
  try {
    return { ...DEFAULT_CLAIMS, ...JSON.parse((userId === "guest" ? sessionStorage : localStorage).getItem(`${CLAIMS_STORE}.${userId}`) ?? "{}") };
  } catch {
    return { ...DEFAULT_CLAIMS };
  }
}

function ProspectPage() {
  const ws = useWorkspace();
  const guest = ws.userId === "guest";
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeBusiness);
  const researchName = useServerFn(researchBusinessByName);
  const discover = useServerFn(discoverTargets);
  const research = useServerFn(researchAndDraft);

  const [name, setName] = useState("");
  const [email, setEmail] = useState(ws.email);
  const [website, setWebsite] = useState("");
  const [useWebsiteMode, setUseWebsiteMode] = useState(false);
  const [businessQuery, setBusinessQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [namedResult, setNamedResult] = useState<NamedBusinessResearch | null>(null);
  const [industryQuery, setIndustryQuery] = useState("");
  const [includeCompetitors, setIncludeCompetitors] = useState(true);
  const [region, setRegion] = useState<"domestic" | "international" | "both">("domestic");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "discovering" | "researching" | "done">("idle");
  const [analysis, setAnalysis] = useState<{ website: string; analysis: Analysis } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [claims, setClaims] = useState("");
  const runId = useRef(0);
  const domainKey = claimKey(website);

  // Load only this sender domain's approved claims (or blank) whenever the domain changes.
  useEffect(() => {
    setClaims(domainKey ? (readClaims(ws.userId)[domainKey] ?? "") : "");
  }, [domainKey, ws.userId]);

  function changeClaims(v: string) {
    setClaims(v);
    if (!domainKey) return;
    (guest ? sessionStorage : localStorage).setItem(`${CLAIMS_STORE}.${ws.userId}`, JSON.stringify({ ...readClaims(ws.userId), [domainKey]: v }));
  }

  useEffect(() => {
    try {
      const s = JSON.parse((guest ? sessionStorage : localStorage).getItem(`${STORE}.${ws.userId}`) ?? "{}");
      if (s.name) setName(s.name);
      if (s.email) setEmail(s.email);
      if (s.website) setWebsite(s.website);
      if (typeof s.businessQuery === "string") setBusinessQuery(s.businessQuery);
      if (typeof s.locationQuery === "string") setLocationQuery(s.locationQuery);
      if (typeof s.industryQuery === "string") setIndustryQuery(s.industryQuery);
      if (typeof s.includeCompetitors === "boolean") setIncludeCompetitors(s.includeCompetitors);
      if (s.region === "domestic" || s.region === "international" || s.region === "both") setRegion(s.region);
    } catch {
      /* ignore */
    }
    if (guest) return;
    renderDb
      .from("profiles")
      .select("full_name")
      .eq("id", ws.userId)
      .maybeSingle()
      .then(({ data }) => data?.full_name && setName((n) => n || data.full_name!));
  }, [ws.userId, guest]);

  const sender = { name: name.trim(), email: email.trim() };

  async function persistDossier(target: Target, result: ContactResult, senderWebsite: string) {
    // Authenticated users save on the server; guests save only in their own browser tab.
    const now = new Date().toISOString();
    const base = {
      company_name: target.name,
      sender_website: senderWebsite,
      industry: target.industry || null,
      country: target.country || null,
      employee_range: target.employee_range || null,
      why_fit: target.why_fit || null,
      opportunity_score: result.opportunity_score,
      qualification_summary: result.qualification_summary,
      contact_name: result.contact_name,
      contact_title: result.contact_title,
      contact_email: result.email,
      email_type: result.email_type,
      source_url: result.source_url,
      evidence_map: result.evidence_map,
      trigger_signals: result.trigger_signals,
      outreach_sequence: result.outreach_sequence,
      subject: result.subject,
      body: result.body,
      last_researched_at: now,
      updated_at: now,
    };
    const { data: existing, error: readError } = await renderDb
      .from("prospect_dossiers")
      .select("id")
      .eq("organization_id", ws.organizationId)
      .eq("domain", target.domain)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing?.id) {
      const { error } = await renderDb.from("prospect_dossiers").update(base).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return existing.id as string;
    }
    const { data, error } = await renderDb
      .from("prospect_dossiers")
      .insert({
        organization_id: ws.organizationId,
        domain: target.domain,
        ...base,
        stage: "researched",
        outcome: "unknown",
        company_id: null,
        contact_id: null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  async function runResearch(targets: Target[], a: { website: string; analysis: Analysis }) {
    const id = runId.current;
    setPhase("researching");
    const queue = [...targets.keys()];
    const worker = async () => {
      for (;;) {
        const i = queue.shift();
        if (i === undefined || id !== runId.current) return;
        setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "working" } : x)));
        try {
          const result = await research({ data: { target: targets[i]!, analysis: a.analysis, website: a.website, sender, approved_claims: claims } });
          if (id !== runId.current) return;
          await persistDossier(targets[i]!, result, a.website);
          setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "done", result } : x)));
        } catch (e) {
          setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
          if (/credits|busy/i.test((e as Error).message)) queue.length = 0;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (id === runId.current) setPhase("done");
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const hasSite = useWebsiteMode;
    if (hasSite && !normalizeWebsite(website)) return setError("Enter a valid website or leave the field blank.");
    if (!hasSite && !businessQuery.trim()) return setError("Enter a business name to search without a website.");
    if (hasSite && !sender.name) return setError("Enter your name for the outreach workflow.");
    if (hasSite && !EMAIL_RE.test(sender.email)) return setError("Enter a valid email for the outreach workflow.");
    (guest ? sessionStorage : localStorage).setItem(`${STORE}.${ws.userId}`, JSON.stringify({ ...sender, website, businessQuery, locationQuery, industryQuery, includeCompetitors, region }));
    // Start each run cleanly. Name-only research does not require a sender or a website.
    const id = ++runId.current;
    setRows([]);
    setAnalysis(null);
    setNamedResult(null);
    try {
      setPhase("analyzing");
      if (!hasSite) {
        const result = await researchName({
          data: {
            business_name: businessQuery.trim(),
            location: locationQuery.trim(),
            industry: industryQuery.trim(),
            region,
            include_competitors: includeCompetitors,
          },
        });
        if (id !== runId.current) return;
        setNamedResult(result);
        setPhase("done");
        return;
      }
      const a = await analyze({ data: { website } });
      if (id !== runId.current) return;
      setAnalysis(a);
      setPhase("discovering");
      const { targets } = await discover({ data: { website: a.website, analysis: a.analysis, exclude: [], region, business_query: businessQuery.trim(), industry_query: industryQuery.trim(), include_competitors: includeCompetitors } });
      if (id !== runId.current) return;
      if (!targets.length) {
        setPhase("done");
        return setError("No live matching companies found this round. Try “Find more”.");
      }
      setRows(targets.map((t) => ({ ...t, state: "queued" })));
      await runResearch(targets, a);
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }

  async function findMore() {
    if (!analysis) return;
    setError(null);
    setPhase("discovering");
    try {
      const { targets } = await discover({
        data: { website: analysis.website, analysis: analysis.analysis, exclude: rows.map((r) => r.domain), region, business_query: businessQuery.trim(), industry_query: industryQuery.trim(), include_competitors: includeCompetitors },
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
            const result = await research({ data: { target: t, analysis: analysis.analysis, website: analysis.website, sender, approved_claims: claims } });
            await persistDossier(t, result, analysis.website);
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
      const result = await research({ data: { target: t, analysis: analysis.analysis, website: analysis.website, sender, approved_claims: claims } });
      await persistDossier(t, result, analysis.website);
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "done", result } : x)));
    } catch (e) {
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "error", error: (e as Error).message } : x)));
    }
  }

  function updateDraft(i: number, patch: Partial<ContactResult>) {
    const current = rows[i];
    if (!current?.result) return;
    const next = { ...current.result, ...patch };
    setRows((r) => r.map((x, j) => (j === i ? { ...x, result: next } : x)));
    void persistDossier(current, next, analysis?.website ?? normalizeWebsite(website) ?? website).catch(() => undefined);
  }

  async function save(i: number) {
    const row = rows[i]!;
    const res = row.result!;
    const site = normalizeWebsite(row.domain);
    let companyId: string | null = null;
    if (site) {
      const { data } = await renderDb.from("companies").select("id").eq("organization_id", ws.organizationId).eq("website", site).maybeSingle();
      companyId = data?.id ?? null;
    }
    if (!companyId) {
      const { data, error } = await renderDb
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
      const { data, error } = await renderDb
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
    const { error } = await renderDb.from("activities").insert({
      organization_id: ws.organizationId,
      company_id: companyId,
      contact_id: contactId,
      type: "note",
      body: `Opportunity score: ${res.opportunity_score}/100\n${res.qualification_summary}\n\nDraft outreach\nSubject: ${res.subject}\n\n${res.body}`,
      created_by: ws.userId,
    });
    if (error) return toast.error(friendlyError(error));
    await renderDb
      .from("prospect_dossiers")
      .update({ stage: "crm", company_id: companyId, contact_id: contactId, updated_at: new Date().toISOString() })
      .eq("organization_id", ws.organizationId)
      .eq("domain", row.domain);
    setRows((r) => r.map((x, j) => (j === i ? { ...x, saved: true } : x)));
    qc.invalidateQueries();
    toast.success(`${row.name} saved to your CRM`);
  }

  const busy = phase === "analyzing" || phase === "discovering" || phase === "researching";
  const doneCount = rows.filter((r) => r.state === "done").length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Free business research" sub="No account, signup or website required. Research a business, find possible competitors, or analyse your website to discover prospects." />


      <form onSubmit={start} className="grid gap-5 rounded-lg border bg-card p-5 md:grid-cols-2 xl:grid-cols-4">
        <p className="text-sm text-muted-foreground md:col-span-2 xl:col-span-4">Enter a business name to look for public information and competitors. No website or contact details needed.</p>
        <div className="space-y-1.5">
          <Label htmlFor="p-business-query">Business to research (name)</Label>
          <Input id="p-business-query" value={businessQuery} onChange={(e) => setBusinessQuery(e.target.value)} placeholder="e.g. Butlers Events Hire" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-location-query">Town, suburb or location (optional)</Label>
          <Input id="p-location-query" value={locationQuery} onChange={(e) => setLocationQuery(e.target.value)} placeholder="e.g. Cardiff NSW" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-industry-query">Industry (optional)</Label>
          <Input id="p-industry-query" value={industryQuery} onChange={(e) => setIndustryQuery(e.target.value)} placeholder="e.g. mining, logistics, agriculture" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-region">Target region</Label>
          <Select value={region} onValueChange={(v) => setRegion(v as typeof region)}>
            <SelectTrigger id="p-region" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground focus:ring-2 focus:ring-primary/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="domestic">Domestic (Australia)</SelectItem>
              <SelectItem value="international">International</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-start gap-3 border bg-muted/20 p-3 md:col-span-2 xl:col-span-4">
          <input type="checkbox" checked={includeCompetitors} onChange={(e) => setIncludeCompetitors(e.target.checked)} className="mt-1 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium">Include competitors and peer companies</span>
            <span className="block text-xs text-muted-foreground">For name-only research, look for comparable companies in the selected location and industry. Each result links to a public source.</span>
          </span>
        </label>

        <details className="min-w-0 rounded-md border bg-muted/10 p-3 md:col-span-2 xl:col-span-4">
          <summary className="cursor-pointer text-sm font-medium">Optional: use your own website to discover customers and draft outreach</summary>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={useWebsiteMode} onChange={(e) => setUseWebsiteMode(e.target.checked)} className="h-4 w-4" /> Use my website for prospect outreach</label>
          <p className="mt-2 text-xs text-muted-foreground">Enable the checkbox to switch workflows. If it is off, the search uses the business name above even if an old website is saved here.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Your name (for outreach)</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-email">Your email (for outreach)</Label>
          <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-site">Your own business website (for outreach)</Label>
          <Input id="p-site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" className="h-11 min-w-0 border-border/90 bg-background/70 px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30" />
        </div>

          </div>
          {useWebsiteMode && website.trim() && (
            <div className="mt-4">
        <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
          <Label htmlFor="p-claims">Approved campaign claims (optional)</Label>
          <Textarea
            id="p-claims"
            value={claims}
            onChange={(e) => changeClaims(e.target.value)}
            rows={4}
            placeholder="One approved claim per line"
            disabled={!domainKey}
            className="min-h-[108px] resize-y border-border/90 bg-background/70 px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <p className="text-xs text-muted-foreground">
            Facts you personally approve for this sender, e.g. runs alongside existing tools; setup takes about five minutes. Saved for {domainKey || "this website"} only.
          </p>
        </div>

            </div>
          )}
        </details>
        <Button type="submit" disabled={busy} className="h-11 w-full gap-2 md:col-start-2 md:w-auto md:justify-self-end xl:col-start-4">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {!useWebsiteMode ? "Research business" : businessQuery.trim() || industryQuery.trim() ? "Search market" : "Find prospects"}
        </Button>
      </form>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {namedResult && <NameResearchPanel result={namedResult} />}

      {phase !== "idle" && !namedResult && (
        <ol className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
          <Step label={useWebsiteMode ? "1. Analyze website" : "1. Search public sources"} state={phase === "analyzing" ? "active" : analysis ? "done" : "todo"} />
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
          {(analysis.analysis.capability_status?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs text-muted-foreground">Capabilities (from site)</div>
              <div className="flex flex-wrap gap-1">
                {analysis.analysis.capability_status.map((c) => (
                  <span key={c.capability} title={c.evidence} className="rounded bg-muted px-2 py-0.5 text-xs">
                    {c.capability} <span className="text-muted-foreground">· {c.status}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            {(analysis.analysis.pricing_summary?.length ?? 0) > 0 && <Chips title="Pricing" items={analysis.analysis.pricing_summary} />}
            {(analysis.analysis.differentiators?.length ?? 0) > 0 && <Chips title="Differentiators" items={analysis.analysis.differentiators} />}
            {(analysis.analysis.proof_points?.length ?? 0) > 0 && <Chips title="Proof points" items={analysis.analysis.proof_points} />}
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
        Website-based outreach checks suggested company websites and saves dossiers to your workspace. Business-name research uses public search listings, allows a blank website and saves selected companies to your workspace. Guest data remains in this browser tab. Competitor relationships are leads until verified. Nothing is
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

function PainMap({ items, pages }: { items: EvidenceItem[]; pages: number }) {
  return (
    <details className="rounded-md border bg-background/40 p-3" open>
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Why this company / Pain map <span className="normal-case tracking-normal">· {items.length} signals from {pages} pages</span>
      </summary>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No grounded evidence found on their public pages — treat this draft with care.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((e, i) => (
            <li key={i} className={`border-l-2 pl-3 text-sm ${e.selected ? "border-primary" : e.confidence === "high" ? "border-primary/40" : "border-border opacity-80"}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {e.selected && <span className="rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground">Used in email</span>}
                <span className={`rounded px-1.5 py-0.5 font-medium ${e.classification === "FACT" ? "bg-primary/15 text-primary" : "bg-accent text-foreground"}`}>
                  {e.classification}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{e.confidence} confidence</span>
                <a href={e.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">
                  {e.source_url.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1">{e.observed_fact}</p>
              <p className="text-xs text-muted-foreground">
                → {e.likely_operational_friction}
                {e.consequence && ` — ${e.consequence}`}
              </p>
              {e.matched_sender_capability && e.matched_sender_capability.toLowerCase() !== "none" && (
                <p className="text-xs">
                  Matches: <span className="font-medium">{e.matched_sender_capability}</span>{" "}
                  <span className="text-muted-foreground">({e.capability_status})</span>
                  {e.role_relevance && <span className="text-muted-foreground"> · {e.role_relevance}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
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
  onSave?: () => void;
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
          <div className="rounded-md border bg-background/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Opportunity intelligence</div>
                <p className="mt-1 text-sm">{res.qualification_summary || "Qualified from the grounded evidence below."}</p>
              </div>
              <div className="rounded-md bg-primary/10 px-3 py-2 text-center">
                <div className="font-mono text-2xl font-semibold text-primary">{res.opportunity_score}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">score / 100</div>
              </div>
            </div>
            {(res.trigger_signals?.length ?? 0) > 0 && (
              <div className="mt-3">
                <div className="text-xs text-muted-foreground">Why now</div>
                <ul className="mt-1 space-y-1.5">
                  {res.trigger_signals.map((t, j) => (
                    <li key={j} className="text-sm">
                      <a href={t.source_url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">
                        {t.signal}
                      </a>
                      <span className="text-muted-foreground"> · {t.why_now} · {t.confidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <PainMap items={res.evidence_map ?? []} pages={res.pages_read?.length ?? 0} />
          {(res.outreach_sequence?.length ?? 0) > 0 && (
            <details className="rounded-md border bg-background/40 p-3">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Follow-up sequence · {res.outreach_sequence.length} drafts
              </summary>
              <div className="mt-3 space-y-3">
                {res.outreach_sequence.map((step) => (
                  <div key={step.step} className="rounded-md bg-muted/50 p-3">
                    <div className="text-xs font-medium">Step {step.step} · day {step.delay_days} · {step.angle || "alternate grounded angle"}</div>
                    <div className="mt-1 text-sm font-medium">{step.subject}</div>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{step.body}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
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
            {onSave && <Button variant="ghost" onClick={onSave} disabled={row.saved} className="gap-2">
              {row.saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {row.saved ? "Saved to CRM" : "Save to CRM"}
            </Button>}
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
