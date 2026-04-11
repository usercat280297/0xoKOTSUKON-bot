import { once } from "node:events";
import { Client, GatewayIntentBits } from "discord.js";
import { getBotEnv } from "../config/env";
import { createPool } from "../db/pool";
import { PostgresGuildConfigRepository } from "../repositories/postgresGuildConfigRepository";
import { PostgresPanelRepository } from "../repositories/postgresPanelRepository";
import { DiscordJsTicketGateway } from "../services/discordGateway";
import { slugifyTicketName } from "../utils/formatters";

const CURATOR_ID = "26095454";
const PAGE_SIZE = 100;
const PANEL_NAME = "STEAM ACTIVATION";
const PANEL_PLACEHOLDER = "Choose a Steam game with Denuvo";

const DEFAULT_SEED_CONFIG = {
  panelChannelId: "1492135004942110740",
  requiredRoleId: "1492130518869999737",
  redirectChannelId: "1492265306385678336",
  targetCategoryId: "1492265692878078142",
  staffRoleId: "1492077048930369678"
} as const;

type SectionLabel = "Steam (A-H)" | "Steam (H-Z)";

interface SeedConfig {
  guildId: string;
  panelChannelId: string;
  requiredRoleId: string;
  redirectChannelId: string;
  targetCategoryId: string;
  staffRoleId: string;
}

interface SeedGameEntry {
  title: string;
  section: SectionLabel;
  sortOrder: number;
}

function parseExplicitTitlesFromArgs(): string[] {
  const gamesArgument = process.argv.find((argument) => argument.startsWith("--games="));
  if (!gamesArgument) {
    return [];
  }

  return gamesArgument
    .slice("--games=".length)
    .split("|")
    .map((title) => normalizeTitle(title))
    .filter(Boolean);
}

function resolveSeedTitles(): { titles: string[]; sourceLabel: string } {
  const envTitles = (process.env.SEED_GAMES ?? "")
    .split("|")
    .map((title) => normalizeTitle(title))
    .filter(Boolean);
  if (envTitles.length > 0) {
    return {
      titles: [...new Set(envTitles)],
      sourceLabel: "explicit game list from SEED_GAMES"
    };
  }

  const argTitles = parseExplicitTitlesFromArgs();
  if (argTitles.length > 0) {
    return {
      titles: [...new Set(argTitles)],
      sourceLabel: "explicit game list from --games"
    };
  }

  return {
    titles: [],
    sourceLabel: "live Steam Denuvo Watch curator"
  };
}

function resolveSeedConfig() {
  const env = getBotEnv();
  if (!env.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required to seed a guild-scoped panel.");
  }

  const config: SeedConfig = {
    guildId: env.discordGuildId,
    panelChannelId: process.env.SEED_PANEL_CHANNEL_ID ?? DEFAULT_SEED_CONFIG.panelChannelId,
    requiredRoleId: process.env.SEED_REQUIRED_ROLE_ID ?? DEFAULT_SEED_CONFIG.requiredRoleId,
    redirectChannelId: process.env.SEED_REDIRECT_CHANNEL_ID ?? DEFAULT_SEED_CONFIG.redirectChannelId,
    targetCategoryId: process.env.SEED_TARGET_CATEGORY_ID ?? DEFAULT_SEED_CONFIG.targetCategoryId,
    staffRoleId: process.env.SEED_STAFF_ROLE_ID ?? DEFAULT_SEED_CONFIG.staffRoleId
  };

  return { env, config };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function normalizeTitle(title: string): string {
  return decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
}

function getSectionLabel(title: string): SectionLabel {
  const firstLetter = title.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? "Z";
  return firstLetter <= "H" ? "Steam (A-H)" : "Steam (H-Z)";
}

function truncateLabel(title: string): string {
  return title.length <= 100 ? title : `${title.slice(0, 97).trimEnd()}...`;
}

function buildUniqueValue(title: string, usedValues: Set<string>): string {
  const base = slugifyTicketName(title) || "steam-game";
  let candidate = base;
  let suffix = 2;

  while (usedValues.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 40 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  usedValues.add(candidate);
  return candidate;
}

async function fetchCurrentDenuvoTitles(): Promise<string[]> {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (let start = 0; ; start += PAGE_SIZE) {
    const url = new URL(
      `https://store.steampowered.com/curator/${CURATOR_ID}-Denuvo-Watch/ajaxgetfilteredrecommendations/render/`
    );
    url.searchParams.set("query", "");
    url.searchParams.set("start", String(start));
    url.searchParams.set("count", String(PAGE_SIZE));
    url.searchParams.set("tagids", "");
    url.searchParams.set("sort", "recent");
    url.searchParams.set("app_types", "");
    url.searchParams.set("curations", "");
    url.searchParams.set("reset", "false");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 0xoKITSU-ticket-bot/1.0)"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch curator page ${start / PAGE_SIZE + 1}: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { results_html?: string };
    const html = payload.results_html ?? "";
    const pageTitles = [...html.matchAll(/capsule_image_ctn smallcapsule"><img[^>]*alt="([^"]+)"/g)]
      .map((match) => normalizeTitle(match[1]))
      .filter(Boolean);

    if (pageTitles.length === 0) {
      break;
    }

    for (const title of pageTitles) {
      if (seen.has(title)) {
        continue;
      }

      seen.add(title);
      titles.push(title);
    }

    if (pageTitles.length < PAGE_SIZE) {
      break;
    }
  }

  return titles.sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function buildSeedEntries(titles: string[]): SeedGameEntry[] {
  const grouped = new Map<SectionLabel, string[]>([
    ["Steam (A-H)", []],
    ["Steam (H-Z)", []]
  ]);

  for (const title of titles) {
    grouped.get(getSectionLabel(title))!.push(title);
  }

  const entries: SeedGameEntry[] = [];
  let sortOrder = 1;
  for (const section of ["Steam (A-H)", "Steam (H-Z)"] as const) {
    for (const title of grouped.get(section) ?? []) {
      entries.push({
        title,
        section,
        sortOrder
      });
      sortOrder += 1;
    }
  }

  return entries;
}

async function waitForReady(client: Client): Promise<void> {
  if (client.isReady()) {
    return;
  }

  await once(client, "clientReady");
}

async function main(): Promise<void> {
  const { env, config } = resolveSeedConfig();
  const pool = createPool(env.databaseUrl);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  try {
    const requestedTitles = resolveSeedTitles();
    const titles =
      requestedTitles.titles.length > 0 ? requestedTitles.titles : await fetchCurrentDenuvoTitles();

    console.log(`Seeding board from ${requestedTitles.sourceLabel}...`);
    const entries = buildSeedEntries(titles);
    const counts = entries.reduce<Record<SectionLabel, number>>(
      (current, entry) => {
        current[entry.section] += 1;
        return current;
      },
      {
        "Steam (A-H)": 0,
        "Steam (H-Z)": 0
      }
    );

    console.log(`Resolved ${entries.length} unique Steam entries.`);
    console.log(`Steam (A-H): ${counts["Steam (A-H)"]}`);
    console.log(`Steam (H-Z): ${counts["Steam (H-Z)"]}`);

    console.log("Connecting to Discord...");
    await client.login(env.discordToken);
    await waitForReady(client);

    const panels = new PostgresPanelRepository(pool);
    const guildConfigs = new PostgresGuildConfigRepository(pool);
    const gateway = new DiscordJsTicketGateway(client);

    const existingPanels = await panels.listByGuildId(config.guildId);
    const reusablePanel = existingPanels.find(
      (panel) =>
        panel.channelId === config.panelChannelId &&
        panel.active &&
        (panel.template === "game-activation" || (panel.options.length === 0 && panel.messageIds.length === 0))
    );

    let panelId = reusablePanel?.id ?? null;
    if (panelId) {
      await pool.query(
        `
          UPDATE ticket_panels
          SET
            name = $2,
            placeholder = $3,
            template = 'game-activation',
            active = TRUE
          WHERE id = $1
        `,
        [panelId, PANEL_NAME, PANEL_PLACEHOLDER]
      );
      console.log(`Reusing panel ${panelId}.`);
    } else {
      const createdPanel = await panels.create({
        guildId: config.guildId,
        name: PANEL_NAME,
        channelId: config.panelChannelId,
        placeholder: PANEL_PLACEHOLDER,
        template: "game-activation"
      });
      panelId = createdPanel.id;
      console.log(`Created panel ${panelId}.`);
    }

    await pool.query("DELETE FROM ticket_options WHERE panel_id = $1", [panelId]);

    const usedValues = new Set<string>();
    for (const entry of entries) {
      await panels.addOption({
        panelId,
        value: buildUniqueValue(entry.title, usedValues),
        label: truncateLabel(entry.title),
        emoji: null,
        boardSection: entry.section,
        stockRemaining: null,
        stockTotal: null,
        sortOrder: entry.sortOrder,
        requiredRoleId: config.requiredRoleId,
        redirectChannelId: config.redirectChannelId,
        targetCategoryId: config.targetCategoryId,
        staffRoleId: config.staffRoleId
      });
    }

    const currentGuildConfig = await guildConfigs.getByGuildId(config.guildId);
    if (!currentGuildConfig?.logChannelId) {
      console.log("Guild log channel was empty. Leaving it unchanged because this seed only manages panels.");
    }

    const panel = await panels.getById(panelId);
    if (!panel) {
      throw new Error(`Panel ${panelId} disappeared before publish.`);
    }

    const messageIds = await gateway.sendPanelMessage(panel);
    await panels.savePublishedMessages(panelId, messageIds);

    console.log(`Published panel ${panelId} into channel ${config.panelChannelId}.`);
    console.log(`Message count: ${messageIds.length}`);
    console.log(`Required role: ${config.requiredRoleId}`);
    console.log(`Staff role: ${config.staffRoleId}`);
  } finally {
    client.destroy();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to seed Steam Denuvo board.", error);
  process.exitCode = 1;
});
