import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import ejs from "ejs";
import { registerRoutes } from "./routes.ts";
import { viteEntrypointUrl, viteScriptTags } from "./lib/assets.ts";

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { base: null },
    trustProxy: true,
  });

  const isDevelopment = process.argv.includes("--dev");

  app.register(view, {
    engine: {
      ejs,
    },

    root: path.join(process.cwd(), "src/views"),
    defaultContext: {
      viteEntrypointUrl,
      viteScriptTags,
      googleAnalyticsEnabled: !isDevelopment,
    },
  });

  app.register(staticFiles, {
    root: path.join(process.cwd(), "public"),
    prefix: "/assets/",
  });

  app.register(staticFiles, {
    root: isDevelopment
      ? process.cwd()
      : path.join(process.cwd(), "dist/public/client"),
    prefix: "/assets-build/",
    decorateReply: false,
    maxAge: isDevelopment ? 0 : "30d",
    immutable: !isDevelopment,
  });

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

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
