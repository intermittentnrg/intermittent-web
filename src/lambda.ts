import awsLambdaFastify from "@fastify/aws-lambda";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { join } from "node:path";
import { buildApp } from "./server.ts";

const fontconfigDir = join(process.cwd(), "fontconfig");
process.env.FONTCONFIG_PATH ??= fontconfigDir;
process.env.FONTCONFIG_FILE ??= join(fontconfigDir, "fonts.conf");
process.env.XDG_CACHE_HOME ??= "/tmp";

const proxyPromise = buildApp().then((app) => awsLambdaFastify(app, {
  // Lambda function URLs/API Gateway responses are JSON strings unless the
  // adapter marks binary payloads as base64 encoded. Without this, PNG bytes
  // are returned as text and the client receives a corrupt/invalid image even
  // though the Lambda invocation succeeds.
  binaryMimeTypes: ["image/png"],
}));

export async function handler(event: APIGatewayProxyEvent, context: Context) {
  const proxy = await proxyPromise;
  return proxy(event, context);
}
