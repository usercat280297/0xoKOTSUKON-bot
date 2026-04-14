import { Client, GatewayIntentBits } from "discord.js";
import type { Pool } from "pg";
import type { BotEnv } from "./config/env";
import { handleChatInputCommand } from "./commands/handleChatInputCommand";
import { createPool } from "./db/pool";
import { handleButtonInteraction, handleModalSubmitInteraction, handleStringSelectMenuInteraction } from "./interactions/router";
import { PostgresGuildConfigRepository } from "./repositories/postgresGuildConfigRepository";
import { PostgresDailyCheckinRepository } from "./repositories/postgresDailyCheckinRepository";
import { PostgresFreeGameStateRepository } from "./repositories/postgresFreeGameStateRepository";
import { PostgresPanelRepository } from "./repositories/postgresPanelRepository";
import { PostgresSteamUpdateStateRepository } from "./repositories/postgresSteamUpdateStateRepository";
import { PostgresTicketRepository } from "./repositories/postgresTicketRepository";
import { BusinessHoursService } from "./services/businessHoursService";
import { DailyCheckinService } from "./services/dailyCheckinService";
import { DiscordJsTicketGateway } from "./services/discordGateway";
import { FreeGameMonitorService } from "./services/freeGameMonitorService";
import { PanelService } from "./services/panelService";
import { PermissionService } from "./services/permissionService";
import { SelfRoleService } from "./services/selfRoleService";
import { SteamUpdateMonitorService } from "./services/steamUpdateMonitorService";
import { TesseractSteamActivationScreenshotService } from "./services/steamActivationScreenshotService";
import { TicketService } from "./services/ticketService";
import { TranscriptService } from "./services/transcriptService";

export interface BotApp {
  client: Client;
  pool: Pool;
  start(): Promise<void>;
  stop(): Promise<void>;
  getHealth(): Promise<{
    status: "ok" | "degraded";
    discordReady: boolean;
    databaseOk: boolean;
    startedAt: string;
    uptimeSeconds: number;
  }>;
}

export function createBotApp(env: BotEnv): BotApp {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });
  const pool = createPool(env.databaseUrl);
  const startedAt = new Date();

  const guildConfigs = new PostgresGuildConfigRepository(pool);
  const dailyCheckins = new PostgresDailyCheckinRepository(pool);
  const freeGameStates = new PostgresFreeGameStateRepository(pool);
  const panelRepository = new PostgresPanelRepository(pool);
  const steamUpdateStates = new PostgresSteamUpdateStateRepository(pool);
  const ticketRepository = new PostgresTicketRepository(pool);
  const businessHours = new BusinessHoursService({
    timezone: env.ticketTimezone,
    startHour: env.ticketHoursStart,
    endHour: env.ticketHoursEnd
  });
  const gateway = new DiscordJsTicketGateway(client, businessHours);
  const permissionService = new PermissionService();
  const transcriptService = new TranscriptService();
  const selfRoleService = new SelfRoleService(gateway);
  const dailyCheckinService = new DailyCheckinService(dailyCheckins, env.ticketTimezone);
  const steamActivationScreenshots = new TesseractSteamActivationScreenshotService();
  const freeGames = new FreeGameMonitorService(gateway, freeGameStates, env.freeGames);
  const steamUpdates = new SteamUpdateMonitorService(gateway, steamUpdateStates, env.steamUpdates);
  let deadlineSweepTimer: NodeJS.Timeout | null = null;

  const panelService = new PanelService(panelRepository, gateway);
  const ticketService = new TicketService(
    guildConfigs,
    panelRepository,
    ticketRepository,
    gateway,
    permissionService,
    transcriptService,
    businessHours,
    steamActivationScreenshots
  );

  client.once("clientReady", () => {
    console.log(`Logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatInputCommand(interaction, {
          guildConfigs,
          panels: panelService,
          tickets: ticketService
        });
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await handleStringSelectMenuInteraction(interaction, {
          panels: panelService,
          tickets: ticketService,
          selfRoles: selfRoleService,
          dailyCheckins: dailyCheckinService,
          gateway,
          dailyCheckinLogChannelId: env.dailyCheckinLogChannelId
        });
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction, {
          panels: panelService,
          tickets: ticketService,
          selfRoles: selfRoleService,
          dailyCheckins: dailyCheckinService,
          gateway,
          dailyCheckinLogChannelId: env.dailyCheckinLogChannelId
        });
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModalSubmitInteraction(interaction, {
          panels: panelService,
          tickets: ticketService,
          selfRoles: selfRoleService,
          dailyCheckins: dailyCheckinService,
          gateway,
          dailyCheckinLogChannelId: env.dailyCheckinLogChannelId
        });
      }
    } catch (error) {
      console.error("Failed to handle interaction.", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "An unexpected error occurred while handling this interaction.",
          ephemeral: true
        });
      }
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.inGuild()) {
      return;
    }

    try {
      await ticketService.handleIncomingTicketMessage({
        channelId: message.channelId,
        authorId: message.author.id,
        attachments: [...message.attachments.values()].map((attachment) => ({
          name: attachment.name ?? attachment.url.split("/").pop() ?? "attachment",
          url: attachment.url,
          contentType: attachment.contentType
        }))
      });
    } catch (error) {
      console.error("Failed to handle incoming ticket message.", error);
    }
  });

  return {
    client,
    pool,
    async start() {
      await client.login(env.discordToken);
      await freeGames.start().catch((error) => {
        console.error("Failed to start free game monitor.", error);
      });
      await steamUpdates.start().catch((error) => {
        console.error("Failed to start Steam update monitor.", error);
      });
      await ticketService.processExpiredSteamDeadlines().catch((error) => {
        console.error("Failed to process ticket deadlines on startup.", error);
      });
      deadlineSweepTimer = setInterval(() => {
        ticketService.processExpiredSteamDeadlines().catch((error) => {
          console.error("Failed to process ticket deadlines.", error);
        });
      }, 15_000);
    },
    async stop() {
      if (deadlineSweepTimer) {
        clearInterval(deadlineSweepTimer);
        deadlineSweepTimer = null;
      }
      await freeGames.stop();
      await steamUpdates.stop();
      client.destroy();
      await pool.end();
    },
    async getHealth() {
      let databaseOk = false;

      try {
        await pool.query("select 1");
        databaseOk = true;
      } catch (error) {
        console.error("Database health check failed.", error);
      }

      const discordReady = client.isReady();

      return {
        status: discordReady && databaseOk ? "ok" : "degraded",
        discordReady,
        databaseOk,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000)
      };
    }
  };
}
