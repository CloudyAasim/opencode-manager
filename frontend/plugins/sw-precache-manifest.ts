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
const ROUTE_CHUNK_NAMES = new Set([
  "Login",
  "Register",
  "Setup",
  "Repos",
  "RepoDetail",
  "SessionDetail",
  "Files",
  "Settings",
  "Schedules",
  "GlobalSchedules",
  "Terminal",
  "AssistantRedirect",
]);
const SMALL_ASSET_LIMIT_BYTES = 128 * 1024;
const ENTRY_ASSET_LIMIT_BYTES = 400 * 1024;

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

  return {
    name: "sw-precache-manifest",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const swPath = path.join(outDir, SW_FILENAME);
      let swSource: string;
      try {
        swSource = await readFile(swPath, "utf-8");
      } catch {
        throw new Error(`[sw-precache-manifest] ${SW_FILENAME} not found in ${outDir}`);
      }

      const indexHtml = await readFile(path.join(outDir, "index.html"), "utf-8");
      const entryAssets = new Set(
        Array.from(indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g), (match) => match[1])
      );

      const shouldPrecache = async (relativePath: string): Promise<boolean> => {
        const url = toUrl(relativePath);
        if (url === `/${SW_FILENAME}` || url.endsWith(".map")) return false;
        if (PRECACHE_ROOT_FILES.includes(relativePath)) return true;
        if (!url.startsWith("/assets/")) return false;
        if (url.endsWith(".css")) return true;
        if (entryAssets.has(url)) {
          const info = await stat(path.join(outDir, relativePath));
          return info.size <= ENTRY_ASSET_LIMIT_BYTES;
        }

        const baseName = path.basename(relativePath);
        if (!baseName.endsWith(".js")) return false;
        const chunkName = baseName.split("-")[0];
        if (ROUTE_CHUNK_NAMES.has(chunkName)) return true;
        const info = await stat(path.join(outDir, relativePath));
        return info.size <= SMALL_ASSET_LIMIT_BYTES;
      };

      const relativePaths = (await collectFiles(outDir)).sort();
      const selected: string[] = [];
      for (const relativePath of relativePaths) {
        if (await shouldPrecache(relativePath)) selected.push(relativePath);
      }

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
        `self.__SW_PRECACHE__=${JSON.stringify(urls)};\n`;

      await writeFile(swPath, header + swSource);
    },
  };
}
