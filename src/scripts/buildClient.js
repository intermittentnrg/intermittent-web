import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production" || process.argv.includes("--production");

const supportBundles = [
  {
    entryPoints: ["public/echarts_client.js"],
    outfile: "public/vendor/echarts_client.bundle.js",
  },
  {
    entryPoints: ["public/uplot_client.js"],
    outfile: "public/vendor/uplot_client.bundle.js",
  },
  {
    entryPoints: ["src/shared/chart_formatters.ts"],
    outfile: "public/vendor/chart_formatters.js",
  },
  {
    entryPoints: ["src/shared/echartsFormatters.ts"],
    outfile: "public/vendor/echarts_formatters.js",
  },
];

const commonOptions = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function cleanSupportBundles() {
  await Promise.all(supportBundles.flatMap(({ outfile }) => [
    rm(outfile, { force: true }),
    rm(`${outfile}.map`, { force: true }),
  ]));
}

async function buildSupportBundles() {
  await cleanSupportBundles();
  await Promise.all(supportBundles.map((bundle) => esbuild.build({
    ...commonOptions,
    ...bundle,
  })));
}

const clientEntryPoints = [
  "public/app.js",
  "public/application.css",
  "public/topnav.css",
  "public/topnav-area.css",
  "public/topnav-dashboard.css",
  "public/topnav-date.css",
];

const clientOptions = {
  ...commonOptions,
  entryPoints: clientEntryPoints,
  outdir: "dist/public/client",
  entryNames: production ? "assets/[name]-[hash]" : "[dir]/[name]",
  chunkNames: production ? "chunks/[name]-[hash]" : "chunks/[name]",
  assetNames: production ? "assets/[name]-[hash]" : "assets/[name]",
  external: [
    "../vendor/echarts_client.bundle.js",
    "../vendor/uplot_client.bundle.js",
    "/assets/router.js",
    "/assets/dropdown_utils.js",
  ],
  metafile: true,
  write: true,
};

async function writeManifest(result) {
  const manifest = {};
  for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
    if (!output.entryPoint) continue;
    manifest[output.entryPoint] = { file: outputPath.replace(/^dist\/public\/client\//, "") };
  }

  await mkdir("dist/public/client", { recursive: true });
  await writeFile("dist/public/client/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

async function hashAndCopyModule(src, outDir) {
  const content = await readFile(src, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  const basename = path.basename(src, '.js');
  const dest = path.join(outDir, 'assets', `${basename}-${hash}.js`);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);

  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest[`public/${basename}.js`] = { file: `assets/${basename}-${hash}.js` };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function buildClient() {
  if (!watch) await rm("dist/public/client", { recursive: true, force: true });
  await buildSupportBundles();
  const result = await esbuild.build(clientOptions);
  await writeManifest(result);

  // Copy vendor bundles alongside the client build so the externalized
  // import (../vendor/echarts_client.bundle.js) resolves in production.
  await cp("public/vendor", path.join("dist/public/client/vendor"), { recursive: true });

  // Hash and copy unbundled shared modules for import map cache-busting
  if (production) {
    await hashAndCopyModule("public/router.js", "dist/public/client");
    await hashAndCopyModule("public/dropdown_utils.js", "dist/public/client");
  }
}

if (watch) {
  await buildSupportBundles();
  const context = await esbuild.context({
    ...clientOptions,
    plugins: [{
      name: "manifest",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length || !result.metafile) return;
          await writeManifest(result);
        });
      },
    }],
  });
  await context.watch();
  console.log("watching client bundle...");
} else {
  await buildClient();
}
