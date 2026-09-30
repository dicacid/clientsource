import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  executeDbRequest,
  executeRpc,
  signIn,
  signUp,
  userById,
  verifySessionToken,
  type DbRequest,
} from "./state.server";
import { requireRenderUser } from "./auth-middleware";
import { clearSessionCookie, setSessionCookie } from "./session.server";

const authSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("signup"),
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().max(120).default(""),
  }),
  z.object({
    action: z.literal("signin"),
    email: z.string().email(),
    password: z.string().min(1),
  }),
  z.object({
    action: z.literal("signout"),
  }),
]);

export const authRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => authSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.action === "signup") return signUp(data.email, data.password, data.fullName);
    if (data.action === "signout") {
      clearSessionCookie();
      return { ok: true };
    }
    const result = await signIn(data.email, data.password);
    setSessionCookie(result.access_token);
    return result;
  });

export const sessionUserRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ token: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const user = await verifySessionToken(data.token);
    if (!user) throw new Error("Unauthorized: session expired. Sign in again.");
    return { user: await userById(user.id) };
  });

export const currentUserRequest = createServerFn({ method: "GET" })
  .middleware([requireRenderUser])
  .handler(async ({ context }) => ({ user: await userById(context.userId) }));

export const dbRequest = createServerFn({ method: "POST" })
  .middleware([requireRenderUser])
  .inputValidator((data: unknown) => data as DbRequest)
  .handler(async ({ data, context }) => executeDbRequest(context.userId, data));

export const rpcRequest = createServerFn({ method: "POST" })
  .middleware([requireRenderUser])
  .inputValidator((data: unknown) =>
    z
      .object({
        fn: z.string().min(1).max(80),
        args: z.record(z.unknown()).default({}),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => executeRpc(context.userId, data.fn, data.args));
