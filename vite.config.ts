import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
    rollupOptions: {
      input: "public/app.js",
      output: {
        entryFileNames: "app.bundle.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
