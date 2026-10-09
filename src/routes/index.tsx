import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prospect Finder B2B — Free business and competitor research" },
      { name: "description", content: "Free business research and competitor discovery. No account or website required." },
      { property: "og:title", content: "Prospect Finder B2B — Free business and competitor research" },
      { property: "og:description", content: "Free business research and competitor discovery. No account or website required." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/prospect" });
  },
});
