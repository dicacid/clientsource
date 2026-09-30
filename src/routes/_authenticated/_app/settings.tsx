import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, CheckCircle2, Info } from "lucide-react";
import { getAiStatus } from "@/lib/settings.functions";
import { PageHeader } from "@/components/crm/shared";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — Pipeline" },
      { name: "description", content: "Workspace settings: AI provider and API key status." },
      { property: "og:title", content: "Settings — Pipeline" },
      { property: "og:description", content: "Workspace settings: AI provider and API key status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function SettingsPage() {
  const fetchStatus = useServerFn(getAiStatus);
  const { data, isLoading, error } = useQuery({ queryKey: ["ai-status"], queryFn: () => fetchStatus() });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" sub="Workspace configuration" />

      <section className="rounded-lg border p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI provider</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Powers the Prospect finder: website analysis, company discovery and email drafting.
        </p>

        {isLoading && <p className="mt-4 text-sm text-muted-foreground">Checking…</p>}
        {error && <p className="mt-4 text-sm text-destructive">Could not load AI status.</p>}

        {data && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-chart-3" />
              {data.provider === "openrouter" ? (
                <span>
                  Using <strong>OpenRouter</strong> — model <code className="font-mono text-xs">{data.model}</code>.
                </span>
              ) : (
                <span>
                  <strong>OpenRouter is not configured.</strong> Add <code className="font-mono text-xs">OPENROUTER_API_KEY</code> to the Render service to enable Prospect finder AI.
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                The OpenRouter key is held only in the Render service environment and is never sent to the browser.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
