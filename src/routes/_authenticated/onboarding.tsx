import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveMembership, signOut } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — Pipeline" },
      { name: "description", content: "Set up or join your team's workspace." },
      { property: "og:title", content: "Get started — Pipeline" },
      { property: "og:description", content: "Set up or join your team's workspace." },
    ],
  }),
  component: Onboarding,
});

type State = "loading" | "unconfirmed" | "no_org" | "not_invited" | "error";

function Onboarding() {
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const [state, setState] = useState<State>("loading");
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    resolveMembership()
      .then((r) => {
        if (r.state === "member") navigate({ to: "/dashboard", replace: true });
        else setState(r.state);
      })
      .catch((e) => {
        setErr(friendlyError(e));
        setState("error");
      });
  }, [navigate]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Workspace name is required.");
    setBusy(true);
    const { error } = await supabase.rpc("create_workspace", { org_name: name.trim() });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Workspace created");
    await router.invalidate();
    navigate({ to: "/dashboard", replace: true });
  }

  async function out() {
    await signOut(qc);
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-8">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Pipeline</div>
        {state === "loading" && (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {state === "unconfirmed" && (
          <>
            <h1 className="mt-2 text-xl font-semibold">Confirm your email, then sign in again.</h1>
            <p className="mt-2 text-sm text-muted-foreground">We can't continue until {user.email} is confirmed.</p>
          </>
        )}
        {state === "no_org" && (
          <form onSubmit={create} className="mt-2 space-y-4">
            <h1 className="text-xl font-semibold">Create your workspace</h1>
            <p className="text-sm text-muted-foreground">There is one workspace for your team. You'll be its owner.</p>
            <div className="space-y-1.5">
              <Label htmlFor="org">Workspace name</Label>
              <Input id="org" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        )}
        {state === "not_invited" && (
          <>
            <h1 className="mt-2 text-xl font-semibold">Ask the owner to invite this email.</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Signed in as <span className="font-mono text-foreground">{user.email}</span>. Once invited, sign in again.
            </p>
          </>
        )}
        {state === "error" && <p className="mt-2 text-sm text-destructive">{err}</p>}
        <Button variant="ghost" className="mt-6 w-full" onClick={out}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
