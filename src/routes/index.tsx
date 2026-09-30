import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prospect Finder B2B — Team prospecting workspace" },
      { name: "description", content: "Private prospecting workspace for your sales team." },
      { property: "og:title", content: "Prospect Finder B2B — Team prospecting workspace" },
      { property: "og:description", content: "Private prospecting workspace for your sales team." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/prospect" });
  },
});
