import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { confirmPasswordResetRequest } from "@/integrations/render/server.functions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  head: () => ({
    meta: [
      { title: "Reset password — SPA Intelligence" },
      { name: "description", content: "Set a new SPA Intelligence password." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "This password reset link is invalid.",
  );
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) return setError("This password reset link is invalid.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");

    setBusy(true);
    try {
      await confirmPasswordResetRequest({ data: { token, password } });
      try {
        localStorage.removeItem("spa-intelligence.session");
      } catch {
        /* browser storage unavailable */
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          <h1 className="mt-2 text-2xl font-semibold">
            {done ? "Password updated" : "Choose a new password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {done
              ? "Your old password can no longer be used."
              : "This reset link can be used once and expires after 30 minutes."}
          </p>
        </div>

        {done ? (
          <div className="rounded-lg border bg-card p-6">
            <Alert>
              <AlertDescription>Your password has been changed successfully.</AlertDescription>
            </Alert>
            <Button asChild className="mt-4 w-full">
              <Link to="/auth">Return to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-6">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={busy || !token}>
              {busy ? "Updating…" : "Update password"}
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
