import { Client, GatewayIntentBits } from "discord.js";
import type { Pool } from "pg";
import type { BotEnv } from "./config/env";
import { handleChatInputCommand } from "./commands/handleChatInputCommand";
import { createPool } from "./db/pool";
import { handleButtonInteraction, handleStringSelectMenuInteraction } from "./interactions/router";
import { PostgresGuildConfigRepository } from "./repositories/postgresGuildConfigRepository";
import { PostgresPanelRepository } from "./repositories/postgresPanelRepository";
import { PostgresTicketRepository } from "./repositories/postgresTicketRepository";
import { BusinessHoursService } from "./services/businessHoursService";
import { DiscordJsTicketGateway } from "./services/discordGateway";
import { PanelService } from "./services/panelService";
import { PermissionService } from "./services/permissionService";
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
  const panelRepository = new PostgresPanelRepository(pool);
  const ticketRepository = new PostgresTicketRepository(pool);
  const businessHours = new BusinessHoursService({
    timezone: env.ticketTimezone,
    startHour: env.ticketHoursStart,
    endHour: env.ticketHoursEnd
  });
  const gateway = new DiscordJsTicketGateway(client, businessHours);
  const permissionService = new PermissionService();
  const transcriptService = new TranscriptService();
  const steamActivationScreenshots = new TesseractSteamActivationScreenshotService();

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
          tickets: ticketService
        });
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction, {
          panels: panelService,
          tickets: ticketService
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
    },
    async stop() {
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
