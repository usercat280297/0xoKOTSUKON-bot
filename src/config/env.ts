import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

export interface BotEnv {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId?: string;
  databaseUrl: string;
  ticketTimezone: string;
  ticketHoursStart: number;
  ticketHoursEnd: number;
  dailyCheckinLogChannelId: string | null;
  healthServer: {
    enabled: boolean;
    host: string;
    port: number | null;
    path: string;
  };
  steamUpdates: {
    enabled: boolean;
    channelId: string | null;
    curatorId: string;
    pollIntervalMs: number;
    batchSize: number;
    games: string[];
  };
  freeGames: {
    enabled: boolean;
    steamChannelId: string | null;
    epicChannelId: string | null;
    pollIntervalMs: number;
    countryCode: string;
    locale: string;
  };
}

const DEFAULT_STEAM_UPDATE_CHANNELS: Record<string, string> = {
  "1492076309323714570": "1492117958368034878"
};

const DEFAULT_DAILY_CHECKIN_LOG_CHANNELS: Record<string, string> = {
  "1492076309323714570": "1492851767711502409"
};

const DEFAULT_STEAM_FREE_GAME_CHANNELS: Record<string, string> = {
  "1492076309323714570": "1492115864848433222"
};

const DEFAULT_EPIC_FREE_GAME_CHANNELS: Record<string, string> = {
  "1492076309323714570": "1492115804953641055"
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function getBotEnv(): BotEnv {
  const ticketTimezone = process.env.TICKET_TIMEZONE ?? "Asia/Bangkok";
  const ticketHoursStart = Number(process.env.TICKET_HOURS_START ?? "21");
  const ticketHoursEnd = Number(process.env.TICKET_HOURS_END ?? "24");
  const healthHost = process.env.HEALTH_HOST ?? "0.0.0.0";
  const healthPath = process.env.HEALTH_CHECK_PATH ?? "/healthz";
  const portValue = process.env.PORT;
  const healthServerEnabled = process.env.HEALTH_SERVER_ENABLED === "true" || Boolean(portValue);
  const healthPort = portValue ? Number(portValue) : null;
  const steamUpdateChannelId =
    process.env.STEAM_UPDATES_CHANNEL_ID ??
    (process.env.DISCORD_GUILD_ID ? DEFAULT_STEAM_UPDATE_CHANNELS[process.env.DISCORD_GUILD_ID] ?? null : null);
  const steamFreeGamesChannelId =
    process.env.STEAM_FREE_GAMES_CHANNEL_ID ??
    (process.env.DISCORD_GUILD_ID ? DEFAULT_STEAM_FREE_GAME_CHANNELS[process.env.DISCORD_GUILD_ID] ?? null : null);
  const epicFreeGamesChannelId =
    process.env.EPIC_FREE_GAMES_CHANNEL_ID ??
    (process.env.DISCORD_GUILD_ID ? DEFAULT_EPIC_FREE_GAME_CHANNELS[process.env.DISCORD_GUILD_ID] ?? null : null);
  const dailyCheckinLogChannelId =
    process.env.DAILY_CHECKIN_LOG_CHANNEL_ID ??
    (process.env.DISCORD_GUILD_ID ? DEFAULT_DAILY_CHECKIN_LOG_CHANNELS[process.env.DISCORD_GUILD_ID] ?? null : null);
  const steamUpdatePollMinutes = Number(process.env.STEAM_UPDATE_POLL_MINUTES ?? "1");
  const steamUpdateBatchSize = Number(process.env.STEAM_UPDATE_BATCH_SIZE ?? "120");
  const freeGamesPollMinutes = Number(process.env.FREE_GAMES_POLL_MINUTES ?? "10");
  const steamUpdateGames = (process.env.STEAM_UPDATE_GAMES ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const freeGamesCountryCode = (process.env.FREE_GAMES_COUNTRY_CODE ?? "VN").trim().toUpperCase();
  const freeGamesLocale = (process.env.FREE_GAMES_LOCALE ?? "vi").trim();

  if (!Number.isInteger(ticketHoursStart) || ticketHoursStart < 0 || ticketHoursStart > 23) {
    throw new Error("TICKET_HOURS_START must be an integer between 0 and 23.");
  }

  if (!Number.isInteger(ticketHoursEnd) || ticketHoursEnd < 1 || ticketHoursEnd > 24) {
    throw new Error("TICKET_HOURS_END must be an integer between 1 and 24.");
  }

  if (ticketHoursStart >= ticketHoursEnd) {
    throw new Error("TICKET_HOURS_START must be lower than TICKET_HOURS_END.");
  }

  if (healthPort !== null && (!Number.isInteger(healthPort) || healthPort <= 0 || healthPort > 65535)) {
    throw new Error("PORT must be a valid TCP port.");
  }

  if (!healthPath.startsWith("/")) {
    throw new Error("HEALTH_CHECK_PATH must start with '/'.");
  }

  if (!Number.isFinite(steamUpdatePollMinutes) || steamUpdatePollMinutes <= 0) {
    throw new Error("STEAM_UPDATE_POLL_MINUTES must be a positive number.");
  }

  if (!Number.isInteger(steamUpdateBatchSize) || steamUpdateBatchSize <= 0) {
    throw new Error("STEAM_UPDATE_BATCH_SIZE must be a positive integer.");
  }

  if (!Number.isFinite(freeGamesPollMinutes) || freeGamesPollMinutes <= 0) {
    throw new Error("FREE_GAMES_POLL_MINUTES must be a positive number.");
  }

  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordApplicationId: requireEnv("DISCORD_APPLICATION_ID"),
    discordGuildId: process.env.DISCORD_GUILD_ID,
    databaseUrl: requireEnv("DATABASE_URL"),
    ticketTimezone,
    ticketHoursStart,
    ticketHoursEnd,
    dailyCheckinLogChannelId,
    healthServer: {
      enabled: healthServerEnabled,
      host: healthHost,
      port: healthPort,
      path: healthPath
    },
    steamUpdates: {
      enabled: Boolean(steamUpdateChannelId),
      channelId: steamUpdateChannelId,
      curatorId: process.env.STEAM_UPDATE_CURATOR_ID ?? "26095454",
      pollIntervalMs: Math.round(steamUpdatePollMinutes * 60_000),
      batchSize: steamUpdateBatchSize,
      games: steamUpdateGames
    },
    freeGames: {
      enabled: Boolean(steamFreeGamesChannelId || epicFreeGamesChannelId),
      steamChannelId: steamFreeGamesChannelId,
      epicChannelId: epicFreeGamesChannelId,
      pollIntervalMs: Math.round(freeGamesPollMinutes * 60_000),
      countryCode: freeGamesCountryCode,
      locale: freeGamesLocale
    }
  };
}

export function getDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export function getDiscordCommandEnv(): Pick<BotEnv, "discordToken" | "discordApplicationId" | "discordGuildId"> {
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordApplicationId: requireEnv("DISCORD_APPLICATION_ID"),
    discordGuildId: process.env.DISCORD_GUILD_ID
  };
}
