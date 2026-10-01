import { createFileRoute } from "@tanstack/react-router";
import { tenderSourceHealth } from "@/lib/spa/tender-sources.server";

export const Route = createFileRoute("/api/tenders/source-health")({
  server: {
    handlers: {
      GET: async () => {
        const result = await tenderSourceHealth();
        return Response.json(result, {
          status: result.overall === "failed" ? 503 : 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
