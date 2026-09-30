import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntelligenceResult } from "@/components/spa/IntelligenceResult";
import { getResearchHistory } from "@/lib/spa/store.functions";

export const Route = createFileRoute("/_authenticated/_app/prospects")({
  head: () => ({ meta: [{ title: "Saved Opportunities & Research History — SPA Intelligence" }] }),
  component: ResearchHistory,
});

function ResearchHistory() {
  const getHistory = useServerFn(getResearchHistory);
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try { setRows(await getHistory()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Persistent intelligence record</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Saved Opportunities & Research History</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Completed company, competitor, venture and industry research is retained so Brett does not need to repeat the same investigation unnecessarily.</p>
        </div>
        <Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </header>

      {error && <div className="mb-4 border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {!rows.length ? (
        <div className="grid min-h-56 place-items-center border border-dashed border-border p-8 text-center">
          <div><Archive className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-3 font-semibold">No research history yet</h2><p className="mt-2 text-sm text-muted-foreground">A completed live research run will appear here automatically.</p></div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <div className="max-h-[75vh] overflow-auto border border-border bg-card divide-y divide-border">
            {rows.map((row) => <button key={row.id} onClick={() => setSelected(row)} className={`w-full p-4 text-left hover:bg-muted/40 ${selected?.id === row.id ? "bg-primary/5" : ""}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] uppercase text-primary">{row.researchType}</span><span className="font-mono text-[9px] uppercase text-muted-foreground">{row.status}</span></div>
              <div className="mt-1 line-clamp-2 text-sm font-medium">{row.query}</div>
              <div className="mt-2 font-mono text-[9px] text-muted-foreground">{new Date(row.researchedAt).toLocaleString()}</div>
              <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{row.modelUsed}</div>
            </button>)}
          </div>

          <div>
            {selected?.result?.dossier ? <IntelligenceResult result={selected.result} title="Recovered research dossier" /> : selected ? (
              <div className="border border-border bg-card p-5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-primary">{selected.researchType}</div>
                <h2 className="mt-1 text-xl font-semibold">{selected.query}</h2>
                <pre className="mt-4 max-h-[65vh] overflow-auto whitespace-pre-wrap border border-border bg-background p-4 text-xs">{JSON.stringify(selected.result, null, 2)}</pre>
              </div>
            ) : <div className="grid min-h-56 place-items-center border border-dashed border-border p-8 text-sm text-muted-foreground">Select a stored research run.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
