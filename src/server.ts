import path from "node:path";
import Fastify from "fastify";
import view from "@fastify/view";
import staticFiles from "@fastify/static";
import ejs from "ejs";
import dotenv from "dotenv";
import { cancelableChartQuery } from "./lib/cancelableQuery.js";

dotenv.config();

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

app.get("/", async (_req, reply) => {
  return reply.view("index.ejs", {
    state: {
      type: "wind",
      range: "7d",
    },
  });
});

const port = Number(process.env.PORT || 3000);

app.listen({
  host: "0.0.0.0",
  port,
});
