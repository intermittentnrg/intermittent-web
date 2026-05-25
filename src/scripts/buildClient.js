import { mkdir, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production" || process.argv.includes("--production");

const supportBundles = [
  {
    entryPoints: ["public/echarts_client.js"],
    outfile: "public/vendor/echarts_client.bundle.js",
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

async function buildClient() {
  if (!watch) await rm("dist/public/client", { recursive: true, force: true });
  await buildSupportBundles();
  const result = await esbuild.build(clientOptions);
  await writeManifest(result);
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
