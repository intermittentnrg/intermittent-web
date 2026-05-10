import "dotenv/config";
import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import ejs from "ejs";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: true,
});

app.register(view, {
  engine: {
    ejs,
  },

  root: path.join(process.cwd(), "src/views"),
});

app.register(staticFiles, {
  root: path.join(process.cwd(), "src/public"),
  prefix: "/assets/",
});

app.register(registerRoutes);

const port = Number(process.env.PORT || 3000);

app.listen({
  host: "0.0.0.0",
  port,
});
