import { rm } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.env.NODE_ENV === "production" || process.argv.includes("--production");

const outfile = "public/vendor/echarts_client.bundle.js";
const formatterOutfile = "public/vendor/echarts_formatters.js";
await Promise.all([
  rm(outfile, { force: true }),
  rm(`${outfile}.map`, { force: true }),
  rm(formatterOutfile, { force: true }),
  rm(`${formatterOutfile}.map`, { force: true }),
]);

const echartsOptions = {
  entryPoints: ["public/echarts_client.js"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const formatterOptions = {
  entryPoints: ["src/shared/echartsFormatters.ts"],
  outfile: formatterOutfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(echartsOptions),
    esbuild.context(formatterOptions),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("watching browser support bundles...");
} else {
  await Promise.all([
    esbuild.build(echartsOptions),
    esbuild.build(formatterOptions),
  ]);
}
