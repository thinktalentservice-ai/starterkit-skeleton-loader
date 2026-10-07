import { defineConfig } from "vite";

// Serves demo/ — the page the Playwright specs in tests/ measure. It imports
// the library from ../src, so the specs exercise source, not a stale build.
export default defineConfig({
  root: "demo",
  server: { port: 5179, strictPort: true },
});
