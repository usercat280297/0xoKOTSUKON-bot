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
  healthServer: {
    enabled: boolean;
    host: string;
    port: number | null;
    path: string;
  };
}

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

  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    discordApplicationId: requireEnv("DISCORD_APPLICATION_ID"),
    discordGuildId: process.env.DISCORD_GUILD_ID,
    databaseUrl: requireEnv("DATABASE_URL"),
    ticketTimezone,
    ticketHoursStart,
    ticketHoursEnd,
    healthServer: {
      enabled: healthServerEnabled,
      host: healthHost,
      port: healthPort,
      path: healthPath
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
