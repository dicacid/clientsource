import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Target, PartyPopper, LayoutDashboard, Building2, Users, UserCog, FileUp, LogOut, Settings } from "lucide-react";
import { resolveMembership, signOut } from "@/lib/session";
import { renderDb } from "@/integrations/render/client";
import { label } from "@/lib/constants";

export const Route = createFileRoute("/_authenticated/_app")({
  beforeLoad: async ({ location }) => {
    // Only /prospect is open to guests; all private routes keep membership checks.
    if (location.pathname === "/prospect") {
      const { data } = await renderDb.auth.getUser();
      if (!data.user) {
        return { membership: { organizationId: "guest", orgName: "Free research", role: "member" as const, userId: "guest", email: "" } };
      }
    }
    const r = await resolveMembership();
    if (r.state !== "member") throw redirect({ to: "/onboarding" });
    return { membership: r.membership };
  },
  component: AppLayout,
});

const NAV = [
  { to: "/prospect", label: "Prospect finder", icon: Sparkles },
  { to: "/prospects", label: "Prospect intelligence", icon: Target },
  { to: "/party", label: "Party mode", icon: PartyPopper },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/import", label: "Import", icon: FileUp },
  { to: "/members", label: "Members", icon: UserCog },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AppLayout() {
  const { membership } = Route.useRouteContext();
  const guest = membership.userId === "guest";
  const visibleNav = guest ? NAV.filter((entry) => entry.to === "/prospect") : NAV;
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function out() {
    await signOut(qc);
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="border-b bg-sidebar md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Prospect Finder B2B</div>
            <div className="truncate text-sm font-semibold">{membership.orgName}</div>
          </div>
          {!guest && <button onClick={out} className="text-muted-foreground hover:text-foreground md:hidden" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {visibleNav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-foreground font-medium" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        {!guest && <div className="absolute bottom-0 hidden w-56 border-t p-4 md:block">
          <div className="truncate text-xs text-muted-foreground">{membership.email}</div>
          <div className="mb-2 font-mono text-[10px] uppercase text-primary">{label(membership.role)}</div>
          <button onClick={out} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
