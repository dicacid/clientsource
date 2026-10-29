import { createFileRoute } from "@tanstack/react-router";
import { scanLiveEnergyTenders } from "@/lib/energy/tenders";

export const Route = createFileRoute("/api/energy/tenders")({
  server: {
    handlers: {
      GET: async () => {
        const data = await scanLiveEnergyTenders();
        return Response.json(data, {
          status: data.checks.some((s) => s.status === "parsed") ? 200 : 503,
          headers: { "Cache-Control": "private, no-store" },
        });
      },
    },
  },
});
