import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EMAIL_RE } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";

type AuthSearch = { invite?: string; email?: string };

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    invite: typeof search.invite === "string" && search.invite.length <= 512 ? search.invite : undefined,
    email: typeof search.email === "string" && search.email.length <= 320 ? search.email : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Prospect Finder B2B" },
      { name: "description", content: "Sign in to your team's prospecting workspace." },
      { property: "og:title", content: "Sign in — Prospect Finder B2B" },
      { property: "og:description", content: "Sign in to your team's prospecting workspace." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(search.invite ? "signup" : "signin");
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await renderDb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
          inviteToken: search.invite,
        });
        if (error) throw error;
        navigate({ to: "/onboarding", replace: true });
      } else {
        const { error } = await renderDb.auth.signInWithPassword({
          email: email.trim(),
          password,
          inviteToken: search.invite,
        });
        if (error) throw error;
        navigate({ to: "/onboarding", replace: true });
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Prospect Finder B2B</div>
          <h1 className="mt-2 text-2xl font-semibold">
            {mode === "signin" ? "Sign in to your workspace" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Private workspace. Access by invitation.</p>
        </div>

        {search.invite && (
          <Alert className="mb-4">
            <AlertDescription>
              This is a private invitation link. Use the invited email address. If you already have an account, switch to sign in below.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              readOnly={Boolean(search.email)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
          </div>
          {mode === "signup" && !search.invite && (
            <p className="text-xs text-muted-foreground">
              New accounts require an invitation once a workspace already exists.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
