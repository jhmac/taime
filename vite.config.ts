import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
    ...(process.env.NODE_ENV === "production"
      ? [
          viteCompression({
            algorithm: "gzip",
            ext: ".gz",
            threshold: 1024,
            deleteOriginFile: false,
          }),
          viteCompression({
            algorithm: "brotliCompress",
            ext: ".br",
            threshold: 1024,
            deleteOriginFile: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // /@clerk/ MUST be checked before /react/ because
            // @clerk/shared/dist/runtime/react/index.mjs matches both
            // patterns. Without this guard, that file lands in vendor-react,
            // creating a circular vendor-clerk ↔ vendor-react dependency
            // that triggers a TDZ ReferenceError in Firefox/Safari.
            if (id.includes("/@clerk/")) {
              return "vendor-clerk";
            }
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (
              id.includes("/@tanstack/") ||
              id.includes("/react-query/")
            ) {
              return "vendor-query";
            }
            if (id.includes("/@radix-ui/")) {
              return "vendor-radix";
            }
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
