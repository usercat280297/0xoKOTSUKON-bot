export interface SteamTrackedGame {
  appId: number;
  title: string;
  storeUrl: string;
  imageUrl: string | null;
  steamDbPatchnotesUrl: string;
}

export interface SteamDbPatchnotesItem {
  guid: string;
  buildId: string;
  title: string;
  url: string;
  description: string;
  date: number;
  thumbnailUrl: string | null;
}

export interface SteamStoreDetails {
  shortDescription: string | null;
  headerImageUrl: string | null;
  capsuleImageUrl: string | null;
  developers: string[];
  publishers: string[];
  genres: string[];
}

export interface SteamUpdateMonitorConfig {
  enabled: boolean;
  channelId: string | null;
  curatorId: string;
  pollIntervalMs: number;
  batchSize: number;
  games: string[];
}

export interface SteamUpdateGateway {
  sendSteamUpdateNotification(params: {
    channelId: string;
    game: SteamTrackedGame;
    patch: SteamDbPatchnotesItem;
    patchSummary: string;
    storeDetails: SteamStoreDetails | null;
    previousBuildId: string | null;
    currentBuildId: string;
    detectedAt: number;
  }): Promise<void>;
}

const CURATOR_PAGE_SIZE = 100;
const TRACKED_GAMES_REFRESH_MS = 6 * 60 * 60 * 1000;
const SWEEP_CONCURRENCY = 12;

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

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function readXmlTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  if (!match) {
    return null;
  }

  return stripCdata(match[1]);
}

function readXmlAttribute(block: string, tag: string, attribute: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attribute}="([^"]+)"[^>]*\\/?>`, "i").exec(block);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function parsePubDate(value: string | null): number {
  if (!value) {
    return Math.floor(Date.now() / 1000);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(timestamp / 1000);
}

function buildSteamDbPatchLink(appId: number, buildId: string): string {
  return `https://steamdb.info/patchnotes/${buildId}/?appid=${appId}`;
}

export function normalizeSteamUpdateTitle(title: string): string {
  return normalizeWhitespace(title);
}

export function parseCuratorGamesHtml(html: string): SteamTrackedGame[] {
  const matches = html.matchAll(
    /<a[^>]*data-ds-appid="(?<appId>\d+)"[^>]*href="(?<href>[^"]+)"[^>]*>[\s\S]*?<img src="(?<image>[^"]+)" alt="(?<title>[^"]+)"/g
  );
  const seen = new Set<number>();
  const games: SteamTrackedGame[] = [];

  for (const match of matches) {
    const appId = Number(match.groups?.appId ?? "");
    if (!Number.isInteger(appId) || seen.has(appId)) {
      continue;
    }

    seen.add(appId);
    games.push({
      appId,
      title: normalizeSteamUpdateTitle(match.groups?.title ?? ""),
      storeUrl: decodeHtmlEntities(match.groups?.href ?? `https://store.steampowered.com/app/${appId}/`),
      imageUrl: match.groups?.image ? decodeHtmlEntities(match.groups.image) : null,
      steamDbPatchnotesUrl: `https://steamdb.info/app/${appId}/patchnotes/`
    });
  }

  return games;
}

export function selectTrackedGames(games: SteamTrackedGame[], requestedTitles: string[]): SteamTrackedGame[] {
  if (requestedTitles.length === 0) {
    return games;
  }

  const requested = new Set(requestedTitles.map((title) => normalizeSteamUpdateTitle(title).toLowerCase()));
  return games.filter((game) => requested.has(normalizeSteamUpdateTitle(game.title).toLowerCase()));
}

export function buildSteamDbPatchExcerpt(description: string, maxLength = 260): string {
  const cleaned = normalizeWhitespace(description);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

export function parseSteamDbPatchnotesRss(xml: string, appId?: number): SteamDbPatchnotesItem[] {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const parsed = items
    .map((item): SteamDbPatchnotesItem | null => {
      const guid = normalizeWhitespace(readXmlTag(item, "guid") ?? "");
      const title = normalizeWhitespace(readXmlTag(item, "title") ?? "");
      const link = decodeHtmlEntities(readXmlTag(item, "link") ?? "");
      const description = normalizeWhitespace(readXmlTag(item, "description") ?? "");
      const pubDate = readXmlTag(item, "pubDate");
      const thumbnailUrl = readXmlAttribute(item, "media:thumbnail", "url");
      const buildIdFromGuid = /build#(\d+)/i.exec(guid)?.[1] ?? null;
      const buildIdFromDescription = /build\s+(\d+)/i.exec(description)?.[1] ?? null;
      const buildIdFromLink = /patchnotes\/(\d+)/i.exec(link)?.[1] ?? null;
      const buildId = buildIdFromGuid ?? buildIdFromDescription ?? buildIdFromLink;

      if (!guid || !title || !buildId) {
        return null;
      }

      return {
        guid,
        buildId,
        title,
        url: link || (appId ? buildSteamDbPatchLink(appId, buildId) : ""),
        description,
        date: parsePubDate(pubDate),
        thumbnailUrl
      };
    })
    .filter((item): item is SteamDbPatchnotesItem => item !== null)
    .sort((left, right) => right.date - left.date);

  return parsed;
}

export function parseSteamStoreDetailsPayload(payload: unknown, appId: number): SteamStoreDetails | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const entry = (payload as Record<string, unknown>)[String(appId)];
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const success = (entry as Record<string, unknown>).success;
  const data = (entry as Record<string, unknown>).data;
  if (!success || !data || typeof data !== "object") {
    return null;
  }

  const dataRecord = data as Record<string, unknown>;
  const genres = Array.isArray(dataRecord.genres)
    ? dataRecord.genres
        .map((genre) => (genre && typeof genre === "object" ? (genre as Record<string, unknown>).description : null))
        .filter((genre): genre is string => typeof genre === "string" && genre.length > 0)
    : [];

  return {
    shortDescription:
      typeof dataRecord.short_description === "string" && dataRecord.short_description.length > 0
        ? decodeHtmlEntities(dataRecord.short_description)
        : null,
    headerImageUrl: typeof dataRecord.header_image === "string" ? dataRecord.header_image : null,
    capsuleImageUrl: typeof dataRecord.capsule_image === "string" ? dataRecord.capsule_image : null,
    developers: Array.isArray(dataRecord.developers)
      ? dataRecord.developers.filter((developer): developer is string => typeof developer === "string")
      : [],
    publishers: Array.isArray(dataRecord.publishers)
      ? dataRecord.publishers.filter((publisher): publisher is string => typeof publisher === "string")
      : [],
    genres
  };
}

export class SteamUpdateMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private trackedGames: SteamTrackedGame[] = [];
  private knownLatestBuildByAppId = new Map<number, string>();
  private lastCatalogRefreshAt = 0;
  private nextCursor = 0;
  private sweepRunning = false;

  public constructor(
    private readonly gateway: SteamUpdateGateway,
    private readonly config: SteamUpdateMonitorConfig
  ) {}

  public async start(): Promise<void> {
    if (!this.config.enabled || !this.config.channelId) {
      return;
    }

    await this.refreshTrackedGamesIfNeeded(true);
    await this.primeKnownState();
    this.timer = setInterval(() => {
      void this.runSweep().catch((error) => {
        console.error("Steam update sweep failed.", error);
      });
    }, this.config.pollIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runSweep(): Promise<void> {
    if (!this.config.enabled || !this.config.channelId || this.sweepRunning) {
      return;
    }

    this.sweepRunning = true;
    try {
      await this.refreshTrackedGamesIfNeeded();
      if (this.trackedGames.length === 0) {
        return;
      }

      const batch = this.nextBatch();
      await this.runWithConcurrency(batch, SWEEP_CONCURRENCY, (game) => this.checkGame(game));
    } finally {
      this.sweepRunning = false;
    }
  }

  private nextBatch(): SteamTrackedGame[] {
    const batchSize = Math.min(this.config.batchSize, this.trackedGames.length);
    const batch: SteamTrackedGame[] = [];

    for (let offset = 0; offset < batchSize; offset += 1) {
      const index = (this.nextCursor + offset) % this.trackedGames.length;
      batch.push(this.trackedGames[index]);
    }

    this.nextCursor = (this.nextCursor + batchSize) % this.trackedGames.length;
    return batch;
  }

  private async refreshTrackedGamesIfNeeded(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastCatalogRefreshAt < TRACKED_GAMES_REFRESH_MS) {
      return;
    }

    this.trackedGames = await this.fetchTrackedGames();
    this.lastCatalogRefreshAt = now;
    this.nextCursor = 0;
  }

  private async primeKnownState(): Promise<void> {
    if (this.trackedGames.length === 0) {
      return;
    }

    await this.runWithConcurrency(this.trackedGames, SWEEP_CONCURRENCY, async (game) => {
      const patches = await this.fetchSteamDbPatchnotes(game.appId);
      this.knownLatestBuildByAppId.set(game.appId, patches[0]?.buildId ?? "");
    });
  }

  private async runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const queue = [...items];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) {
          return;
        }

        await worker(item);
      }
    });

    await Promise.all(workers);
  }

  private async fetchTrackedGames(): Promise<SteamTrackedGame[]> {
    const games: SteamTrackedGame[] = [];
    const seenAppIds = new Set<number>();

    for (let start = 0; ; start += CURATOR_PAGE_SIZE) {
      const url = new URL(
        `https://store.steampowered.com/curator/${this.config.curatorId}-Denuvo-Watch/ajaxgetfilteredrecommendations/render/`
      );
      url.searchParams.set("query", "");
      url.searchParams.set("start", String(start));
      url.searchParams.set("count", String(CURATOR_PAGE_SIZE));
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
        throw new Error(`Failed to fetch Denuvo curator page: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as { results_html?: string };
      const pageGames = parseCuratorGamesHtml(payload.results_html ?? "").filter((game) => {
        if (seenAppIds.has(game.appId)) {
          return false;
        }

        seenAppIds.add(game.appId);
        return true;
      });

      if (pageGames.length === 0) {
        break;
      }

      games.push(...pageGames);

      if (pageGames.length < CURATOR_PAGE_SIZE) {
        break;
      }
    }

    return selectTrackedGames(games, this.config.games).sort((left, right) =>
      left.title.localeCompare(right.title, "en", { sensitivity: "base" })
    );
  }

  private async checkGame(game: SteamTrackedGame): Promise<void> {
    const patches = await this.fetchSteamDbPatchnotes(game.appId);
    const latestPatch = patches[0] ?? null;
    if (!latestPatch) {
      if (!this.knownLatestBuildByAppId.has(game.appId)) {
        this.knownLatestBuildByAppId.set(game.appId, "");
      }
      return;
    }

    const knownLatestBuildId = this.knownLatestBuildByAppId.get(game.appId);
    if (knownLatestBuildId === undefined) {
      this.knownLatestBuildByAppId.set(game.appId, latestPatch.buildId);
      return;
    }

    if (knownLatestBuildId === latestPatch.buildId) {
      return;
    }

    this.knownLatestBuildByAppId.set(game.appId, latestPatch.buildId);

    const storeDetails = await this.fetchSteamStoreDetails(game.appId).catch((error) => {
      console.warn(`Failed to fetch Steam store details for app ${game.appId}.`, error);
      return null;
    });

    const previousBuildId = patches[1]?.buildId ?? (knownLatestBuildId.length > 0 ? knownLatestBuildId : null);

    await this.gateway.sendSteamUpdateNotification({
      channelId: this.config.channelId!,
      game,
      patch: latestPatch,
      patchSummary: buildSteamDbPatchExcerpt(latestPatch.description, 900),
      storeDetails,
      previousBuildId,
      currentBuildId: latestPatch.buildId,
      detectedAt: latestPatch.date
    });
  }

  private async fetchSteamDbPatchnotes(appId: number): Promise<SteamDbPatchnotesItem[]> {
    const url = new URL("https://steamdb.info/api/PatchnotesRSS/");
    url.searchParams.set("appid", String(appId));

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 0xoKITSU-ticket-bot/1.0)",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch SteamDB patchnotes RSS for app ${appId}: ${response.status} ${response.statusText}`);
    }

    return parseSteamDbPatchnotesRss(await response.text(), appId);
  }

  private async fetchSteamStoreDetails(appId: number): Promise<SteamStoreDetails | null> {
    const url = new URL("https://store.steampowered.com/api/appdetails");
    url.searchParams.set("appids", String(appId));
    url.searchParams.set("l", "english");
    url.searchParams.set("cc", "us");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 0xoKITSU-ticket-bot/1.0)"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Steam app details for app ${appId}: ${response.status} ${response.statusText}`);
    }

    return parseSteamStoreDetailsPayload(await response.json(), appId);
  }
}
