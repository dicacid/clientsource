import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { fetchPage, htmlToText, hostOf, rankedLinks } from "@/lib/prospect/web.server";
import { BUSINESS_CONTEXTS, capabilityText } from "./capabilities";
import { diagnosePublicPage } from "./fetch-diagnostic.server";
import { getAiRuntime } from "./openrouter.server";
import { getCapabilityProfile, saveResearchRun } from "./store.server";

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number | string };

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/, "").trim();
  try { return JSON.parse(cleaned) as T; } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1)) as T;
    throw new Error("The selected model returned an unreadable response.");
  }
}

async function openRouterResearch<T>(orgId: string, system: string, user: string): Promise<{ data: T; modelUsed: string; usage: Usage | null }> {
  const runtime = await getAiRuntime(orgId);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + runtime.apiKey,
        "X-Title": "SPA Intelligence",
      },
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          { role: "system", content: system + "\nReturn exactly one JSON object. No markdown fences." },
          { role: "user", content: user },
        ],
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
  return {
    data: parseJson<T>(String(content)),
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
