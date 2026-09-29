import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pipeline — Team prospecting workspace" },
      { name: "description", content: "Private prospecting workspace for your sales team." },
      { property: "og:title", content: "Pipeline — Team prospecting workspace" },
      { property: "og:description", content: "Private prospecting workspace for your sales team." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/prospect" });
  },
});
