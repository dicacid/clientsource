import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { confirmEmailVerificationRequest } from "@/integrations/render/server.functions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/verify-email")({
  head: () => ({
    meta: [
      { title: "Verify email | SPA Intelligence" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    // Remove the secret before navigation or rendering links. Confirmation is
    // explicit so email scanners/GET requests cannot consume the link.
    window.history.replaceState(null, "", window.location.pathname);
    setToken(value);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value))
      setError("This verification link is invalid. Request a new email from onboarding.");
  }, []);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await confirmEmailVerificationRequest({ data: { token } });
      setToken("");
      setDone(true);
    } catch {
      setError(
        "The link is invalid, expired or could not be confirmed. Request a new email from onboarding.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-primary">
          SPA Intelligence
        </div>
        <h1 className="text-xl font-semibold">{done ? "Email verified" : "Confirm your email"}</h1>
        <p className="text-sm text-muted-foreground">
          {done
            ? "Return to onboarding to join your workspace. Sign in if this browser has no session."
            : "Confirm ownership of the email address that received this link."}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!done && (
          <Button
            className="w-full"
            onClick={confirm}
            disabled={busy || !/^[A-Za-z0-9_-]{43}$/.test(token)}
          >
            {busy ? "Confirming…" : "Verify email"}
          </Button>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link to="/onboarding">Return to onboarding</Link>
        </Button>
      </div>
    </main>
  );
}
