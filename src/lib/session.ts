import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "./constants";

export async function signOut(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.clear();
  await supabase.auth.signOut();
}

export type Membership = { organizationId: string; orgName: string; role: Role; userId: string; email: string };

/** Run after every confirmed login: claim invite, then look up membership. */
export async function resolveMembership(): Promise<
  | { state: "unconfirmed" }
  | { state: "member"; membership: Membership }
  | { state: "no_org" }
  | { state: "not_invited" }
> {
  const { data: u } = await supabase.auth.getUser();
  const user = u.user;
  if (!user) throw new Error("Not signed in");
  if (!user.email_confirmed_at) return { state: "unconfirmed" };
  const { error: claimErr } = await supabase.rpc("claim_invite");
  if (claimErr) throw claimErr;
  const { data: m, error } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (m) {
    return {
      state: "member",
      membership: {
        organizationId: m.organization_id,
        role: m.role as Role,
        orgName: (m.organizations as { name: string } | null)?.name ?? "Workspace",
        userId: user.id,
        email: user.email ?? "",
      },
    };
  }
  const { data: exists, error: exErr } = await supabase.rpc("workspace_exists");
  if (exErr) throw exErr;
  return exists ? { state: "not_invited" } : { state: "no_org" };
}
