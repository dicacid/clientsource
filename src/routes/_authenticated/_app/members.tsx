import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EMAIL_RE, label, type Role } from "@/lib/constants";
import { friendlyError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { ConfirmDelete, OptionSelect, PageHeader } from "@/components/crm/shared";

export const Route = createFileRoute("/_authenticated/_app/members")({
  head: () => ({
    meta: [
      { title: "Members — Pipeline" },
      { name: "description", content: "Workspace members, roles and pending invites." },
      { property: "og:title", content: "Members — Pipeline" },
      { property: "og:description", content: "Workspace members, roles and pending invites." },
    ],
  }),
  component: Members,
});

function Members() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const isOwner = ws.role === "owner";
  const isAdmin = ws.role === "owner" || ws.role === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["members", ws.organizationId],
    queryFn: async () => {
      const [m, inv] = await Promise.all([
        supabase.from("organization_members").select("user_id, role, created_at").eq("organization_id", ws.organizationId).order("created_at"),
        supabase.from("pending_invites").select("id, email, role, created_at").eq("organization_id", ws.organizationId).order("created_at"),
      ]);
      if (m.error) throw m.error;
      if (inv.error) throw inv.error;
      const ids = m.data.map((x) => x.user_id);
      const { data: profs, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
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
    const { error } = await supabase.from("pending_invites").insert({
      organization_id: ws.organizationId,
      email: email.trim().toLowerCase(),
      role: isOwner ? role : "member",
      invited_by: ws.userId,
    });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(`Invite saved for ${email.trim()}`);
    setEmail("");
    refresh();
  }

  async function removeInvite(id: string) {
    const { error } = await supabase.from("pending_invites").delete().eq("id", id);
    if (error) return toast.error(friendlyError(error));
    toast.success("Invite removed");
    refresh();
  }

  async function setMemberRole(userId: string, newRole: string) {
    const { error } = await supabase.rpc("set_member_role", { target_user_id: userId, new_role: newRole });
    if (error) return toast.error(friendlyError(error));
    toast.success("Role updated");
    refresh();
  }

  async function removeMember(userId: string) {
    const { error, count } = await supabase
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
      <PageHeader title="Members" sub={`Your role: ${label(ws.role)}`} />

      {isAdmin && (
        <section className="mb-8 rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold">Invite someone</h2>
          <Alert className="my-3">
            <AlertDescription>
              No email is sent. Tell the person to sign up with this exact email address and confirm it. They'll join the workspace on their first sign-in.
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
                      <span className="font-mono text-xs uppercase text-muted-foreground">{i.role}</span>
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
