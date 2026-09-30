import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { fetchPage, htmlToText, hostOf, rankedLinks } from "@/lib/prospect/web.server";
import { aiJsonForOrg } from "@/lib/prospect/ai.server";
import { BUSINESS_CONTEXTS, capabilityText } from "./capabilities";
import { diagnosePublicPage } from "./fetch-diagnostic.server";
import { getAiRuntime } from "./openrouter.server";
import { competitorRegistry, getCapabilityProfile, mergeCompetitorDiscovery, saveCompetitorAnalysis, saveResearchRun } from "./store.server";

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number | string };

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The selected model returned malformed JSON.");
}

async function repairResearchJson<T>(orgId: string, raw: string): Promise<T> {
  try {
    return await aiJsonForOrg<T>(
      orgId,
      `You are a strict JSON repair utility inside SPA Intelligence.
The input came from a research model and is intended to be one JSON object, but it may contain a missing comma, broken array separator, stray markdown fence or other JSON syntax defect.
Repair syntax only. Preserve the existing facts, URLs, strings, arrays and object structure. Do not research, infer, add, remove or rewrite factual content. Return one valid JSON object only.`,
      `Repair this malformed JSON and return the corrected JSON object:\n\n${raw.slice(0, 24000)}`,
      "low",
    );
  } catch (error) {
    console.error("[SPA Intelligence] JSON repair failed", error);
    throw new Error("The research provider returned malformed structured data twice. Nothing was saved. Retry the scan.");
  }
}

async function openRouterResearch<T>(orgId: string, system: string, user: string): Promise<{ data: T; modelUsed: string; usage: Usage | null }> {
  const runtime = await getAiRuntime(orgId);
  const messages = [
    { role: "system", content: system + "\nReturn exactly one JSON object. No markdown fences." },
    { role: "user", content: user },
  ];

  async function send(useJsonMode: boolean) {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + runtime.apiKey,
        "X-Title": "SPA Intelligence",
      },
      body: JSON.stringify({
        model: runtime.model,
        messages,
        max_tokens: 3500,
        temperature: 0.2,
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
        tools: [
          {
            type: "openrouter:web_search",
            parameters: {
              engine: "parallel",
              max_results: 4,
              max_total_results: 8,
              search_context_size: "medium",
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(180000),
    });
  }

  let response: Response;
  try {
    response = await send(true);
    if (response.status === 400) {
      const rejected = await response.text().catch(() => "");
      if (/response[_ -]?format|json mode|structured/i.test(rejected)) {
        response = await send(false);
      } else {
        throw new Error(rejected || "OpenRouter rejected the research request.");
      }
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(
        `Research exceeded 180 seconds using ${runtime.model}. Retry once, or choose a faster model in AI & Models.`,
      );
    }
    throw error;
  }

  const body = await response.text();
  if (!response.ok) {
    let message = `OpenRouter returned HTTP ${response.status}.`;
    try { message = JSON.parse(body)?.error?.message ?? message; } catch {}
    if (response.status === 401) message = "The saved OpenRouter API key was rejected. Reconnect it in AI & Models.";
    if (response.status === 402) message = "The OpenRouter account has insufficient credits.";
    if (response.status === 429) message = "OpenRouter rate-limited this research request. Retry shortly.";
    throw new Error(message);
  }

  const json = JSON.parse(body) as any;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no research content.");

  const raw = String(content);
  let data: T;
  try {
    data = parseJson<T>(raw);
  } catch (error) {
    console.warn("[SPA Intelligence] Research JSON was malformed, attempting automatic repair", {
      model: String(json.model ?? runtime.model),
      message: error instanceof Error ? error.message : String(error),
      preview: raw.slice(0, 600),
    });
    data = await repairResearchJson<T>(orgId, raw);
  }

  return {
    data,
    modelUsed: String(json.model ?? runtime.model),
    usage: json.usage ?? null,
  };
}

function normalizeQueryDomain(input: string): string | null {
  const trimmed = input.trim();
  const direct = hostOf(trimmed);
  if (direct) return direct;
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i)?.[0];
  return urlMatch ? hostOf(urlMatch) : null;
}

async function directWebsiteContext(domain: string | null) {
  if (!domain) {
    return {
      status: "not_provided",
      pages: [] as { url: string; text: string }[],
      message: "No direct website URL/domain was supplied.",
      diagnostic: null,
    };
  }
  const homeUrl = "https://" + domain;
  const diagnostic = await diagnosePublicPage(homeUrl, 12000);
  if (!diagnostic.ok || !diagnostic.html) {
    return {
      status: diagnostic.category,
      pages: [] as { url: string; text: string }[],
      message: diagnostic.message + " Research continued using other legitimate public sources.",
      diagnostic: {
        category: diagnostic.category,
        httpStatus: diagnostic.httpStatus,
        contentType: diagnostic.contentType,
        url: diagnostic.url,
      },
    };
  }

  const home = { url: diagnostic.url, html: diagnostic.html };
  const links = rankedLinks(home.html, home.url, ["projects","project","news","about","services","solutions","energy","battery","solar","contact","team"], 6);
  const more = (await Promise.all(links.map((u) => fetchPage(u, 8000)))).filter(Boolean) as { url: string; html: string }[];
  const uniq = [home, ...more].filter((p, i, arr) => arr.findIndex((q) => q.url === p.url) === i);
  return {
    status: "ok",
    pages: uniq.map((p) => ({ url: p.url, text: htmlToText(p.html, 4500) })),
    message: `Direct public HTML retrieval succeeded. Read ${uniq.length} public page${uniq.length === 1 ? "" : "s"}.`,
    diagnostic: {
      category: diagnostic.category,
      httpStatus: diagnostic.httpStatus,
      contentType: diagnostic.contentType,
      url: diagnostic.url,
    },
  };
}

const businessContext = z.enum(["spa","solaronline","elmofo"]).default("spa");

export const researchSpaCompany = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    query: z.string().min(2).max(500),
    mode: z.enum(["prospect","competitor","venture"]).default("prospect"),
    businessContext,
    capabilityOverrides: z.string().max(8000).optional().default(""),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const domain = normalizeQueryDomain(data.query);
    const direct = await directWebsiteContext(domain);
    const profile = BUSINESS_CONTEXTS[data.businessContext];
    const storedCapabilityProfile = await getCapabilityProfile(context.organizationId);
    const capabilityContext = (data.capabilityOverrides.trim() || storedCapabilityProfile || capabilityText()).slice(0, 8000);
    const directText = direct.pages.map((p) => `URL: ${p.url}\n${p.text}`).join("\n---\n").slice(0, 28000);

    type Result = {
      organisation: string;
      official_website: string | null;
      industry: string | null;
      locations: string[];
      what_the_company_does: string;
      current_projects: { item: string; source_url: string; evidence_date: string | null; classification: string }[];
      recent_developments: { item: string; source_url: string; evidence_date: string | null; classification: string }[];
      energy_power_infrastructure_context: string[];
      capability_matches: { capability: string; provenance: "CONFIRMED" | "LIKELY / ADJACENT" | "NEEDS VERIFICATION"; rationale: string; classification: string }[];
      opportunity_hypotheses: { hypothesis: string; why_now: string; source_url: string | null; classification: "INFERENCE" | "COMMERCIAL_HYPOTHESIS"; validation_needed: string }[];
      people: { name: string; title: string; contact: string | null; source_url: string; classification: string }[];
      tenders: { title: string; reference: string | null; closing_date: string | null; source_url: string; classification: string }[];
      risks_unknowns: string[];
      questions_spa_should_ask: string[];
      possible_first_approach: string;
      follow_up_strategy: string;
      next_action: string;
      evidence: { statement: string; source_url: string; evidence_date: string | null; classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "INFERENCE" | "COMMERCIAL_HYPOTHESIS" | "UNKNOWN" }[];
      competitor_implications?: string[];
    };

    const modeRule = data.mode === "competitor"
      ? "You are analysing a competitor. Include competitor_implications as evidence-based commercial implications for SPA. Do not rank either company or claim SPA wins."
      : data.mode === "venture"
        ? "Use an innovation/EV/commercialisation lens. Do not contaminate the analysis with generic solar lead-generation logic unless the evidence makes solar directly relevant."
        : "Use a commercial-development lens for Solar Power Australia.";

    const system = `You are SPA Intelligence, a private commercial-intelligence analyst for ${profile.name}. ${modeRule}
You must separate OBSERVED_FACT, SOURCE_CLAIM, INFERENCE, COMMERCIAL_HYPOTHESIS and UNKNOWN.
Never invent people, emails, phone numbers, tenders, projects, customers, contract values, equipment requirements or capabilities.
Every substantial factual claim must include a public source URL. Use current web search when useful. If sources disagree, surface the disagreement. An unknown is preferable to fabrication.
When matching capabilities, respect provenance labels exactly and never promote LIKELY / ADJACENT or NEEDS VERIFICATION into confirmed facts.`;

    const prompt = `Research target: ${data.query}
Business context: ${profile.name}
Commercial lens: ${profile.lens}

SPA CAPABILITY PROFILE:
${capabilityContext}

DIRECT WEBSITE RETRIEVAL STATUS: ${direct.status}
DIRECT WEBSITE RETRIEVAL MESSAGE: ${direct.message}
DIRECT WEBSITE MATERIAL:
${directText || "(none available; use legitimate indexed/public sources via web search)"}

Return JSON with:
organisation, official_website, industry, locations, what_the_company_does,
current_projects[], recent_developments[], energy_power_infrastructure_context[],
capability_matches[], opportunity_hypotheses[], people[], tenders[],
risks_unknowns[], questions_spa_should_ask[], possible_first_approach,
follow_up_strategy, next_action, evidence[]${data.mode === "competitor" ? ", competitor_implications[]" : ""}.

Rules:
- current_projects and recent_developments items require source_url and evidence_date when known.
- capability_matches: capability, provenance, rationale, classification.
- opportunity_hypotheses are never facts. Include validation_needed.
- people entries require a source URL. contact may be null. Do not infer personal email patterns.
- tenders only if actually found.
- evidence classification must be one of OBSERVED_FACT, SOURCE_CLAIM, INFERENCE, COMMERCIAL_HYPOTHESIS, UNKNOWN.
- LOCATION REQUIREMENT: actively search for the organisation's headquarters, office, facility, project or operating locations. Populate locations with concise real locations such as "Cardiff, NSW, Australia". Never output placeholder phrases such as "not supplied", "not stated", "unknown location", "N/A" or similar. If only country-level location is supported, use the country. Leave locations empty only when no public source supports any location.
- Any location included must be supported by a source used in the evidence ledger.
- Keep source URLs clickable and exact.
- Prefer Australian/current sources where relevant, but do not exclude authoritative global company sources.`;

    const result = await openRouterResearch<Result>(context.organizationId, system, prompt);
    const response = {
      query: data.query,
      businessContext: data.businessContext,
      mode: data.mode,
      directRetrieval: direct,
      dossier: result.data,
      modelUsed: result.modelUsed,
      usage: result.usage,
      researchedAt: new Date().toISOString(),
    };
    await saveResearchRun(context.organizationId, {
      query: data.query,
      researchType: data.mode,
      businessContext: data.businessContext,
      researchedAt: response.researchedAt,
      modelUsed: result.modelUsed,
      status: direct.status === "ok" ? "completed" : "partial",
      result: response,
    });
    return response;
  });

export const researchSpaIndustry = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    industry: z.string().min(2).max(200),
    region: z.string().min(2).max(200).default("Australia"),
    focus: z.string().min(2).max(300),
    businessContext,
    purpose: z.enum(["industry","opportunity-radar"]).default("industry"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const profile = BUSINESS_CONTEXTS[data.businessContext];
    type Result = {
      organisations: { name: string; website: string | null; location: string | null; why_relevant: string; source_url: string }[];
      signals: { organisation: string; signal: string; location: string | null; evidence_date: string | null; source_url: string; spa_fit: string; classification: string }[];
      tenders: { title: string; issuer: string; reference: string | null; closing_date: string | null; location: string | null; source_url: string; spa_fit: string }[];
      market_notes: string[];
    };
    const system = `You are SPA Intelligence researching an industry for ${profile.name}. Use current public web sources. Never fabricate projects, tenders, people or dates. Every organisation, signal and tender must have a source URL. Distinguish observed facts from commercial inference.`;
    const prompt = `Industry: ${data.industry}
Region: ${data.region}
Opportunity focus: ${data.focus}
Business lens: ${profile.lens}

SPA CAPABILITIES:
${(await getCapabilityProfile(context.organizationId)) || capabilityText()}

Return JSON {organisations:[...], signals:[...], tenders:[...], market_notes:[...]}.
Find real current organisations/projects/signals relevant to this filter.

LOCATION IS REQUIRED FOR RETURNED RESULTS:
- Actively research and populate a real location for every organisation, signal and tender.
- For an organisation, use its headquarters, office, facility or operating location relevant to the requested region.
- For a project/signal, use the project/site location where available, otherwise the organisation location relevant to the signal.
- For a tender, use the project/service/delivery location, or the issuer jurisdiction when that is the only supported geographic scope.
- Use concise forms such as "Newcastle, NSW, Australia", "Pilbara, WA, Australia" or "Australia".
- Never output placeholders such as "not supplied", "not stated", "unknown", "N/A" or an empty string.
- If you cannot establish any supported location for an item from a public source, OMIT that item entirely.
- The item's source_url must support both the item's existence and its stated location, or be the strongest available source with the location supported by another authoritative result used in the research.

For each signal explain SPA fit without asserting unverified equipment requirements. For tenders, include only documented notices with source URL and closing date when public.`;
    const result = await openRouterResearch<Result>(context.organizationId, system, prompt);

    const cleanLocation = (value: unknown): string | null => {
      const location = typeof value === "string" ? value.trim() : "";
      if (!location) return null;
      if (/^(?:not\s+(?:supplied|stated|provided|available|found)|unknown(?:\s+location)?|n\/?a|none|null)$/i.test(location)) return null;
      return location.slice(0, 200);
    };

    const cleaned = {
      ...result.data,
      organisations: (result.data.organisations ?? [])
        .map((item) => ({ ...item, location: cleanLocation(item.location) }))
        .filter((item) => !!item.name && !!item.source_url && !!item.location),
      signals: (result.data.signals ?? [])
        .map((item) => ({ ...item, location: cleanLocation(item.location) }))
        .filter((item) => !!item.organisation && !!item.signal && !!item.source_url && !!item.location),
      tenders: (result.data.tenders ?? [])
        .map((item) => ({ ...item, location: cleanLocation(item.location) }))
        .filter((item) => !!item.title && !!item.issuer && !!item.source_url && !!item.location),
    };

    const response = { ...cleaned, modelUsed: result.modelUsed, usage: result.usage, researchedAt: new Date().toISOString() };
    await saveResearchRun(context.organizationId, {
      query: `${data.industry} · ${data.region} · ${data.focus}`,
      researchType: "industry",
      businessContext: data.businessContext,
      researchedAt: response.researchedAt,
      modelUsed: result.modelUsed,
      status: "completed",
      result: response,
    });
    return response;
  });


export const discoverSpaCompetitors = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    businessContext,
    region: z.string().min(2).max(120).default("Australia"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const profile = BUSINESS_CONTEXTS[data.businessContext];
    const capabilities = (await getCapabilityProfile(context.organizationId)) || capabilityText();

    type Discovery = {
      competitors: {
        name: string;
        website: string | null;
        location: string | null;
        category: "direct" | "adjacent" | "large-scale";
        why_competitor: string;
        overlap_areas: string[];
        source_urls: string[];
        positioning: string;
        moat_preview: string[];
        watch_signals: string[];
      }[];
      landscape_notes: string[];
    };

    const system = `You are SPA Intelligence mapping the current competitive landscape for ${profile.name}.
Identify genuine competitors and strategically relevant adjacent firms using current public sources.
Do not include Solar Power Australia, Solar Online Australia or ELMOFO themselves.
Do not treat a component manufacturer as a competitor unless it also competes for integrated customer projects.
Separate direct competitors from adjacent specialists and much larger-scale providers.
Every returned company must have at least one public source URL supporting why it belongs in the landscape.
Never invent market share, customers, contracts or capabilities.`;

    const prompt = `Business: ${profile.name}
Region: ${data.region}
Commercial lens: ${profile.lens}

KNOWN SPA CAPABILITY PROFILE:
${capabilities.slice(0, 12000)}

Discover the competitor landscape Brett should actually monitor.

Focus particularly on firms competing for one or more of:
- industrial and commercial solar
- remote and off-grid power
- relocatable or skid-mounted power systems
- mining and resources energy systems
- BESS and hybrid power
- solar plus storage integration
- remote industrial infrastructure power
- specialist custom renewable-energy engineering
- related Australian power-system integration work

Return JSON:
{
  "competitors": [
    {
      "name": "...",
      "website": "https://..." or null,
      "location": "City/State/Country" or best supported region,
      "category": "direct" | "adjacent" | "large-scale",
      "why_competitor": "evidence-based explanation",
      "overlap_areas": ["..."],
      "source_urls": ["https://..."],
      "positioning": "concise evidence-based market positioning",
      "moat_preview": ["1-3 defensible-advantage hypotheses, clearly tentative"],
      "watch_signals": ["specific things SPA should monitor about this competitor"]
    }
  ],
  "landscape_notes": ["..."]
}

Return 8 to 14 companies, prioritising relevance over fame.
A direct competitor should have meaningful overlap with SPA's actual offering.
An adjacent competitor may overlap only in a specialist niche.
A large-scale competitor can be substantially bigger than SPA but still compete for industrial, mining, microgrid or hybrid-power work.
Do not output a company without a source URL.`;

    const result = await openRouterResearch<Discovery>(context.organizationId, system, prompt);
    const clean = (result.data.competitors ?? [])
      .filter((item) => item?.name && Array.isArray(item.source_urls) && item.source_urls.length)
      .map((item) => ({
        name: String(item.name).trim().slice(0, 180),
        website: item.website ? String(item.website).trim().slice(0, 300) : null,
        location: item.location ? String(item.location).trim().slice(0, 200) : null,
        category: item.category === "adjacent" || item.category === "large-scale" ? item.category : "direct" as const,
        whyCompetitor: String(item.why_competitor ?? "").trim().slice(0, 1500),
        overlapAreas: Array.isArray(item.overlap_areas) ? item.overlap_areas.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 12) : [],
        sourceUrls: item.source_urls.map(String).map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x)).slice(0, 12),
        positioning: String(item.positioning ?? "").trim().slice(0, 1200),
        moatPreview: Array.isArray(item.moat_preview) ? item.moat_preview.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [],
        watchSignals: Array.isArray(item.watch_signals) ? item.watch_signals.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6) : [],
      }))
      .filter((item) => item.sourceUrls.length);

    const registry = await mergeCompetitorDiscovery(context.organizationId, clean);
    await saveResearchRun(context.organizationId, {
      query: `Competitor landscape · ${data.region}`,
      researchType: "competitor-discovery",
      businessContext: data.businessContext,
      researchedAt: new Date().toISOString(),
      modelUsed: result.modelUsed,
      status: "completed",
      result: { registry, landscapeNotes: result.data.landscape_notes ?? [] },
    });

    return {
      competitors: registry,
      landscapeNotes: result.data.landscape_notes ?? [],
      modelUsed: result.modelUsed,
      researchedAt: new Date().toISOString(),
    };
  });

export const analyseSpaCompetitor = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    competitorId: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const registry = await competitorRegistry(context.organizationId);
    const competitor = registry.find((item) => item.id === data.competitorId);
    if (!competitor) throw new Error("Competitor record not found.");

    const capabilities = (await getCapabilityProfile(context.organizationId)) || capabilityText();
    const domain = competitor.website ? normalizeQueryDomain(competitor.website) : null;
    const direct = await directWebsiteContext(domain);
    const directText = direct.pages.map((p) => `URL: ${p.url}\n${p.text}`).join("\n---\n").slice(0, 26000);

    type Analysis = {
      company: string;
      website: string | null;
      positioning: string;
      customer_segments: string[];
      geographic_focus: string[];
      overlap_with_spa: string[];
      delivery_model: string[];
      differentiators: { item: string; source_url: string; classification: string }[];
      moat_hypotheses: {
        moat: string;
        evidence: string;
        source_url: string | null;
        confidence: "HIGH" | "MEDIUM" | "LOW";
        classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "INFERENCE";
      }[];
      vulnerabilities_or_constraints: {
        item: string;
        evidence: string;
        source_url: string | null;
        classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "INFERENCE";
      }[];
      current_projects_or_signals: {
        item: string;
        source_url: string;
        evidence_date: string | null;
      }[];
      strategic_implications_for_spa: string[];
      questions_for_brett: string[];
      evidence: {
        statement: string;
        source_url: string;
        evidence_date: string | null;
        classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "INFERENCE";
      }[];
    };

    const system = `You are SPA Intelligence performing evidence-based competitor analysis for Solar Power Australia.
Analyse the competitor without simplistic winner/loser language.
A "moat" is a defensible advantage hypothesis, not a fact unless directly evidenced.
Separate OBSERVED_FACT, SOURCE_CLAIM and INFERENCE.
Never invent revenue, market share, customers, contracts, headcount, patents, proprietary technology or project wins.
Every substantive observed fact or source claim must have a public source URL.
Strategic implications may be analytical, but must be clearly framed as implications for Brett to consider.`;

    const prompt = `Competitor: ${competitor.name}
Known website: ${competitor.website ?? "(not stored)"}
Known category: ${competitor.category}
Why it was logged: ${competitor.whyCompetitor}
Known overlap: ${competitor.overlapAreas.join(", ") || "(not yet classified)"}
Discovery sources:
${competitor.sourceUrls.join("\n")}

SPA CAPABILITY PROFILE:
${capabilities.slice(0, 12000)}

DIRECT COMPETITOR WEBSITE RETRIEVAL STATUS: ${direct.status}
DIRECT WEBSITE MATERIAL:
${directText || "(none available, use current public web sources)"}

Return JSON containing:
company, website, positioning, customer_segments[], geographic_focus[], overlap_with_spa[], delivery_model[],
differentiators[], moat_hypotheses[], vulnerabilities_or_constraints[], current_projects_or_signals[],
strategic_implications_for_spa[], questions_for_brett[], evidence[].

For differentiators: item, source_url, classification.
For moat_hypotheses: moat, evidence, source_url or null, confidence HIGH/MEDIUM/LOW, classification OBSERVED_FACT/SOURCE_CLAIM/INFERENCE.
For vulnerabilities_or_constraints: item, evidence, source_url or null, classification.
For projects/signals: item, source_url, evidence_date where known.
Do not convert lack of evidence into a vulnerability.
Do not call something a moat merely because the company says it is good at it. Look for repeatable structural advantages such as installed base, vertically integrated capability, local manufacturing, long-term operating contracts, proprietary control systems, financing model, distribution reach, specialist certification, demonstrated remote-site track record, or switching costs, but only when supported or clearly labelled inference.`;

    const result = await openRouterResearch<Analysis>(context.organizationId, system, prompt);
    const response = {
      competitor,
      analysis: result.data,
      directRetrieval: direct,
      modelUsed: result.modelUsed,
      usage: result.usage,
      researchedAt: new Date().toISOString(),
    };

    await saveCompetitorAnalysis(context.organizationId, competitor.id, response);
    await saveResearchRun(context.organizationId, {
      query: competitor.name,
      researchType: "competitor-analysis",
      businessContext: "spa",
      researchedAt: response.researchedAt,
      modelUsed: result.modelUsed,
      status: direct.status === "ok" ? "completed" : "partial",
      result: response,
    });

    return response;
  });


export const researchSpaIndustryStaged = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    industry: z.string().min(2).max(200),
    region: z.string().min(2).max(200).default("Australia"),
    focus: z.string().min(2).max(300),
    businessContext,
    purpose: z.enum(["industry","opportunity-radar"]).default("industry"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const profile = BUSINESS_CONTEXTS[data.businessContext];
    const capabilities = (await getCapabilityProfile(context.organizationId)) || capabilityText();

    type Discovery = {
      organisations: {
        name: string;
        website: string | null;
        location: string | null;
        why_relevant: string;
        source_url: string;
      }[];
      tenders: {
        title: string;
        issuer: string;
        reference: string | null;
        closing_date: string | null;
        location: string | null;
        source_url: string;
        why_relevant: string;
      }[];
      external_signals: {
        organisation: string;
        signal: string;
        location: string | null;
        evidence_date: string | null;
        source_url: string;
      }[];
    };

    const discovery = await openRouterResearch<Discovery>(
      context.organizationId,
      `You are the discovery stage of SPA Intelligence for ${profile.name}.
Find real, current organisations, documented project signals and procurement notices using current public web sources.
This stage is discovery only. Keep it concise.
Never invent companies, websites, projects, tenders, dates or locations.
Every item needs a public source URL.
Prefer primary company, government, procurement, project-owner and reputable industry sources.`,
      `Industry: ${data.industry}
Region: ${data.region}
Opportunity focus: ${data.focus}
Business lens: ${profile.lens}

Find:
- 8 to 12 organisations that are genuinely relevant.
- up to 8 current external project / expansion / energy / infrastructure signals.
- up to 5 documented tenders or procurement notices, only if actually found.

Return JSON:
{
  "organisations":[{"name":"","website":"https://..."|null,"location":"","why_relevant":"","source_url":"https://..."}],
  "external_signals":[{"organisation":"","signal":"","location":"","evidence_date":null,"source_url":"https://..."}],
  "tenders":[{"title":"","issuer":"","reference":null,"closing_date":null,"location":"","source_url":"https://...","why_relevant":""}]
}

Do not perform long strategic analysis in this stage. Discovery and evidence only.`,
    );

    const rawCandidates = (discovery.data.organisations ?? [])
      .filter((x) => x?.name && x?.source_url)
      .slice(0, 12);

    const verified = await Promise.all(
      rawCandidates.map(async (item) => {
        const domain = item.website ? normalizeQueryDomain(item.website) : null;
        if (!domain) return null;
        const direct = await directWebsiteContext(domain);
        if (direct.status !== "ok" || !direct.pages.length) return null;
        return {
          ...item,
          website: item.website || `https://${domain}`,
          directPages: direct.pages.slice(0, 6),
        };
      }),
    );

    const verifiedOrgs = verified.filter(Boolean) as Array<{
      name: string;
      website: string | null;
      location: string | null;
      why_relevant: string;
      source_url: string;
      directPages: { url: string; text: string }[];
    }>;

    type Synthesis = {
      organisations: { name: string; website: string | null; location: string | null; why_relevant: string; source_url: string }[];
      signals: { organisation: string; signal: string; location: string | null; evidence_date: string | null; source_url: string; spa_fit: string; classification: string }[];
      market_notes: string[];
    };

    const directCorpus = verifiedOrgs.map((org) => [
      `ORGANISATION: ${org.name}`,
      `KNOWN WEBSITE: ${org.website ?? ""}`,
      `DISCOVERY SOURCE: ${org.source_url}`,
      `DISCOVERY RELEVANCE: ${org.why_relevant}`,
      ...org.directPages.map((p) => `URL: ${p.url}\n${p.text}`),
    ].join("\n")).join("\n---\n").slice(0, 60000);

    const externalSignals = (discovery.data.external_signals ?? [])
      .filter((x) => x?.organisation && x?.signal && /^https?:\/\//i.test(String(x.source_url ?? "")))
      .slice(0, 8);

    const synthesis = await aiJsonForOrg<Synthesis>(
      context.organizationId,
      `You are the evidence-synthesis stage of SPA Intelligence for ${profile.name}.
Use the verified company website material plus the separately supplied web-discovery evidence.
Do not invent anything.
A company website statement is a SOURCE_CLAIM unless the text directly establishes the fact.
Commercial fit is analysis, not fact.
Keep factual evidence and SPA fit separate.`,
      `Industry: ${data.industry}
Region: ${data.region}
Focus: ${data.focus}

SPA CAPABILITY PROFILE:
${capabilities.slice(0, 12000)}

VERIFIED LIVE COMPANY MATERIAL:
${directCorpus || "(No candidate websites passed verification.)"}

EXTERNAL CURRENT SIGNALS FROM WEB DISCOVERY:
${JSON.stringify(externalSignals)}

Return JSON:
{
  "organisations":[{"name":"","website":"https://..."|null,"location":"","why_relevant":"","source_url":"https://..."}],
  "signals":[{"organisation":"","signal":"","location":"","evidence_date":null,"source_url":"https://...","spa_fit":"","classification":"OBSERVED_FACT|SOURCE_CLAIM|INFERENCE"}],
  "market_notes":["..."]
}

Rules:
- Only return organisations whose public website was included in VERIFIED LIVE COMPANY MATERIAL.
- Use the organisation's website or the strongest discovery source as source_url.
- For signals, preserve exact external source URLs when using external signals.
- You may also identify signals visible on the verified company websites.
- spa_fit must be framed as potential fit, not an assertion that the organisation needs SPA.
- Do not invent contact people, budgets, contract values or equipment requirements.`,
      "medium",
    );

    const cleanLocation = (value: unknown): string | null => {
      const location = typeof value === "string" ? value.trim() : "";
      if (!location || /^(?:unknown|n\/?a|none|null|not\s+(?:stated|found|available|supplied|provided))$/i.test(location)) return null;
      return location.slice(0, 200);
    };

    const allowedWebsites = new Set(
      verifiedOrgs.flatMap((x) => [x.website, ...x.directPages.map((p) => p.url)]).filter(Boolean) as string[],
    );
    const allowedDiscoverySources = new Set(rawCandidates.map((x) => x.source_url).filter(Boolean));
    const allowedSignalSources = new Set(externalSignals.map((x) => x.source_url).filter(Boolean));
    const allowedOrgHosts = new Set(
      verifiedOrgs.flatMap((x) => [x.website, ...x.directPages.map((p) => p.url)])
        .map((url) => url ? hostOf(url) : null)
        .filter(Boolean) as string[],
    );
    const allowedDiscoveryHosts = new Set(
      rawCandidates.map((x) => hostOf(x.source_url)).filter(Boolean) as string[],
    );

    const organisations = (synthesis.organisations ?? [])
      .map((x) => ({
        ...x,
        location: cleanLocation(x.location),
        source_url: String(x.source_url ?? ""),
      }))
      .filter((x) => {
        const sourceHost = hostOf(x.source_url);
        const websiteHost = x.website ? hostOf(x.website) : null;
        return !!x.name && !!x.website && !!x.location && !!websiteHost && allowedOrgHosts.has(websiteHost) &&
          (allowedWebsites.has(x.source_url) || allowedDiscoverySources.has(x.source_url) || (!!sourceHost && (allowedOrgHosts.has(sourceHost) || allowedDiscoveryHosts.has(sourceHost))));
      })
      .slice(0, 10);

    const signals = (synthesis.signals ?? [])
      .map((x) => ({ ...x, location: cleanLocation(x.location), source_url: String(x.source_url ?? "") }))
      .filter((x) => {
        const sourceHost = hostOf(x.source_url);
        return !!x.organisation && !!x.signal && !!x.location && !!x.source_url && (
          allowedSignalSources.has(x.source_url) ||
          allowedWebsites.has(x.source_url) ||
          allowedDiscoverySources.has(x.source_url) ||
          (!!sourceHost && (allowedOrgHosts.has(sourceHost) || allowedDiscoveryHosts.has(sourceHost)))
        );
      })
      .slice(0, 12);

    const tenders = (discovery.data.tenders ?? [])
      .map((x) => ({
        title: String(x.title ?? "").trim(),
        issuer: String(x.issuer ?? "").trim(),
        reference: x.reference ? String(x.reference).trim() : null,
        closing_date: x.closing_date ? String(x.closing_date).trim() : null,
        location: cleanLocation(x.location),
        source_url: String(x.source_url ?? "").trim(),
        spa_fit: String(x.why_relevant ?? "").trim(),
      }))
      .filter((x) => x.title && x.issuer && x.location && /^https?:\/\//i.test(x.source_url))
      .slice(0, 5);

    const response = {
      organisations,
      signals,
      tenders,
      market_notes: synthesis.market_notes ?? [],
      modelUsed: discovery.modelUsed,
      synthesisModelUsed: "workspace-selected",
      researchedAt: new Date().toISOString(),
      verification: {
        discoveredOrganisations: rawCandidates.length,
        verifiedLiveOrganisations: verifiedOrgs.length,
      },
    };

    await saveResearchRun(context.organizationId, {
      query: `${data.industry} · ${data.region} · ${data.focus}`,
      researchType: data.purpose === "opportunity-radar" ? "opportunity-radar" : "industry-staged",
      businessContext: data.businessContext,
      researchedAt: response.researchedAt,
      modelUsed: discovery.modelUsed,
      status: verifiedOrgs.length ? "completed" : "partial",
      result: response,
    });

    return response;
  });

export const researchSpaVentureStaged = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    query: z.string().min(2).max(500),
    businessContext: z.literal("elmofo").default("elmofo"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const domain = normalizeQueryDomain(data.query);
    const direct = await directWebsiteContext(domain);
    const capabilities = (await getCapabilityProfile(context.organizationId)) || capabilityText();
    const directText = direct.pages.map((p) => `URL: ${p.url}\n${p.text}`).join("\n---\n").slice(0, 32000);

    type External = {
      organisation: string;
      official_website: string | null;
      current_signals: { item: string; source_url: string; evidence_date: string | null }[];
      people: { name: string; title: string; source_url: string }[];
      partnerships: { item: string; source_url: string; evidence_date: string | null }[];
    };

    const external = await openRouterResearch<External>(
      context.organizationId,
      `You are the current-web discovery stage for ELMOFO / Brett Sutherland innovation intelligence.
Research the named venture, company or technology target using current public sources.
Focus on EV engineering, electrification, battery systems, prototype engineering, motorsport technology, specialist manufacturing, partnerships and commercialisation.
Never invent people, partnerships, projects, dates or technology claims.`,
      `Target: ${data.query}
Return concise JSON:
{
  "organisation":"",
  "official_website":"https://..."|null,
  "current_signals":[{"item":"","source_url":"https://...","evidence_date":null}],
  "people":[{"name":"","title":"","source_url":"https://..."}],
  "partnerships":[{"item":"","source_url":"https://...","evidence_date":null}]
}
Every returned item needs a public source URL.`,
    );

    type Venture = {
      organisation: string;
      official_website: string | null;
      industry: string | null;
      locations: string[];
      what_the_company_does: string;
      current_projects: { item: string; source_url: string; evidence_date: string | null; classification: string }[];
      recent_developments: { item: string; source_url: string; evidence_date: string | null; classification: string }[];
      energy_power_infrastructure_context: string[];
      capability_matches: { capability: string; provenance: "CONFIRMED" | "LIKELY / ADJACENT" | "NEEDS VERIFICATION"; rationale: string; classification: string }[];
      opportunity_hypotheses: { hypothesis: string; why_now: string; source_url: string | null; classification: "INFERENCE" | "COMMERCIAL_HYPOTHESIS"; validation_needed: string }[];
      people: { name: string; title: string; contact: string | null; source_url: string; classification: string }[];
      tenders: { title: string; reference: string | null; closing_date: string | null; source_url: string; classification: string }[];
      risks_unknowns: string[];
      questions_spa_should_ask: string[];
      possible_first_approach: string;
      follow_up_strategy: string;
      next_action: string;
      evidence: { statement: string; source_url: string; evidence_date: string | null; classification: "OBSERVED_FACT" | "SOURCE_CLAIM" | "INFERENCE" | "COMMERCIAL_HYPOTHESIS" | "UNKNOWN" }[];
    };

    const dossier = await aiJsonForOrg<Venture>(
      context.organizationId,
      `You are the synthesis stage of SPA Intelligence working under the ELMOFO innovation lens.
Use direct website evidence plus separately collected current public-web evidence.
Separate OBSERVED_FACT, SOURCE_CLAIM, INFERENCE, COMMERCIAL_HYPOTHESIS and UNKNOWN.
Do not make generic solar assumptions unless the evidence actually connects the target to solar.
Do not invent people, contacts, customers, projects or technical capabilities.`,
      `Target: ${data.query}

DIRECT WEBSITE RETRIEVAL STATUS: ${direct.status}
DIRECT WEBSITE MATERIAL:
${directText || "(No direct website material available.)"}

CURRENT EXTERNAL WEB EVIDENCE:
${JSON.stringify(external.data)}

SPA / ELMOFO CAPABILITY CONTEXT:
${capabilities.slice(0, 12000)}

Return the same evidence-rich JSON dossier shape used by SPA Intelligence:
organisation, official_website, industry, locations, what_the_company_does,
current_projects[], recent_developments[], energy_power_infrastructure_context[],
capability_matches[], opportunity_hypotheses[], people[], tenders[],
risks_unknowns[], questions_spa_should_ask[], possible_first_approach,
follow_up_strategy, next_action, evidence[].

Every factual item must point to an exact URL from the supplied direct material or external evidence.
Commercial hypotheses must be labelled as such.`,
      "medium",
    );

    const response = {
      query: data.query,
      businessContext: "elmofo",
      mode: "venture",
      directRetrieval: direct,
      dossier,
      modelUsed: external.modelUsed,
      researchedAt: new Date().toISOString(),
    };

    await saveResearchRun(context.organizationId, {
      query: data.query,
      researchType: "venture-staged",
      businessContext: "elmofo",
      researchedAt: response.researchedAt,
      modelUsed: external.modelUsed,
      status: direct.status === "ok" ? "completed" : "partial",
      result: response,
    });

    return response;
  });
