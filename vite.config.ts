import { defineConfig } from "vite";

export default defineConfig(async ({ mode }) => {
  const { viteFastify } = await import("@fastify/vite/plugin");
  const isDevelopment = mode === "development";

  return {
    test: {
      include: ["test/unit/**/*.test.ts"],
    },
    base: "/assets-build/",
    plugins: [viteFastify({ spa: true })],
    build: {
      outDir: "dist/public",
      emptyOutDir: true,
      minify: isDevelopment ? false : "esbuild",
      sourcemap: isDevelopment,
      manifest: true,
      rollupOptions: {
        input: {
          app: "public/app.js",
          index: "index.html",
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
