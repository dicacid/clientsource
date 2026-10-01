import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireRenderMember } from "@/integrations/render/auth-middleware";
import { createApprovalItem } from "./store.server";
import {
  runTenderScan,
  setTenderNotes,
  setTenderWorkflowStatus,
  tenderProgress,
  tenderRecord,
  tenderRecords,
  tenderScanRuns,
} from "./tenders.server";

const tenderStatuses = [
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
    const record = await tenderRecord(context.organizationId, data.id);
    if (!record) throw new Error("Tender not found.");
    return record;
  });

export const runTenderScanNow = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => runTenderScan(context.organizationId, "manual"));

export const getTenderScanProgress = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => tenderProgress(context.organizationId));

export const getTenderScanRuns = createServerFn({ method: "GET" })
  .middleware([requireRenderMember])
  .handler(async ({ context }) => tenderScanRuns(context.organizationId));

export const updateTenderWorkflowStatus = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status: z.enum(tenderStatuses),
  }).parse(d))
  .handler(async ({ context, data }) =>
    setTenderWorkflowStatus(context.organizationId, data.id, data.status)
  );

export const updateTenderNotes = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    notes: z.string().max(12000),
  }).parse(d))
  .handler(async ({ context, data }) =>
    setTenderNotes(context.organizationId, data.id, data.notes)
  );

export const queueTenderActionApproval = createServerFn({ method: "POST" })
  .middleware([requireRenderMember])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    action: z.string().min(2).max(240),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const tender = await tenderRecord(context.organizationId, data.id);
    if (!tender) throw new Error("Tender not found.");
    return createApprovalItem(
      context.organizationId,
      tender.title + " — " + data.action,
      "tender-external-action",
      {
        tenderId: tender.id,
        tenderTitle: tender.title,
        issuer: tender.issuer,
        referenceNumber: tender.referenceNumber,
        sourceUrl: tender.canonicalSourceUrl,
        requestedAction: data.action,
        guardrail: "No external contact, submission or commercial commitment may occur until separately approved.",
      },
    );
  });
