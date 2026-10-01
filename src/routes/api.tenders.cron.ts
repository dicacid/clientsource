import { createFileRoute } from "@tanstack/react-router";
import { organizationIdsForInternalJobs } from "@/integrations/render/state.server";
import { runTenderScan } from "@/lib/spa/tender.server";

export const Route = createFileRoute("/api/tenders/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configured = process.env["TENDER_CRON_SECRET"];
        if (!configured) {
          return Response.json({ ok: false, error: "Tender cron secret is not configured." }, { status: 503 });
        }
        if (request.headers.get("x-tender-cron-secret") !== configured) {
          return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
        }

        const organizationIds = await organizationIdsForInternalJobs();
        const results = [];
        for (const organizationId of organizationIds) {
          results.push(await runTenderScan(organizationId));
        }

        return Response.json({
          ok: true,
          organizationsScanned: organizationIds.length,
          scans: results.map((run) => ({
            id: run.id,
            state: run.state,
            newTenders: run.newTenders,
            updatedTenders: run.updatedTenders,
            sourceSuccesses: run.sourceSuccesses,
            sourceFailures: run.sourceFailures,
            errors: run.errors,
          })),
        });
      },
    },
  },
});
