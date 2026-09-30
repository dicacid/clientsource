import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { membershipForUser, verifySessionToken } from "./state.server";

async function authenticatedUser() {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized: sign in again.");
  const token = authHeader.slice("Bearer ".length).trim();
  const user = await verifySessionToken(token);
  if (!user) throw new Error("Unauthorized: session expired. Sign in again.");
  return user;
}

export const requireRenderUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await authenticatedUser();
  return next({ context: { userId: user.id, email: user.email } });
});

export const requireRenderMember = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await authenticatedUser();
  const membership = await membershipForUser(user.id);
  if (!membership) throw new Error("You must be a workspace member to use this feature.");
  return next({
    context: {
      userId: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      role: membership.role,
    },
  });
});
