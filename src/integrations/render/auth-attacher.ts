import { createMiddleware } from "@tanstack/react-start";

const STORAGE_KEY = "spa-intelligence.session";

export const attachRenderAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let token: string | null = null;
  try {
    token = localStorage.getItem(STORAGE_KEY);
  } catch {
    token = null;
  }
  return next({
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
});
