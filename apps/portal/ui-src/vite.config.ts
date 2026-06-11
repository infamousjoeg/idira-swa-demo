import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Build output goes to ../ui/ so the Go portal's embed directive picks it up.
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, "../ui"),
    emptyOutDir: true,
    // Explicit determinism: no sourcemaps, content-hash filenames only.
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    // Proxy API calls to the Go portal during dev.
    proxy: {
      "/resolve": "http://localhost:8080",
      "/trace": "http://localhost:8080",
      "/identity": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
