import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import ejs from "ejs";
import { registerRoutes } from "./routes.js";

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true,
  });

  app.register(view, {
    engine: {
      ejs,
    },

    root: path.join(process.cwd(), "src/views"),
  });

  app.register(staticFiles, {
    root: path.join(process.cwd(), "public"),
    prefix: "/assets/",
  });

  app.register(staticFiles, {
    root: path.join(process.cwd(), "dist/public"),
    prefix: "/assets-build/",
    decorateReply: false,
  });

  app.register(registerRoutes);

  return app;
}

export async function startServer(options: { port?: number; host?: string } = {}) {
  const app = buildApp();
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
