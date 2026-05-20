import fs from "node:fs";
import path from "node:path";

const base = "/assets-build/";
const isDevelopment = process.argv.includes("--dev");

type ManifestEntry = {
  file: string;
  css?: string[];
  imports?: string[];
};

type Manifest = Record<string, ManifestEntry>;

let manifest: Manifest | undefined;
let manifestLoaded = false;

function loadManifest() {
  if (isDevelopment) return undefined;
  if (manifestLoaded) return manifest;
  manifestLoaded = true;

  const manifestPath = path.join(process.cwd(), "dist/public/client/.vite/manifest.json");
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    manifest = undefined;
  }

  return manifest;
}

function assetUrl(file: string) {
  return `${base}${file}`;
}

export function viteEntrypointUrl(entrypoint: string) {
  const manifest = loadManifest();
  const entry = manifest?.[entrypoint];
  if (entry?.file) return assetUrl(entry.file);

  return `/assets/${entrypoint.replace(/^public\//, "")}`;
}

function productionAssetTags(entrypoint: string) {
  const manifest = loadManifest();
  const entry = manifest?.[entrypoint];
  if (!entry?.file) return undefined;

  const tags: string[] = [];
  const seen = new Set<string>();

  function addStyles(manifestEntry: ManifestEntry | undefined) {
    for (const file of manifestEntry?.css ?? []) {
      if (seen.has(file)) continue;
      seen.add(file);
      tags.push(`<link rel="stylesheet" href="${assetUrl(file)}">`);
    }
  }

  for (const importedEntrypoint of entry.imports ?? []) {
    const importedEntry = manifest?.[importedEntrypoint];
    if (!importedEntry?.file || seen.has(importedEntry.file)) continue;
    seen.add(importedEntry.file);
    tags.push(`<link rel="modulepreload" href="${assetUrl(importedEntry.file)}">`);
    addStyles(importedEntry);
  }

  addStyles(entry);
  tags.push(`<script type="module" src="${assetUrl(entry.file)}" defer></script>`);

  return tags.join("\n");
}

function developmentImportMap() {
  return `<script>window.process = window.process || { env: { NODE_ENV: "development" } };</script>
<script type="importmap">
{
  "imports": {
    "echarts": "${base}node_modules/echarts/dist/echarts.esm.js",
    "echarts/core": "${base}node_modules/echarts/core.js",
    "echarts/charts": "${base}node_modules/echarts/charts.js",
    "echarts/components": "${base}node_modules/echarts/components.js",
    "echarts/renderers": "${base}node_modules/echarts/renderers.js",
    "echarts/": "${base}node_modules/echarts/",
    "zrender/": "${base}node_modules/zrender/",
    "tslib": "${base}node_modules/tslib/tslib.es6.js"
  }
}
</script>`;
}

export function viteScriptTags(entrypoint = "public/app.js") {
  return productionAssetTags(entrypoint)
    ?? `${developmentImportMap()}\n<script type="module" src="${base}${entrypoint}" defer></script>`;
}
