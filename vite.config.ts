import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "src/public",
    emptyOutDir: false,
    rollupOptions: {
      input: "src/public/app.js",
      output: {
        entryFileNames: "app.bundle.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
