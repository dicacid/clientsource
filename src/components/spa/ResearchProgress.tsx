import { useEffect, useMemo, useState } from "react";

const STAGES = [
  { at: 0, label: "Preparing research request" },
  { at: 4, label: "Searching current public sources" },
  { at: 16, label: "Reading organisations, projects and signals" },
  { at: 34, label: "Matching evidence against SPA capabilities" },
  { at: 58, label: "Separating sourced facts from inference" },
  { at: 82, label: "Assembling the research result" },
];

export function ResearchProgress({ detail }: { detail?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const stage = useMemo(
    () => [...STAGES].reverse().find((item) => elapsed >= item.at) ?? STAGES[0],
    [elapsed],
  );

  // This is deliberately an activity estimate, not a claim that the upstream
  // research provider reports exact percentage completion.
  const progress = Math.min(94, Math.round(8 + 86 * (1 - Math.exp(-elapsed / 45))));

  return (
    <div className="border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            Live research
          </div>
          <div className="mt-1 text-sm font-medium">{stage.label}</div>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {elapsed}s elapsed
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-2 flex items-start justify-between gap-4 text-[11px] text-muted-foreground">
        <span>{detail ?? "Current public-web research and evidence validation are running."}</span>
        <span className="shrink-0 font-mono">{progress}% activity</span>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground/70">
        Progress is an activity estimate while external research runs, not a provider-reported completion percentage.
      </p>
    </div>
  );
}
