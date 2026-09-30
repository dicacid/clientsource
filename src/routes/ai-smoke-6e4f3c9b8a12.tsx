import { createFileRoute } from "@tanstack/react-router";
import { aiJson, aiProvider } from "@/lib/prospect/ai.server";

export const Route = createFileRoute("/ai-smoke-6e4f3c9b8a12")({
  loader: async () => {
    const result = await aiJson<{ ok: boolean; message: string }>(
      "You are a connectivity test. Return exactly the requested JSON object.",
      'Return {"ok":true,"message":"openrouter-live"}',
      "low",
    );
    return { provider: aiProvider(), result };
  },
  component: AiSmokePage,
});

function AiSmokePage() {
  const data = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>AI smoke test</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
