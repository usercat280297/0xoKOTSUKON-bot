import { createServer, type Server } from "node:http";
import { createBotApp } from "./app";
import { getBotEnv } from "./config/env";

async function main(): Promise<void> {
  const env = getBotEnv();
  const app = createBotApp(env);
  let healthServer: Server | null = null;

  if (env.healthServer.enabled) {
    if (env.healthServer.port === null) {
      throw new Error("Health server is enabled but PORT is missing.");
    }

    healthServer = createServer(async (request, response) => {
      if (!request.url || !request.url.startsWith(env.healthServer.path)) {
        response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const health = await app.getHealth();
      response.writeHead(health.status === "ok" ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify(health));
    });

    await new Promise<void>((resolve, reject) => {
      healthServer!.once("error", reject);
      healthServer!.listen(env.healthServer.port!, env.healthServer.host, () => resolve());
    });

    console.log(`Health endpoint listening on http://${env.healthServer.host}:${env.healthServer.port}${env.healthServer.path}`);
  }

  await app.start();

  const shutdown = async () => {
    await app.stop();
    await new Promise<void>((resolve, reject) => {
      if (!healthServer) {
        resolve();
        return;
      }

      healthServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  process.once("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error("Failed to start the bot.", error);
  process.exitCode = 1;
});
