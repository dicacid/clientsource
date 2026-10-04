import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { executeDbRequest, executeRpc, signIn, signUp, userById, type DbRequest } from "./state.server";
import { requireRenderUser } from "./auth-middleware";

const authSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("signup"),
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().max(120).default(""),
    inviteToken: z.string().min(20).max(512).optional(),
  }),
  z.object({
    action: z.literal("signin"),
    email: z.string().email(),
    password: z.string().min(1),
    inviteToken: z.string().min(20).max(512).optional(),
  }),
]);

export const authRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => authSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.action === "signup") return signUp(data.email, data.password, data.fullName, data.inviteToken);
    return signIn(data.email, data.password, data.inviteToken);
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
