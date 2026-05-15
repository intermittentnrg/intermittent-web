import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";

  return {
    test: {
      include: ["test/unit/**/*.test.ts"],
    },
    build: {
      outDir: "dist/public",
      emptyOutDir: true,
      minify: isDevelopment ? false : "esbuild",
      sourcemap: isDevelopment,
      manifest: !isDevelopment,
      rollupOptions: {
        input: "public/app.js",
        output: {
          entryFileNames: isDevelopment ? "app.bundle.js" : "assets/[name]-[hash].js",
          chunkFileNames: isDevelopment ? "chunks/[name].js" : "chunks/[name]-[hash].js",
          assetFileNames: isDevelopment ? "assets/[name][extname]" : "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
