import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { runRenderSmokeTest } from "@/integrations/render/state.server";

const smoke = createServerFn({ method: "GET" }).handler(() => runRenderSmokeTest());

export const Route = createFileRoute("/render-smoke-9c5f4c")({
  loader: () => smoke(),
  component: SmokeResult,
});

function SmokeResult() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
