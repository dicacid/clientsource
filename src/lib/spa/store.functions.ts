import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { approvalItems, changeApprovalState, competitorRegistry, createApprovalItem, getCapabilityProfile, removeCompetitor, researchHistory, saveCapabilityProfile } from "./store.server";

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

export const deleteCompetitor = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => removeCompetitor(context.organizationId, data.id));
