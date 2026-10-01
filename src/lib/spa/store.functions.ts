import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { approvalItems, changeApprovalState, competitorRegistry, createApprovalItem, getCapabilityProfile, mergeCompetitorDiscovery, removeCompetitor, researchHistory, saveCapabilityProfile } from "./store.server";

const states = [
  "DETECTED","RESEARCHED","QUALIFIED","PREPARED","AWAITING APPROVAL","NEEDS CHANGES",
  "APPROVED","ACTIONED","FOLLOW-UP DUE","WON","LOST","NO BID","ARCHIVED",
] as const;

export const getResearchHistory = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => researchHistory(context.organizationId));

export const getApprovalItems = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => approvalItems(context.organizationId));

export const addApprovalItem = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    title: z.string().min(1).max(240),
    kind: z.string().min(1).max(80),
    payload: z.unknown(),
  }).parse(d))
  .handler(async ({ context, data }) => createApprovalItem(context.organizationId, data.title, data.kind, data.payload));

export const setApprovalState = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), state: z.enum(states) }).parse(d))
  .handler(async ({ context, data }) => changeApprovalState(context.organizationId, data.id, data.state));


export const getSpaCapabilityProfile = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => getCapabilityProfile(context.organizationId));

export const setSpaCapabilityProfile = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ profile: z.string().min(1).max(16000) }).parse(d))
  .handler(async ({ context, data }) => ({ profile: await saveCapabilityProfile(context.organizationId, data.profile) }));


export const getCompetitorRegistry = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => competitorRegistry(context.organizationId));

export const addCompetitor = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    name: z.string().max(180).optional().default(""),
    website: z.string().max(300).optional().default(""),
    category: z.enum(["direct", "adjacent", "large-scale"]).default("direct"),
    whyCompetitor: z.string().max(1500).optional().default(""),
    overlapAreas: z.array(z.string().max(180)).max(12).optional().default([]),
    sourceUrls: z.array(z.string().max(500)).max(12).optional().default([]),
    positioning: z.string().max(1200).optional().default(""),
    moatPreview: z.array(z.string().max(300)).max(4).optional().default([]),
    watchSignals: z.array(z.string().max(300)).max(6).optional().default([]),
  }).refine((x) => !!x.name.trim() || !!x.website.trim(), {
    message: "Enter a competitor name or website.",
  }).parse(d))
  .handler(async ({ context, data }) => {
    let website: string | null = null;
    if (data.website.trim()) {
      const raw = data.website.trim();
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new Error("Enter a valid competitor website or domain.");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Competitor website must use http or https.");
      }
      website = parsed.origin;
    }

    const name = data.name.trim() || (website ? new URL(website).hostname.replace(/^www\./i, "") : "");
    if (!name) throw new Error("Enter a competitor name or website.");

    const sourceUrls = [...new Set([
      ...(website ? [website] : []),
      ...data.sourceUrls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)),
    ])].slice(0, 12);

    return mergeCompetitorDiscovery(context.organizationId, [{
      name: name.slice(0, 180),
      website,
      location: null,
      category: data.category,
      whyCompetitor: (data.whyCompetitor.trim() || "Added manually to the competitor watchlist for investigation.").slice(0, 1500),
      overlapAreas: data.overlapAreas.map((x) => x.trim()).filter(Boolean).slice(0, 12),
      sourceUrls,
      positioning: data.positioning.trim().slice(0, 1200),
      moatPreview: data.moatPreview.map((x) => x.trim()).filter(Boolean).slice(0, 4),
      watchSignals: data.watchSignals.map((x) => x.trim()).filter(Boolean).slice(0, 6),
    }]);
  });


export const deleteCompetitor = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => removeCompetitor(context.organizationId, data.id));
