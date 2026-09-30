import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity, Archive, Building2, Factory, Lightbulb, LogOut, Moon, Radar,
  Settings, ShieldCheck, Sun, Target,
} from "lucide-react";
import { resolveMembership, signOut } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async () => {
    const r = await resolveMembership();
    if (r.state !== "member") throw redirect({ to: "/onboarding" });
    return { membership: r.membership };
  },
  component: AppLayout,
});

const PRIMARY = [
  { to: "/dashboard", label: "Opportunity Radar", icon: Radar },
  { to: "/prospect", label: "Prospects", icon: Target },
  { to: "/contacts", label: "Industries", icon: Factory },
  { to: "/companies", label: "Competitors", icon: Building2 },
  { to: "/import", label: "Ventures & Innovation", icon: Lightbulb },
] as const;

const SECONDARY = [
  { to: "/prospects", label: "Saved Opportunities", icon: Archive },
  { to: "/members", label: "Approval Queue", icon: ShieldCheck },
  { to: "/settings", label: "AI & Models", icon: Settings },
] as const;

function AppLayout() {
  const { membership } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("spa-intelligence.theme");
    const next = stored === "light" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.classList.toggle("light", next === "light");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("spa-intelligence.theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.classList.toggle("light", next === "light");
  }

  async function out() {
    await signOut(qc);
    navigate({ to: "/auth", replace: true });
  }

  const NavGroup = ({ items }: { items: readonly { to: any; label: string; icon: any }[] }) => (
    <nav className="space-y-1">
      {items.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className="group flex items-center gap-2 border-l-2 border-transparent px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground"
          activeProps={{ className: "border-l-2 border-primary bg-sidebar-accent text-sidebar-foreground font-medium" }}
        >
          <n.icon className="h-4 w-4 shrink-0" />
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside className="border-b border-sidebar-border bg-sidebar md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-sidebar-border px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center bg-white p-1">
              <img
                src="https://solarpoweraustralia.com.au/wp-content/uploads/2021/05/Solar-power-footer-logo.svg"
                alt="Solar Power Australia"
                className="max-h-full max-w-full"
              />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">SPA Intelligence</div>
              <div className="truncate text-xs text-sidebar-foreground/70">Solar Power Australia</div>
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto p-2 md:block md:overflow-visible md:p-3">
          <div className="min-w-max md:min-w-0"><NavGroup items={PRIMARY} /></div>
          <div className="mx-2 hidden border-t border-sidebar-border md:my-4 md:block" />
          <div className="min-w-max md:min-w-0"><NavGroup items={SECONDARY} /></div>
        </div>

        <div className="hidden md:absolute md:bottom-0 md:block md:w-64 md:border-t md:border-sidebar-border md:p-4">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-sidebar-foreground/50">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />Private intelligence workspace
          </div>
          <div className="truncate text-xs text-sidebar-foreground/60">{membership.email}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={toggleTheme} className="flex items-center gap-1.5 border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent">
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button onClick={out} className="flex items-center gap-1.5 border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent">
              <LogOut className="h-3.5 w-3.5" />Sign out
            </button>
          </div>
          <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-sidebar-foreground/35">Built by Revealing Mind AI</div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-7 xl:p-9">
        <div className="mb-4 flex justify-end gap-2 md:hidden">
          <button onClick={toggleTheme} className="border border-border p-2" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={out} className="border border-border p-2" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
