import { createFileRoute } from "@tanstack/react-router";
import { healthCheck } from "@/lib/health.functions";

export const Route = createFileRoute("/health")({
  loader: () => healthCheck(),
  component: HealthPage,
});

function HealthPage() {
  const data = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>ClientSource health</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
