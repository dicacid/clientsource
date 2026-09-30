import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export function ResearchProgress({ detail }: { detail?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="status" aria-live="polite" className="border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium"><LoaderCircle className="h-4 w-4 animate-spin text-primary" />Research in progress</div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{elapsed}s elapsed</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-muted" aria-hidden="true"><div className="h-full w-full animate-pulse bg-primary/60" /></div>
      <p className="mt-3 text-xs text-muted-foreground">{detail ?? "Waiting for the research provider to return its evidence."}</p>
      {elapsed >= 90 && <p className="mt-2 text-xs text-muted-foreground">The request is still running. Larger research requests can take several minutes, including automatic retries.</p>}
    </div>
  );
}
