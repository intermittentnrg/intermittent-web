import fs from "node:fs";
import path from "node:path";

const base = "/assets-build/";
const isDevelopment = process.argv.includes("--dev");

type ManifestEntry = {
  file: string;
};

type Manifest = Record<string, ManifestEntry>;

let manifest: Manifest | undefined;
let manifestLoaded = false;

function loadManifest() {
  if (isDevelopment) return undefined;
  if (manifestLoaded) return manifest;
  manifestLoaded = true;

  const manifestPath = path.join(process.cwd(), "dist/public/client/manifest.json");
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

export function entrypointUrl(entrypoint: string) {
  const manifest = loadManifest();
  const entry = manifest?.[entrypoint];
  if (entry?.file) return assetUrl(entry.file);

  return isDevelopment
    ? assetUrl(entrypoint)
    : `/assets/${entrypoint.replace(/^public\//, "")}`;
}

function productionAssetTags(entrypoint: string) {
  const manifest = loadManifest();
  const entry = manifest?.[entrypoint];
  if (!entry?.file) return undefined;

  return `<script type="module" src="${assetUrl(entry.file)}" defer></script>`;
}

export function scriptTags(entrypoint = "public/app.js") {
  return productionAssetTags(entrypoint)
    ?? `<script>window.process = window.process || { env: { NODE_ENV: "development" } };</script>\n<script type="module" src="${assetUrl(entrypoint)}" defer></script>`;
}
