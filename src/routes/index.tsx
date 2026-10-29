import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Energy Market Lab | Live energy opportunity intelligence" },
      { name: "description", content: "Independent commercial energy intelligence with live evidence checks and scenario economics." },
      { property: "og:title", content: "Energy Market Lab" },
      { property: "og:description", content: "Verified regulatory signals, commercial opportunities, and boardroom decision support." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/energy" });
  },
});
