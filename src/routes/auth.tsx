import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { renderDb } from "@/integrations/render/client";
import { requestPasswordResetRequest } from "@/integrations/render/server.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EMAIL_RE } from "@/lib/constants";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SPA Intelligence" },
      { name: "description", content: "Private commercial intelligence for Solar Power Australia." },
      { property: "og:title", content: "Sign in — SPA Intelligence" },
      { property: "og:description", content: "Sign in to SPA Intelligence with your company email." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");

    if (mode === "forgot") {
      setBusy(true);
      try {
        await requestPasswordResetRequest({ data: { email: email.trim() } });
        setInfo("If that email belongs to an account, a password reset link has been sent. The link is valid for 30 minutes.");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (password.length < 8) return setError("Password must be at least 8 characters.");

    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await renderDb.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
      }
      const { error } = await renderDb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await navigate({ to: "/prospect", replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "signin" ? "Sign in to SPA Intelligence" :
    mode === "signup" ? "Create your account" :
    "Reset your password";

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <img
            src="https://solarpoweraustralia.com.au/wp-content/uploads/2021/05/Solar-power-footer-logo.svg"
            alt="Solar Power Australia"
            className="mb-5 h-12 w-auto bg-white p-1"
          />
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">SPA Intelligence</div>
          <h1 className="mt-2 text-2xl font-semibold">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Enter your account email and we'll send a one-time reset link."
              : "Use your company email and password to access SPA Intelligence."}
          </p>
          {mode !== "forgot" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Automatic access for RevealingMindAI.org, SolarOnline.com.au,
              SolarPowerAustralia.com.au and Elmofo.com.au emails.
            </p>
          )}
        </div>

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
            />
          </div>

          {mode !== "forgot" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>
        </form>

        {mode === "forgot" ? (
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
              setInfo(null);
            }}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        )}
      </div>
    </main>
  );
}
