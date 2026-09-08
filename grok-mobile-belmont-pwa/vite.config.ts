import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  plugins: [react()],
  build: {
    // A normal build must never empty the directory served by a running PWA.
    // Deployment may explicitly select another --outDir after validation.
    outDir: path.resolve(appRoot, "../.build/mobile-source/dist"),
    emptyOutDir: true,
  },
});
