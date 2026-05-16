import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    test: {
      include: ["test/unit/**/*.test.ts"],
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
