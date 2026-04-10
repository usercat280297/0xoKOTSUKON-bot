import { afterEach, describe, expect, it } from "vitest";
import { getBotEnv } from "../src/config/env";

const originalEnv = { ...process.env };

function seedBaseEnv(): void {
  process.env.DISCORD_TOKEN = "token";
  process.env.DISCORD_APPLICATION_ID = "app-id";
  process.env.DISCORD_GUILD_ID = "guild-id";
  process.env.DATABASE_URL = "postgresql://user:pass@host:5432/db?sslmode=require";
  delete process.env.PORT;
  delete process.env.HEALTH_SERVER_ENABLED;
  delete process.env.HEALTH_HOST;
  delete process.env.HEALTH_CHECK_PATH;
}

describe("getBotEnv", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("keeps the health server disabled for normal local runs", () => {
    seedBaseEnv();

    const env = getBotEnv();

    expect(env.healthServer.enabled).toBe(false);
    expect(env.healthServer.port).toBeNull();
    expect(env.healthServer.path).toBe("/healthz");
  });

  it("enables the health server automatically when PORT is present", () => {
    seedBaseEnv();
    process.env.PORT = "10000";

    const env = getBotEnv();

    expect(env.healthServer.enabled).toBe(true);
    expect(env.healthServer.port).toBe(10000);
    expect(env.healthServer.host).toBe("0.0.0.0");
  });
});
