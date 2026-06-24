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

const sharedModules = [
  { logical: '/assets/router.js', entry: 'public/router.js' },
  { logical: '/assets/dropdown_utils.js', entry: 'public/dropdown_utils.js' },
  { logical: '/assets-build/vendor/uplot_client.bundle.js', entry: 'public/vendor/uplot_client.bundle.js' },
  { logical: '/assets-build/vendor/echarts_client.bundle.js', entry: 'public/vendor/echarts_client.bundle.js' },
];

export function importMap() {
  if (isDevelopment) return '<script type="importmap">{}</script>\n';

  const manifest = loadManifest();
  if (!manifest) return '';

  const imports: Record<string, string> = {};
  for (const mod of sharedModules) {
    const hashed = manifest[mod.entry]?.file;
    if (hashed) imports[mod.logical] = `${base}${hashed}`;
  }

  if (Object.keys(imports).length === 0) return '';
  return `<script type="importmap">${JSON.stringify({ imports })}\n</script>\n`;
}
