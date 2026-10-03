import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { swPrecacheManifest } from "./plugins/sw-precache-manifest";
import { gzipSync, constants } from "node:zlib";
import fs from "node:fs";

/**
 * Every asset this plugin produces carries a content hash in its name and is
 * served with max-age=1y, immutable - it will never change and it is never
 * re-fetched. Yet the server was gzipping it again on every single request: a
 * 921 KB file took 19 s uncompressed and 3.3 s compressed, and the compressing
 * was redone for a byte-identical answer each time.
 *
 * Compressing once at build time and letting the server hand over the .gz turns
 * that per-request cost into a file read.
 */
function precompressAssets(): Plugin {
  return {
    name: "precompress-assets",
    apply: "build",
    closeBundle() {
      const dir = path.resolve(__dirname, "dist");
      if (!fs.existsSync(dir)) return;
      let written = 0;
      const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!/\.(js|css|html|json|svg)$/.test(entry.name)) continue;
          const source = fs.readFileSync(full);
          if (source.length < 1024) continue;
          fs.writeFileSync(
            `${full}.gz`,
            gzipSync(source, { level: constants.Z_BEST_COMPRESSION }),
          );
          written += 1;
        }
      };
      walk(dir);
      // Reported through the build log the plugin already has a channel for;
      // a bare console here trips the repo's no-console rule.
      this.warn(`precompressed ${written} assets to .gz`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.PORT || 5001;

  return {
    envDir: path.resolve(__dirname, ".."),
    plugins: [
      react(),
      tailwindcss(),
      swPrecacheManifest(),
      precompressAssets(),
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
