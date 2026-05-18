import awsLambdaFastify from "@fastify/aws-lambda";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { buildApp } from "./server.js";

const proxyPromise = buildApp().then((app) => awsLambdaFastify(app));

export async function handler(event: APIGatewayProxyEvent, context: Context) {
  const proxy = await proxyPromise;
  return proxy(event, context);
}
