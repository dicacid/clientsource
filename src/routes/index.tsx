import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SPA Intelligence — Commercial intelligence for Solar Power Australia" },
      { name: "description", content: "Private commercial-intelligence workspace for Solar Power Australia." },
      { property: "og:title", content: "SPA Intelligence — Commercial intelligence for Solar Power Australia" },
      { property: "og:description", content: "Private commercial-intelligence workspace for Solar Power Australia." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/prospect" });
  },
});
