import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import ejs from "ejs";
import { registerRoutes } from "./routes.js";
import { viteAssets } from "./lib/assets.js";

export async function buildApp() {
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

  app.register(staticFiles, {
    root: process.argv.includes("--dev")
      ? process.cwd()
      : path.join(process.cwd(), "dist/public/client"),
    prefix: "/assets-build/",
    decorateReply: false,
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

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
