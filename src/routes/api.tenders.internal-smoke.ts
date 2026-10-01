import { createFileRoute } from "@tanstack/react-router";
import { organizationIdsForInternalJobs } from "@/integrations/render/state.server";
import { runTenderScan, tenderRecords } from "@/lib/spa/tender.server";

export const Route = createFileRoute("/api/tenders/internal-smoke")({
  server: {
    handlers: {
      GET: async () => {
        if (process.env["TENDER_SMOKE_ENABLED"] !== "1") {
          return Response.json({ ok: false }, { status: 404 });
        }

        const organizationIds = await organizationIdsForInternalJobs();
        const results = [];
        for (const organizationId of organizationIds) {
          const run = await runTenderScan(organizationId);
          const records = await tenderRecords(organizationId);
          results.push({
            organizationId,
            run: {
              id: run.id,
              state: run.state,
              sourcesAttempted: run.sourcesAttempted,
              sourceSuccesses: run.sourceSuccesses,
              sourceFailures: run.sourceFailures,
              opportunitiesDiscovered: run.opportunitiesDiscovered,
              duplicatesRemoved: run.duplicatesRemoved,
              newTenders: run.newTenders,
              updatedTenders: run.updatedTenders,
              unchangedTenders: run.unchangedTenders,
              aiEnrichments: run.aiEnrichments,
              errors: run.errors,
            },
            records: records.map((record) => ({
              id: record.id,
              title: record.tenderTitle,
              issuer: record.issuer,
              referenceNumber: record.referenceNumber,
              sourceName: record.sourceName,
              workflowStatus: record.workflowStatus,
              closing: record.normalizedCloseTimestamp,
              relevanceScore: record.relevanceScore,
            })),
          });
        }

        return Response.json({ ok: true, results }, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
