import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { swPrecacheManifest } from "./plugins/sw-precache-manifest";

const VENDOR_CHUNKS: Record<string, string> = {
  react: "vendor-react",
  "react-dom": "vendor-react",
  "react-router-dom": "vendor-react",
  "react-router": "vendor-react",
  "react-hook-form": "vendor-react",
  "@tanstack": "vendor-react",
  zustand: "vendor-react",
  i18next: "vendor-react",
  "react-i18next": "vendor-react",
};

const LAZY_CHUNKS = new Set(["mermaid"]);

const LIB_CHUNKS: Record<string, string> = {
  katex: "lib-katex",
  cytoscape: "lib-graph",
  "cytoscape-cose-bilkent": "lib-graph",
  d3: "lib-graph",
  "d3-force": "lib-graph",
  "@xterm": "lib-terminal",
  xterm: "lib-terminal",
  "@monaco-editor": "lib-editor",
  "monaco-editor": "lib-editor",
  "highlight.js": "lib-highlight",
  shiki: "lib-highlight",
  "diff": "lib-diff",
  "js-yaml": "lib-yaml",
  "gray-matter": "lib-yaml",
  "file-saver": "lib-io",
  "jszip": "lib-io",
  "tar": "lib-io",
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.PORT || 5001;

  return {
    envDir: path.resolve(__dirname, ".."),
    plugins: [
      react(),
      tailwindcss(),
      swPrecacheManifest(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      assetsInlineLimit: 4096,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === "manifest.json") {
              return "manifest.json";
            }
            return "assets/[name]-[hash][extname]";
          },
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            const match = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+|[^/]+)/.exec(id);
            const pkg = match?.[1] ?? "";
            if (VENDOR_CHUNKS[pkg]) return VENDOR_CHUNKS[pkg];
            if (LAZY_CHUNKS.has(pkg)) return undefined;
            if (LIB_CHUNKS[pkg]) return LIB_CHUNKS[pkg];
            return "vendor";
          },
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
    },
    worker: {
      rollupOptions: {
        output: {
          entryFileNames: "sw.js",
        },
      },
    },
  };
});
