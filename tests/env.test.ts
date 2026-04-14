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
  delete process.env.STEAM_FREE_GAMES_CHANNEL_ID;
  delete process.env.EPIC_FREE_GAMES_CHANNEL_ID;
  delete process.env.FREE_GAMES_POLL_MINUTES;
  delete process.env.FREE_GAMES_COUNTRY_CODE;
  delete process.env.FREE_GAMES_LOCALE;
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

  it("fills the free game channels from the built-in guild defaults", () => {
    seedBaseEnv();
    process.env.DISCORD_GUILD_ID = "1492076309323714570";

    const env = getBotEnv();

    expect(env.freeGames.enabled).toBe(true);
    expect(env.freeGames.steamChannelId).toBe("1492115864848433222");
    expect(env.freeGames.epicChannelId).toBe("1492115804953641055");
    expect(env.freeGames.countryCode).toBe("VN");
    expect(env.freeGames.locale).toBe("vi");
  });
});
