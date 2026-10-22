import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  build: {
    target: "es2024",
    rollupOptions: { input: { main: "index.html", bench: "bench.html" } },
  },
});
