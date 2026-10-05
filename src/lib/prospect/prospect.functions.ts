import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { prospectFeedbackForOrganization } from "@/integrations/render/state.server";
import { aiJson, AiError } from "./ai.server";
import { extractEmails, extractLinks, fetchPage, fetchText, hostOf, htmlToText, pageMeta, rankedLinks } from "./web.server";

export type Analysis = {
  business_name: string;
  one_liner: string;
  what_it_does: string;
  value_proposition: string;
  ideal_customers: string[];
  target_industries: string[];
  target_titles: string[];
  pain_points: string[];
  differentiators: string[];
  pricing_summary: string[];
  capability_status: CapabilityStatus[];
  proof_points: string[];
};

export type CapabilityStatus = {
  capability: string;
  status: "live" | "preview" | "planned" | "unclear";
  evidence: string;
};

export type EvidenceItem = {
  observed_fact: string;
  source_url: string;
  likely_operational_friction: string;
  classification: "FACT" | "INFERENCE";
  consequence: string;
  role_relevance: string;
  matched_sender_capability: string;
  capability_status: "live" | "preview" | "planned" | "unclear";
  confidence: "high" | "medium" | "low";
  selected: boolean;
};

export type Target = {
  name: string;
  domain: string;
  industry: string;
  country: string;
  employee_range: string;
  why_fit: string;
};

export type OpportunitySignal = {
  signal: string;
  source_url: string;
  why_now: string;
  confidence: "high" | "medium" | "low";
};

export type OutreachStep = {
  step: number;
  delay_days: number;
  angle: string;
  subject: string;
  body: string;
};

export type ContactResult = {
  opportunity_score: number;
  qualification_summary: string;
  trigger_signals: OpportunitySignal[];
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  email_type: "person" | "generic" | "none";
  source_url: string | null;
  emails_found: string[];
  pages_read: string[];
  evidence_map: EvidenceItem[];
  outreach_sequence: OutreachStep[];
  subject: string;
  body: string;
};

async function assertMember(context: { organizationId: string }) {
  return context.organizationId;
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof AiError) throw new Error(e.message);
    throw e;
  });
}

// The AI sometimes returns objects instead of strings in lists; flatten them to text.
const toText = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).map(toText).filter(Boolean).join(": ") : v == null ? "" : String(v);
const strList = (itemMax: number, n: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.map(toText).filter(Boolean).map((x) => x.slice(0, itemMax)).slice(0, n) : []),
    z.array(z.string().max(itemMax)).max(n),
  );

const analysisSchema = z.object({
  business_name: z.preprocess((v) => toText(v).slice(0, 200), z.string()),
  one_liner: z.preprocess((v) => toText(v).slice(0, 500), z.string()),
  what_it_does: z.preprocess((v) => toText(v).slice(0, 3000), z.string()),
  value_proposition: z.preprocess((v) => toText(v).slice(0, 2000), z.string()),
  ideal_customers: strList(300, 12),
  target_industries: strList(120, 12),
  target_titles: strList(120, 12),
  pain_points: strList(300, 12),
  differentiators: strList(300, 10),
  pricing_summary: strList(300, 10),
  capability_status: z.preprocess((v) => (Array.isArray(v) ? v.slice(0, 15) : []), z
    .array(
      z.object({
        capability: z.preprocess((v) => toText(v).slice(0, 200), z.string()),
        status: z.enum(["live", "preview", "planned", "unclear"]).catch("unclear"),
        evidence: z.preprocess((v) => toText(v).slice(0, 400), z.string()),
      }),
    )
    .max(15)),
  proof_points: strList(300, 10),
});

const SENDER_KEYWORDS = ["pricing", "plans", "features", "product", "platform", "solutions", "capabilities", "integrations", "automation", "ai", "agents", "security", "faq", "docs", "about", "industries", "use-cases", "case-studies"];
const TARGET_KEYWORDS = ["about", "services", "products", "solutions", "team", "careers", "jobs", "case-studies", "clients", "contact", "pricing", "industries", "projects", "portfolio", "work", "service"];

export const analyzeBusiness = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ website: z.string().min(3).max(300) }).parse(d))
  .handler(({ data, context }) =>
    wrap(async () => {
      await assertMember(context);
      const host = hostOf(data.website);
      if (!host) throw new Error("Enter a valid website like example.com");
      const home = (await fetchPage(`https://${host}`)) ?? (await fetchPage(`https://www.${host}`));
      if (!home) throw new Error(`Couldn't open https://${host}. Check the address and that the site is public.`);
      const meta = pageMeta(home.html);
      // Crawl a bounded, prioritised set of internal pages (max 8) plus /llms.txt.
      const links = rankedLinks(home.html, home.url, SENDER_KEYWORDS, 8);
      const [pages, llms] = await Promise.all([
        Promise.all(links.map((u) => fetchPage(u, 6000))),
        fetchText(`${new URL(home.url).origin}/llms.txt`),
      ]);
      const got = pages.filter(Boolean) as { url: string; html: string }[];
      const text = [
        `URL: ${home.url}\n${htmlToText(home.html, 6000)}`,
        ...(llms ? [`URL: ${new URL(home.url).origin}/llms.txt\n${llms.slice(0, 5000)}`] : []),
        ...got.map((p) => `URL: ${p.url}\n${htmlToText(p.html, 2500)}`),
      ]
        .join("\n---\n")
        .slice(0, 26000);
      const a = await aiJson<Analysis>(
        "You are a B2B go-to-market analyst. Read a company's website text and explain precisely what the business sells, to whom, and who would benefit most. Use ONLY facts present in the text. Never invent features, prices, customers, metrics, testimonials or product status. If something isn't stated, leave it out (empty array) or mark status 'unclear'.",
        `Website: https://${host}\nTitle: ${meta.title}\nMeta description: ${meta.description}\n\nPages:\n${text}\n\nReturn JSON with keys: business_name, one_liner (max 25 words), what_it_does (2-4 sentences), value_proposition (1-2 sentences), ideal_customers (4-6 concrete customer profiles), target_industries (4-8), target_titles (3-6 decision-maker job titles who would buy), pain_points (3-5 problems it solves), differentiators (what the site says sets it apart; [] if none stated), pricing_summary (exact plans/prices/free tiers as stated; [] if no pricing on the site), capability_status (array of {capability, status: "live"|"preview"|"planned"|"unclear", evidence: short quote or paraphrase + page URL}; "live" = described as a current feature or included in a listed paid/free plan, "preview" = explicitly beta/early access, "planned" = explicitly coming soon/roadmap, "unclear" only when the site gives no indication either way; a generic legal/FAQ disclaimer does not make every feature unclear), proof_points (customer names, testimonials, metrics, awards explicitly on the site; [] if none).`,
        "medium",
      );
      return { website: `https://${host}`, analysis: analysisSchema.parse(a) };
    }),
  );

export const discoverTargets = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) =>
    z
      .object({
        website: z.string().max(300),
        analysis: analysisSchema,
        exclude: z.array(z.string().max(200)).max(200).default([]),
        region: z.enum(["domestic", "international", "both"]).default("domestic"),
        business_query: z.string().max(200).default(""),
        industry_query: z.string().max(160).default(""),
        include_competitors: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    wrap(async () => {
      await assertMember(context);
      const feedback = await prospectFeedbackForOrganization(context.organizationId);
      const feedbackHint =
        feedback.samples >= 3
          ? `\nWorkspace outcome feedback (use only as a tie-breaker after product fit): positive industries: ${feedback.positiveIndustries.join(", ") || "none"}; positive company sizes: ${feedback.positiveEmployeeRanges.join(", ") || "none"}; repeatedly not-relevant industries: ${feedback.negativeIndustries.join(", ") || "none"}.`
          : "";
      // Only the sender's own domain and domains already seen in this run are excluded.
      const skip = new Set<string>([hostOf(data.website) ?? "", ...data.exclude.map((d) => hostOf(d) ?? d)]);
      const AU_RE = /australia|sydney|melbourne|brisbane|perth|adelaide|gold coast|canberra|hobart|darwin/i;
      const isAu = (c: { domain: string; country?: string }) => c.domain.endsWith(".au") || AU_RE.test(String(c.country ?? ""));
      const locationRule =
        data.region === "domestic"
          ? "STRICT LOCATION RULE: every company MUST be based in Australia. Prefer .com.au / .au domains or companies clearly located in Australian cities. NEVER include overseas companies. Set country to \"Australia\" for every item."
          : data.region === "international"
            ? "STRICT LOCATION RULE: every company MUST be based OUTSIDE Australia. NEVER include Australian companies or .au domains. Set country to each company's real country."
            : "LOCATION RULE: return a mix, roughly half based in Australia and half overseas. Set country to each company's real country (\"Australia\" for the Australian ones).";
      const an = data.analysis;
      const businessQuery = data.business_query.trim();
      const industryQuery = data.industry_query.trim();
      const explicitSearch = Boolean(businessQuery || industryQuery);
      const searchIntent = [
        businessQuery ? `Requested business/company: ${businessQuery}` : "",
        industryQuery ? `Requested industry: ${industryQuery}` : "",
        data.include_competitors
          ? "Competitor discovery: ON. Include direct competitors or close peers relevant to the named business or industry."
          : "Competitor discovery: OFF.",
      ].filter(Boolean).join("\n");
      const modeInstruction = explicitSearch
        ? "Follow the operator's explicit market search first. If a business is named, resolve the real company and its real primary domain and include it first when it satisfies the location rule. If an industry is named, constrain discovery to that industry or clearly adjacent operators. When competitor discovery is on, include real direct competitors or close peers and explain that relationship in why_fit. Never invent a company or domain."
        : "No explicit company or industry was supplied. Discover strong prospects from the sender product analysis as usual.";
      const res = await aiJson<{ companies: Target[] }>(
        `You are a B2B market and prospecting researcher. Propose REAL, currently operating companies with their real primary website domains. For broad prospecting, prefer small and mid-sized businesses. For an explicitly named business, include that company when it exists and matches the location rule regardless of size. ${modeInstruction} ${locationRule}`,
        `SEARCH INTENT:\n${searchIntent || "(broad prospect discovery)"}\n\nProduct: ${an.business_name}: ${an.one_liner}\nWhat it does: ${an.what_it_does}\nValue proposition: ${an.value_proposition}\nIdeal customers: ${an.ideal_customers.join("; ")}\nTarget industries: ${an.target_industries.join(", ")}\nBuyer titles: ${an.target_titles.join(", ")}\nPain points: ${an.pain_points.join("; ")}\nDifferentiators: ${an.differentiators.join("; ") || "(none)"}${feedbackHint}\nDo NOT include these domains: ${[...skip].filter(Boolean).slice(0, 150).join(", ") || "none"}\n\nReturn JSON {"companies":[...]} with up to 16 items, each: name, domain (bare domain, no protocol), industry, country, employee_range (one of 1-10, 11-50, 51-200, 201-1000, 1000+), why_fit (one specific sentence tying the company to the product and, when relevant, identifying it as a competitor or peer). If a business was explicitly requested, put it first.`,
      );
      const candidates = (res.companies ?? [])
        .map((c) => ({ ...c, domain: hostOf(String(c.domain ?? "")) ?? "" }))
        .filter((c) => c.domain && c.name && !skip.has(c.domain))
        // Enforce the region choice even if the AI slips.
        .filter((c) => (data.region === "domestic" ? isAu(c) : data.region === "international" ? !isAu(c) : true));
      // Verify each domain is a live public website.
      const checked = await Promise.all(
        candidates.slice(0, 16).map(async (c) => ((await fetchPage(`https://${c.domain}`, 6000)) ? c : null)),
      );
      const ranges = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
      return {
        targets: checked
          .filter((c): c is Target => !!c)
          .slice(0, 10)
          .map((c) => ({
            name: String(c.name).slice(0, 200),
            domain: c.domain,
            industry: String(c.industry ?? "").slice(0, 120),
            country: String(c.country ?? "").slice(0, 80),
            employee_range: ranges.includes(c.employee_range) ? c.employee_range : "",
            why_fit: String(c.why_fit ?? "").slice(0, 500),
          })),
      };
    }),
  );

const targetSchema = z.object({
  name: z.string().max(200),
  domain: z.string().max(200),
  industry: z.string().max(120),
  country: z.string().max(80),
  employee_range: z.string().max(20),
  why_fit: z.string().max(500),
});

export const researchAndDraft = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) =>
    z
      .object({
        target: targetSchema,
        analysis: analysisSchema,
        website: z.string().max(300),
        sender: z.object({ name: z.string().min(1).max(120), email: z.string().email().max(200) }),
        approved_claims: z.string().max(1500).default(""),
      })
      .parse(d),
  )
  .handler(({ data, context }): Promise<ContactResult> =>
    wrap(async () => {
      await assertMember(context);
      const domain = hostOf(data.target.domain);
      if (!domain) throw new Error("Invalid company domain");
      const home = await fetchPage(`https://${domain}`, 7000);
      const ranked = home ? rankedLinks(home.html, home.url, TARGET_KEYWORDS, 8) : [];
      const basic = home ? extractLinks(home.html, home.url) : [];
      const fallbacks = ["/about", "/contact", "/services", "/team", "/about-us", "/contact-us"].map((p) => `https://${domain}${p}`);
      const urls = [...new Set([...ranked, ...basic, ...fallbacks])].filter((u) => u !== home?.url).slice(0, 9);
      const pages = [home, ...(await Promise.all(urls.map((u) => fetchPage(u, 6000))))].filter(Boolean) as { url: string; html: string }[];
      const uniq = pages.filter((p, i) => pages.findIndex((q) => q.url === p.url) === i);
      const emails = [...new Set(uniq.flatMap((p) => extractEmails(p.html, domain)))].slice(0, 15);
      const corpus = uniq.map((p) => `URL: ${p.url}\n${htmlToText(p.html, 3000)}`).join("\n---\n").slice(0, 22000);
      const an = data.analysis;
      const approved = data.approved_claims.trim();
      const approvedLower = approved.toLowerCase();
      const caps = an.capability_status.map((c) => `${c.capability} [${c.status}]${c.evidence ? `: ${c.evidence}` : ""}`).join("\n- ") || "(none listed)";
      const nonLive = an.capability_status.filter((c) => c.status !== "live").map((c) => c.capability).filter((c) => c.length >= 4);
      const senderEvidence = [an.value_proposition, an.what_it_does, ...an.pricing_summary, ...an.differentiators, ...an.proof_points, ...an.capability_status.map((c) => `${c.capability} ${c.evidence}`)].join(" ").toLowerCase();

      type Draft = { contact_name: string | null; contact_title: string | null; email: string | null; source_url: string | null; evidence_map: (EvidenceItem & { selected?: boolean })[]; trigger_signals?: OpportunitySignal[]; qualification_summary?: string; outreach_sequence?: OutreachStep[]; subject: string; body: string };
      const system =
        "You research B2B prospects and write short, specific, pain-first cold outreach emails. Use ONLY facts present in the provided page text, except any explicitly labelled operator-approved sender claims. Never invent people, email addresses, prices, offers, capabilities or problems. Never assume a problem merely because the industry commonly has it. Every inference must follow from an observed fact on their site.";
      const adoptionInstruction = approved
        ? `\nOPERATOR-APPROVED SENDER ASSERTIONS for ${hostOf(data.website)} only (approved by the sender personally; NOT target observations and NOT from the site scan):\n${approved}\nWeave the relevant ones in naturally after the pain and capability discussion, BEFORE the CTA, as practical objection-handling. Vary wording; do not paste them verbatim as a list. These are the ONLY exception to the verified-facts rule; they do not approve anything they don't explicitly say.\n`
        : "";
      const prompt = `Target company: ${data.target.name} (${domain}), ${data.target.industry}, ${data.target.country}\nWhy they fit (AI guess, unverified): ${data.target.why_fit}\n\nPreferred decision-maker titles: ${an.target_titles.join(", ")}\n\nEmails found on their public site: ${emails.join(", ") || "none"}\n\nTheir public pages:\n${corpus || "(site text unavailable)"}\n\n---\nSENDER (commercial facts below are verified from the sender's own site, except explicitly labelled operator-approved campaign claims)\nSender: ${data.sender.name} <${data.sender.email}>\nProduct: ${an.business_name} (${data.website}): ${an.one_liner}\nWhat it does: ${an.what_it_does}\nValue proposition: ${an.value_proposition}\nPain points solved: ${an.pain_points.join("; ")}\nDifferentiators / moat: ${an.differentiators.join("; ") || "(none stated)"}\nPricing (verified): ${an.pricing_summary.join("; ") || "(none found, so make NO pricing, free, trial, credit-card or plan claims)"}\nProof points (verified): ${an.proof_points.join("; ") || "(none found)"}\nCapabilities with status:\n- ${caps}\n${adoptionInstruction}\nTasks:\n1. Build evidence_map (3-6 items) BEFORE writing. Each item: observed_fact (literally on their pages), source_url (exact page URL above), likely_operational_friction, classification ("FACT" if the friction itself is stated on the page, else "INFERENCE" that follows directly from the observed_fact), consequence (practical cost in their terms), role_relevance, matched_sender_capability (only from the sender capabilities list, or "none"), capability_status (that capability's status, "unclear" if none), confidence ("high"|"medium"|"low"), selected (true for the 2-3 items you will use in the email; 4 only if evidence is unusually strong). Rank for selection by: operational cost/frustration, recurrence, relevance to the chosen contact, evidence confidence, strength of sender match. Only select items whose matched capability is live. Skip anything you can't ground in the page text.\n2. Identify trigger_signals (0-5) that make outreach timely. A trigger must be an explicit current/recent fact in the supplied target pages, such as a new project, expansion, hiring, launch, contract, event, location, service or operational change. Each item: signal, source_url (exact supplied URL), why_now, confidence. Do not invent dates or recency. If there is no genuine trigger, return [].
3. Write qualification_summary in 1-2 sentences explaining why this prospect merits attention, grounded only in the evidence map and trigger signals. Do not include a numeric score.
4. Pick the best decision-maker named in the page text (prefer the titles above; founders/owners/CEOs fine for small firms). If none named, contact_name and contact_title are null.\n5. Pick the best email ONLY from the "Emails found" list (personal address for that person if present, else the most relevant general inbox). If empty, null.\n6. source_url: page URL where the person or email appeared, or null.\n7. Write the initial email. Subject: max 8 words, specific to this prospect. Body: roughly 140-200 words, plain text, human, direct, not SaaS boilerplate. Greet by first name if known, else "Hi ${data.target.name} team". Open with ONE concrete observation from their site. Then surface the 2-3 selected recurring friction points, the practical consequence of each in their terms, and connect each to a specific live sender capability, favouring differentiators/moat over generic CRM plumbing. INFERENCE items must be worded tentatively ("I'd guess", "often means", "I imagine") and never stated as known fact. Pricing/proof points only if genuinely useful as supporting evidence, never the hook, and only exactly as verified above.${approved ? " Include the operator-approved sender assertions after those pains and before the CTA." : ""}\nSTRICT RULES:\n- Any claim about price, free offers/trials, no credit card, no personal details, onboarding speed, plans or capacity MUST appear in the verified sender facts above; otherwise omit it.${approved ? " EXCEPTION: statements explicitly contained in the operator-approved sender assertions above may be used." : ""}\n- Never present a capability with status preview, planned or unclear as available${nonLive.length ? ` (these are NOT live: ${nonLive.join(", ")})` : ""}.\n- No generic phrases like "streamline your workflow", "all-in-one solution", "everything in one platform".\n- NEVER offer or mention a call, phone call, demo, Zoom or meeting. The ONLY call to action is to reply to this email or check out ${data.website}.\n- Do NOT use em dashes or en dashes anywhere. Use commas, full stops or colons.\n- Sign off with the sender's name and website, then a final line: "If this isn't relevant, just reply and I won't follow up." No bracket placeholders.\n8. Create outreach_sequence with exactly two optional follow-up drafts for human review: step 2 at delay_days 3 and step 3 at delay_days 7. Each must use a different grounded evidence item or trigger from this dossier, add no new factual claims, avoid "just following up", stay under 120 words, and use only a reply or ${data.website} as the CTA. Fields: step, delay_days, angle, subject, body.\n\nReturn JSON with keys: contact_name, contact_title, email, source_url, evidence_map, trigger_signals, qualification_summary, outreach_sequence, subject, body.`;

      let r = await aiJson<Draft>(system, prompt, "medium");
      const hasNonLive = (t: string) => nonLive.filter((c) => t.toLowerCase().includes(c.toLowerCase()));
      const offending = hasNonLive(String(r.body ?? ""));
      const namesThisTarget = (subject: string) => subject.toLowerCase().includes(data.target.name.toLowerCase());
      if (offending.length || !namesThisTarget(String(r.subject ?? ""))) {
        // One corrective regeneration for non-live claims, missing reassurance or a mismatched subject.
        r = await aiJson<Draft>(system, `${prompt}\n\nCORRECTION: ${offending.length ? `Do not mention these non-live capabilities: ${offending.join(", ")}. ` : ""}${approved ? "Include the operator-approved sender assertions before the CTA. " : ""}The subject must name THIS target (${data.target.name}), not another company.`, "medium");
      }

      const pageUrls = new Set(uniq.map((p) => p.url));
      const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
      const rank = { high: 0, medium: 1, low: 2 } as const;
      const evidence_map: EvidenceItem[] = (Array.isArray(r.evidence_map) ? r.evidence_map : [])
        .filter((e) => e && e.observed_fact && pageUrls.has(e.source_url))
        .slice(0, 6)
        .map((e) => ({
          observed_fact: String(e.observed_fact).slice(0, 400),
          source_url: e.source_url,
          likely_operational_friction: String(e.likely_operational_friction ?? "").slice(0, 400),
          classification: pick(e.classification, ["FACT", "INFERENCE"] as const, "INFERENCE"),
          consequence: String(e.consequence ?? "").slice(0, 400),
          role_relevance: String(e.role_relevance ?? "").slice(0, 300),
          matched_sender_capability: String(e.matched_sender_capability ?? "").slice(0, 200),
          capability_status: pick(e.capability_status, ["live", "preview", "planned", "unclear"] as const, "unclear"),
          confidence: pick(e.confidence, ["high", "medium", "low"] as const, "low"),
          selected: e.selected === true,
        }))
        .sort((a, b) => Number(b.selected) - Number(a.selected) || rank[a.confidence] - rank[b.confidence]);

      const trigger_signals: OpportunitySignal[] = (Array.isArray(r.trigger_signals) ? r.trigger_signals : [])
        .filter((x) => x && x.signal && pageUrls.has(x.source_url))
        .slice(0, 5)
        .map((x) => ({
          signal: String(x.signal).slice(0, 300),
          source_url: x.source_url,
          why_now: String(x.why_now ?? "").slice(0, 300),
          confidence: pick(x.confidence, ["high", "medium", "low"] as const, "low"),
        }));

      // Deterministic qualification score: evidence quality + live capability fit + timely triggers + contactability.
      // The model supplies evidence; it does not get to invent the score.
      const selected = evidence_map.filter((e) => e.selected);
      const highEvidence = evidence_map.filter((e) => e.confidence === "high").length;
      const liveMatches = selected.filter((e) => e.capability_status === "live" && e.matched_sender_capability.toLowerCase() !== "none").length;
      const highTriggers = trigger_signals.filter((x) => x.confidence === "high").length;
      const opportunity_score = Math.min(
        100,
        Math.round(
          Math.min(35, selected.length * 10 + highEvidence * 5) +
            Math.min(30, liveMatches * 15) +
            Math.min(20, trigger_signals.length * 5 + highTriggers * 5) +
            (emails.length ? 10 : 0) +
            (r.contact_name ? 5 : 0),
        ),
      );
      const qualification_summary = String(r.qualification_summary ?? "").slice(0, 600);

      // Guardrails on the final text.
      const noDash = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/ ,/g, ",").replace(/,\s*,/g, ",");
      const sentences = (t: string, keep: (x: string) => boolean) =>
        t
          .split("\n")
          .map((line) => (line.match(/[^.!?]+[.!?]*\s*/g) ?? [line]).filter(keep).join("").trimEnd())
          .join("\n");
      const CLAIMS: [RegExp, RegExp][] = [
        [/credit card/i, /credit card/],
        [/personal details/i, /personal details/],
        [/\bfree\b/i, /\bfree\b/],
        [/\btrial\b/i, /\btrial\b/],
        [/\b(?:\d+|five)\s*(minutes?|mins?)\b/i, /(?:\d+|five)\s*(minutes?|mins?)/],
        [/[$\u00a3\u20ac]\s?\d/, /[$\u00a3\u20ac]\s?\d/],
      ];
      let body = noDash(String(r.body ?? ""));
      body = sentences(body, (x) => {
        if (/reply and i won't follow up/i.test(x)) return true;
        if (hasNonLive(x).length) return false;
        return CLAIMS.every(([inText, inEvidence], index) => !inText.test(x) || inEvidence.test(senderEvidence) || inEvidence.test(approvedLower));
      });
      const subject = noDash(namesThisTarget(String(r.subject ?? ""))
        ? String(r.subject)
        : `${data.target.name}: ${(evidence_map.find((e) => e.selected && e.capability_status === "live")?.matched_sender_capability || "operations").split(/\s+/).slice(0, 5).join(" ")}`);
      const cleanSequenceBody = (value: unknown) =>
        sentences(noDash(String(value ?? "")), (x) => {
          if (hasNonLive(x).length) return false;
          return CLAIMS.every(([inText, inEvidence]) => !inText.test(x) || inEvidence.test(senderEvidence) || inEvidence.test(approvedLower));
        }).slice(0, 2500);
      const outreach_sequence: OutreachStep[] = (Array.isArray(r.outreach_sequence) ? r.outreach_sequence : [])
        .slice(0, 2)
        .map((s, index) => ({
          step: index + 2,
          delay_days: index === 0 ? 3 : 7,
          angle: String(s?.angle ?? "").slice(0, 200),
          subject: noDash(String(s?.subject ?? "")).slice(0, 200),
          body: cleanSequenceBody(s?.body),
        }))
        .filter((s) => s.subject && s.body);
      const lowerCorpus = corpus.toLowerCase();
      const email = r.email && emails.includes(r.email.toLowerCase()) ? r.email.toLowerCase() : emails.find((e) => e.endsWith(domain)) ?? null;
      const name = r.contact_name && lowerCorpus.includes(r.contact_name.toLowerCase().split(" ").pop() ?? "~~") ? r.contact_name.slice(0, 120) : null;
      const generic = email ? /^(info|hello|contact|contactus|sales|support|team|office|admin|enquiries|enquiry|inquiries|inquiry|mail|hi|rental|rentals|hire|hiredesk|bookings|booking|events|general|reception|marketing|installation|integration|service|press|careers|jobs)@/.test(email) : false;
      return {
        opportunity_score,
        qualification_summary,
        trigger_signals,
        contact_name: name,
        contact_title: name ? (r.contact_title?.slice(0, 120) ?? null) : null,
        email,
        email_type: email ? (generic ? "generic" : "person") : "none",
        source_url: r.source_url && pageUrls.has(r.source_url) ? r.source_url : (uniq[0]?.url ?? null),
        emails_found: emails,
        pages_read: uniq.map((p) => p.url),
        evidence_map,
        outreach_sequence,
        subject: subject.slice(0, 200),
        body: body.slice(0, 4000),
      };
    }),
  );
