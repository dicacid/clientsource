import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isAuthFailure, renderDb } from "@/integrations/render/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await renderDb.auth.getUser();
    if (error) {
      if (isAuthFailure(error)) throw redirect({ to: "/auth" });
      throw new Error(error.message);
    }
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
