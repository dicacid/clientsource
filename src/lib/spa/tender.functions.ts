import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import {
  runTenderScan,
  saveTenderNotes,
  setTenderWorkflow,
  tenderAudits,
  tenderById,
  tenderRecords,
  tenderScanState,
} from "./tender.server";

const WORKFLOW_STATES = [
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

export const getTenderRecords = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => tenderRecords(context.organizationId));

export const getTenderRecord = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const record = await tenderById(context.organizationId, data.id);
    if (!record) throw new Error("Tender not found.");
    return record;
  });

export const getTenderAudits = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => tenderAudits(context.organizationId));

export const getTenderScanState = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => tenderScanState(context.organizationId));

export const startTenderScan = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => runTenderScan(context.organizationId));

export const updateTenderWorkflow = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    workflowStatus: z.enum(WORKFLOW_STATES),
  }).parse(d))
  .handler(async ({ context, data }) =>
    setTenderWorkflow(context.organizationId, data.id, data.workflowStatus)
  );

export const updateTenderNotes = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    notes: z.string().max(12000),
  }).parse(d))
  .handler(async ({ context, data }) =>
    saveTenderNotes(context.organizationId, data.id, data.notes)
  );
