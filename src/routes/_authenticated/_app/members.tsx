import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { renderDb } from "@/integrations/render/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EMAIL_RE, label, type Role } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { ConfirmDelete, OptionSelect, PageHeader } from "@/components/crm/shared";

export const Route = createFileRoute("/_authenticated/_app/members")({
  head: () => ({
    meta: [
      { title: "Members — Prospect Finder B2B" },
      { name: "description", content: "Workspace members, roles and pending invites." },
      { property: "og:title", content: "Members — Prospect Finder B2B" },
      { property: "og:description", content: "Workspace members, roles and pending invites." },
    ],
  }),
  component: Members,
});

function Members() {
  const ws = useWorkspace();
  const guest = ws.userId === "guest";
  const qc = useQueryClient();
  const isOwner = ws.role === "owner";
  const isAdmin = ws.role === "owner" || ws.role === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");

  const q = useQuery({
    queryKey: ["members", ws.organizationId, ws.userId],
    queryFn: async () => {
      const [m, inv] = await Promise.all([
        renderDb.from("organization_members").select("user_id, role, created_at").eq("organization_id", ws.organizationId).order("created_at"),
        renderDb.from("pending_invites").select("id, email, role, created_at, expires_at").eq("organization_id", ws.organizationId).order("created_at"),
      ]);
      if (m.error) throw m.error;
      if (inv.error) throw inv.error;
      const ids = m.data.map((x) => x.user_id);
      const { data: profs, error } = await renderDb.from("profiles").select("id, full_name").in("id", ids);
      if (error) throw error;
      const names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
      return { members: m.data.map((x) => ({ ...x, name: names[x.user_id] as string | null })), invites: inv.data };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const ownerCount = q.data?.members.filter((m) => m.role === "owner").length ?? 0;

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return toast.error("Enter a valid email.");
    setBusy(true);
    const { data, error } = await renderDb.rpc("create_invite", {
      email: email.trim().toLowerCase(),
      role: isOwner ? role : "member",
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    const url = `${window.location.origin}/auth?invite=${encodeURIComponent(data.token)}&email=${encodeURIComponent(data.email)}`;
    setInviteLink(url);
    toast.success(`Secure invite created for ${data.email}`);
    setEmail("");
    refresh();
  }

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  }

  async function removeInvite(id: string) {
    const { error } = await renderDb.from("pending_invites").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Invite removed");
    refresh();
  }

  async function setMemberRole(userId: string, newRole: string) {
    const { error } = await renderDb.rpc("set_member_role", { target_user_id: userId, new_role: newRole });
    if (error) return toast.error(friendlyError(error));
    toast.success("Role updated");
    refresh();
  }

  async function removeMember(userId: string) {
    const { error, count } = await renderDb
      .from("organization_members")
      .delete({ count: "exact" })
      .eq("organization_id", ws.organizationId)
      .eq("user_id", userId);
    if (error) return toast.error(friendlyError(error));
    if (!count) return toast.error("You don't have permission to remove this member.");
    toast.success("Member removed");
    refresh();
  }

  const canRemove = (r: Role) => (r === "member" ? isAdmin : isOwner);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Members" sub={guest ? "Free private browser-tab workspace" : `Your role: ${label(ws.role)}`} />
      {guest && <p className="mb-5 rounded-md border p-4 text-sm text-muted-foreground">You can use all the research and CRM tools anonymously. Guest data is stored only in this browser tab. Sharing a live workspace between devices requires an identified team account so other people cannot access your private leads.</p>}

      {isAdmin && (
        <section className="mb-8 rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Invite someone</h2>
          <Alert className="my-3">
            <AlertDescription>
              Create a one-time invitation link and send it securely to the person. New invite links expire after seven days.
            </AlertDescription>
          </Alert>
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <Input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" aria-label="Invite email" />
            {isOwner ? (
              <OptionSelect value={role} onChange={setRole} options={["member", "admin"]} className="w-32" ariaLabel="Invite role" />
            ) : (
              <span className="self-center text-sm text-muted-foreground">as Member</span>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Add invite"}
            </Button>
          </form>
          {inviteLink && (
            <div className="mt-4 space-y-2">
              <Label htmlFor="invite-link">Invitation link</Label>
              <div className="flex gap-2">
                <Input id="invite-link" value={inviteLink} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copyInvite}>Copy</Button>
              </div>
              <p className="text-xs text-muted-foreground">This link contains the one-time invite token. It is only shown here when created.</p>
            </div>
          )}
        </section>
      )}

      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <p className="text-destructive">{friendlyError(q.error)}</p>
      ) : (
        <>
          <section className="rounded-lg border">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Members ({q.data!.members.length})</h2>
            <ul className="divide-y">
              {q.data!.members.map((m) => {
                const lastOwner = m.role === "owner" && ownerCount <= 1;
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="font-medium">
                        {m.name || "Unnamed member"} {m.user_id === ws.userId && <span className="text-xs text-muted-foreground">(you)</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner ? (
                        <OptionSelect
                          value={m.role}
                          onChange={(v) => setMemberRole(m.user_id, v)}
                          options={["owner", "admin", "member"]}
                          className="h-8 w-28"
                          ariaLabel={`Role of ${m.name ?? "member"}`}
                        />
                      ) : (
                        <span className="font-mono text-xs uppercase text-primary">{label(m.role)}</span>
                      )}
                      {canRemove(m.role as Role) && !lastOwner && (
                        <ConfirmDelete
                          title="Remove this member?"
                          description="They'll lose access to the workspace immediately."
                          onConfirm={() => removeMember(m.user_id)}
                          trigger={
                            <Button size="icon" variant="ghost" aria-label="Remove member">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-6 rounded-lg border">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Pending invites ({q.data!.invites.length})</h2>
            {q.data!.invites.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No pending invites.</p>
            ) : (
              <ul className="divide-y">
                {q.data!.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="font-mono">{i.email}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs uppercase text-muted-foreground">
                        {i.role}{i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : " · legacy invite"}
                      </span>
                      {(i.role === "member" ? isAdmin : isOwner) && (
                        <ConfirmDelete
                          title="Remove this invite?"
                          description={`${i.email} will no longer be able to join.`}
                          onConfirm={() => removeInvite(i.id)}
                          trigger={
                            <Button size="icon" variant="ghost" aria-label={`Remove invite ${i.email}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
