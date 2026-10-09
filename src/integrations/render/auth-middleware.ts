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

// Only public research functions accept visitors. CRM reads and writes,
// account, invitations, membership and settings still enforce authentication.
// This in-memory throttle protects a single Render process; scaling needs Redis.
const guestResearchHits = new Map<string, { count: number; reset: number }>();
let researchGlobal = { count: 0, reset: 0 };

function throttleGuestResearch() {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const forwardedFor = getRequest()?.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const caller = (forwardedFor || "anonymous").slice(0, 100);
  if (now >= researchGlobal.reset) researchGlobal = { count: 0, reset: now + windowMs };
  if (researchGlobal.count >= 300) throw new Error("Public research is temporarily busy. Please try again later.");
  let bucket = guestResearchHits.get(caller);
  if (!bucket || now >= bucket.reset) bucket = { count: 0, reset: now + windowMs };
  if (bucket.count >= 36) throw new Error("This connection has reached the temporary research limit. Please try again later.");
  bucket.count += 1;
  researchGlobal.count += 1;
  guestResearchHits.set(caller, bucket);
  if (guestResearchHits.size > 5000) {
    for (const [key, item] of guestResearchHits) {
      if (item.reset <= now) guestResearchHits.delete(key);
    }
  }
}

export const allowPublicResearch = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const authorization = getRequest()?.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const user = await verifySessionToken(authorization.slice(7).trim());
    if (user) {
      const membership = await membershipForUser(user.id);
      if (membership) {
        return next({
          context: {
            userId: user.id,
            email: user.email,
            organizationId: membership.organizationId,
            role: membership.role,
          },
        });
      }
    }
  }
  throttleGuestResearch();
  return next({ context: { userId: "guest", email: "", organizationId: "guest", role: "guest" } });
});
