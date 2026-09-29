type PgErr = { message?: string; code?: string; details?: string } | null | undefined;

/** Map database / auth errors to friendly messages. */
export function friendlyError(err: unknown): string {
  const e = err as PgErr;
  const msg = e?.message ?? String(err ?? "Unknown error");
  const code = e?.code;
  if (msg.includes("LAST_OWNER")) return "The workspace must keep at least one owner.";
  if (code === "23503" && /contacts/.test(msg + (e?.details ?? "")))
    return "This company still has contacts. Delete or move its contacts first.";
  if (code === "23503") return "This record is still referenced by other records.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg))
    return "You don't have permission to do that.";
  if (code === "23505" && /pending_invites/.test(msg)) return "That email already has a pending invite.";
  if (code === "23505") return "That record already exists.";
  if (code === "23514") return "Some values are not allowed. Check the form.";
  if (msg.includes("WORKSPACE_EXISTS")) return "A workspace already exists. Ask the owner to invite you.";
  if (msg.includes("ALREADY_MEMBER")) return "You already belong to the workspace.";
  if (msg.includes("EMAIL_NOT_CONFIRMED")) return "Confirm your email, then sign in again.";
  if (msg.includes("NOT_OWNER")) return "Only owners can do that.";
  if (msg.includes("NOT_ADMIN")) return "Only owners and admins can do that.";
  if (msg.includes("ORG_NOT_EMPTY")) return "Sample data can only be loaded into an empty workspace.";
  if (msg.includes("NOT_A_MEMBER")) return "That person is not a member of this workspace.";
  return msg;
}
