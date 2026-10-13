import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const SW_FILENAME = "sw.js";
const PRECACHE_ROOT_FILES = [
  "index.html",
  "manifest.json",
  "favicon.svg",
  "icons/icon-192x192.png",
];
const SMALL_ASSET_LIMIT_BYTES = 128 * 1024;
const ENTRY_ASSET_LIMIT_BYTES = 400 * 1024;

export const LAZY_ROUTE_PAGE = /import\(['"]\.\/pages\/([A-Za-z0-9_]+)['"]\)/g;

/**
 * Which chunks are lazy route pages is a fact about `src/routes.tsx`, so it is
 * read from there. A hand-written copy of the list is a second source of truth
 * for something the router already states, and it drifts the first time a route
 * is renamed: the chunk then stops being recognised and quietly falls through
 * to the size heuristics below. It sits under the small-asset limit today, so
 * nothing looks broken; the day it grows past 128 KB it becomes "shell" and is
 * precached during install, which is exactly the bandwidth the deferred tier
 * exists to hold back.
 */
export async function readRouteChunkNames(root: string): Promise<Set<string>> {
  const routesPath = path.join(root, "src/routes.tsx");
  const source = await readFile(routesPath, "utf-8");
  const names = new Set(
    Array.from(source.matchAll(LAZY_ROUTE_PAGE), (match) => match[1])
  );
  if (names.size === 0) {
    throw new Error(
      `[sw-precache-manifest] found no lazy route pages in ${routesPath}; ` +
        `every route chunk would fall through to the size heuristics`
    );
  }
  return names;
}

async function collectFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(absolute, base);
      return [path.relative(base, absolute)];
    })
  );
  return files.flat();
}

function toUrl(relativePath: string): string {
  return "/" + relativePath.split(path.sep).join("/");
}

export function swPrecacheManifest(): Plugin {
  let outDir = "";
  let root = "";

  return {
    name: "sw-precache-manifest",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const routeChunkNames = await readRouteChunkNames(root);
      const swPath = path.join(outDir, SW_FILENAME);
      let swSource: string;
      try {
        swSource = await readFile(swPath, "utf-8");
      } catch {
        throw new Error(`[sw-precache-manifest] ${SW_FILENAME} not found in ${outDir}`);
      }

      const indexHtml = await readFile(path.join(outDir, "index.html"), "utf-8");
      const entryScripts = new Set(
        Array.from(indexHtml.matchAll(/<script[^>]*src="(\/assets\/[^"]+)"/g), (match) => match[1])
      );
      const preloadedAssets = new Set(
        Array.from(indexHtml.matchAll(/<link[^>]*href="(\/assets\/[^"]+)"/g), (match) => match[1])
      );

      const shouldPrecache = async (relativePath: string): Promise<"shell" | "deferred" | false> => {
        const url = toUrl(relativePath);
        if (url === `/${SW_FILENAME}` || url.endsWith(".map")) return false;
        if (PRECACHE_ROOT_FILES.includes(relativePath)) return "shell";
        if (!url.startsWith("/assets/")) return false;
        if (entryScripts.has(url)) return "shell";
        if (url.endsWith(".css")) return "shell";
        if (preloadedAssets.has(url)) {
          const info = await stat(path.join(outDir, relativePath));
          return info.size <= ENTRY_ASSET_LIMIT_BYTES ? "shell" : "deferred";
        }

        const baseName = path.basename(relativePath);
        if (!baseName.endsWith(".js")) return false;
        const chunkName = baseName.split("-")[0];
        if (routeChunkNames.has(chunkName)) return "deferred";
        const info = await stat(path.join(outDir, relativePath));
        return info.size <= SMALL_ASSET_LIMIT_BYTES ? "deferred" : false;
      };

      const relativePaths = (await collectFiles(outDir)).sort();
      const shell: string[] = [];
      const deferred: string[] = [];
      for (const relativePath of relativePaths) {
        const tier = await shouldPrecache(relativePath);
        if (tier === "shell") shell.push(relativePath);
        else if (tier === "deferred") deferred.push(relativePath);
      }
      const selected = [...shell, ...deferred];

      const hash = createHash("sha256");
      const urls: string[] = [];
      for (const relativePath of selected) {
        const content = await readFile(path.join(outDir, relativePath));
        const url = toUrl(relativePath);
        urls.push(url);
        hash.update(url);
        hash.update(content);
      }

      if (!urls.includes("/index.html")) {
        throw new Error("[sw-precache-manifest] index.html missing from build output");
      }

      const buildHash = hash.digest("hex").slice(0, 16);
      const header =
        `self.__SW_BUILD_HASH__=${JSON.stringify(buildHash)};` +
        `self.__SW_PRECACHE__=${JSON.stringify(urls)};` +
        `self.__SW_SHELL__=${JSON.stringify(shell.map(toUrl))};\n`;

      await writeFile(swPath, header + swSource);
    },
  };
}
