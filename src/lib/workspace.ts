import { useRouteContext } from "@tanstack/react-router";

export function useWorkspace() {
  return useRouteContext({ from: "/_authenticated/_app" }).membership;
}
