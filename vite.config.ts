import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    test: {
      include: ["test/unit/**/*.test.ts"],
      reporters: process.env.VITEST_JUNIT_OUTPUT ? ["default", "junit"] : ["default"],
      outputFile: process.env.VITEST_JUNIT_OUTPUT
        ? { junit: process.env.VITEST_JUNIT_OUTPUT }
        : undefined,
    },
    base: "/assets-build/",
    build: {
      outDir: "dist/public/client",
      emptyOutDir: true,
      minify: isDevelopment ? false : "esbuild",
      sourcemap: isDevelopment,
      manifest: true,
      rollupOptions: {
        input: {
          app: "public/app.js",
          application: "public/application.css",
          topnav: "public/topnav.css",
          topnavArea: "public/topnav-area.css",
          topnavDashboard: "public/topnav-dashboard.css",
          topnavDate: "public/topnav-date.css",
        },
        output: {
          entryFileNames: isDevelopment ? "app.bundle.js" : "assets/[name]-[hash].js",
          chunkFileNames: isDevelopment ? "chunks/[name].js" : "chunks/[name]-[hash].js",
          assetFileNames: isDevelopment ? "assets/[name][extname]" : "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
