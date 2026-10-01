import { createFileRoute } from "@tanstack/react-router";
import { organizationIdsForTenderScan, runTenderScan } from "@/lib/spa/tenders.server";

function authorised(request: Request): boolean {
  const secret = process.env["TENDER_CRON_SECRET"];
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  const direct = request.headers.get("x-tender-cron-secret");
  return auth === "Bearer " + secret || direct === secret;
}

export const Route = createFileRoute("/api/tenders/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env["TENDER_CRON_SECRET"]) {
          return Response.json({ error: "Tender cron is not configured." }, { status: 503 });
        }
        if (!authorised(request)) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        const organizationIds = await organizationIdsForTenderScan();
        const results: Array<{ organizationId: string; status: string; runId?: string; error?: string }> = [];
        for (const organizationId of organizationIds) {
          try {
            const audit = await runTenderScan(organizationId, "scheduled");
            results.push({ organizationId, status: audit.status, runId: audit.id });
          } catch (error) {
            results.push({
              organizationId,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return Response.json({
          ranAt: new Date().toISOString(),
          organizations: results.length,
          results,
        }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
