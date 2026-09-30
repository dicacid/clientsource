// @lovable.dev/vite-tanstack-config already includes the core TanStack/Vite plugins.
// For self-hosting on Render we override Nitro's default Cloudflare target with
// a standard Node server build.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
  nitro: {
    preset: "node-server",
  },
});
