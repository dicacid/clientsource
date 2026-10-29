import { createFileRoute } from "@tanstack/react-router";
import { collectLivePolicyPulse } from "@/lib/energy/market";

export const Route = createFileRoute("/api/energy/pulse")({
  server: {
    handlers: {
      GET: async () => {
        const pulse = await collectLivePolicyPulse();
        const status = pulse.checks.some((c) => c.status === "verified") ? 200 : 503;
        return Response.json({ ...pulse, live: pulse.signals.length > 0, note: "Only matching official source content is shown as verified. Data is refreshed on request and cached for at most two minutes. This is not a comprehensive regulatory database." }, {
          status,
          headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" },
        });
      },
    },
  },
});
