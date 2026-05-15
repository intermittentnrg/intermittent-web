import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import type {} from "@fastify/vite";
import ejs from "ejs";
import { registerRoutes } from "./routes.js";
import { viteAssets } from "./lib/assets.js";

export async function buildApp() {
  const { default: fastifyVite } = await import("@fastify/vite");
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { base: null },
  });

  app.register(view, {
    engine: {
      ejs,
    },

    root: path.join(process.cwd(), "src/views"),
    defaultContext: {
      viteAssets,
    },
  });

  app.register(staticFiles, {
    root: path.join(process.cwd(), "public"),
    prefix: "/assets/",
  });

  await app.register(fastifyVite, {
    root: process.cwd(),
    distDir: "dist/public",
    spa: true,
  });
  await app.vite.ready();

  app.register(registerRoutes);

  return app;
}

export async function startServer(options: { port?: number; host?: string } = {}) {
  const app = await buildApp();
  const port = options.port ?? Number(process.env.PORT || 3000);
  const host = options.host ?? "0.0.0.0";

  await app.listen({ host, port });
  return app;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
