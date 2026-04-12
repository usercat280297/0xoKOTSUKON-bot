export interface SteamTrackedGame {
  appId: number;
  title: string;
  storeUrl: string;
  imageUrl: string | null;
  steamDbPatchnotesUrl: string;
}

export interface SteamNewsItem {
  gid: string;
  title: string;
  url: string;
  contents: string;
  date: number;
  feedLabel: string | null;
}

export interface SteamStoreDetails {
  shortDescription: string | null;
  headerImageUrl: string | null;
  capsuleImageUrl: string | null;
  developers: string[];
  publishers: string[];
  genres: string[];
}

export interface SteamPublicVersionInfo {
  buildId: string | null;
  versionIsListable: boolean;
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
    news: SteamNewsItem | null;
    patchSummary: string;
    storeDetails: SteamStoreDetails | null;
    previousBuildId: string | null;
    currentBuildId: string | null;
    buildIdReliable: boolean;
    detectedAt: number;
  }): Promise<void>;
}

const CURATOR_PAGE_SIZE = 100;
const TRACKED_GAMES_REFRESH_MS = 6 * 60 * 60 * 1000;
const SWEEP_CONCURRENCY = 12;
const PATCH_KEYWORDS = [
  "update",
  "patch",
  "hotfix",
  "fix",
  "fixed",
  "changelog",
  "release notes",
  "maintenance",
  "version",
  "ver.",
  "build",
  "public branch",
  "content update"
];

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

export function normalizeSteamUpdateTitle(title: string): string {
  return decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
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
    const title = normalizeSteamUpdateTitle(match.groups?.title ?? "");
    games.push({
      appId,
      title,
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

function stripSteamMarkup(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\*\]/g, "\n• ")
    .replace(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[\/?(?:h\d|list|olist|quote|b|i|u)\]/gi, " ")
    .replace(/\[\/?[^\]]+\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function isLikelyGameUpdate(news: SteamNewsItem): boolean {
  const haystack = `${news.title} ${stripSteamMarkup(news.contents)}`.toLowerCase();
  if (PATCH_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  return /\bv?\d+\.\d+(\.\d+)?\b/.test(haystack);
}

export function isOfficialSteamNewsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "steamcommunity.com" || hostname.endsWith(".steamcommunity.com") || hostname === "store.steampowered.com";
  } catch {
    return false;
  }
}

export function pickLatestRelevantNews(newsItems: SteamNewsItem[]): SteamNewsItem | null {
  return newsItems.find((item) => isOfficialSteamNewsUrl(item.url) && isLikelyGameUpdate(item)) ?? null;
}

export function buildSteamNewsExcerpt(contents: string, maxLength = 260): string {
  const cleaned = stripSteamMarkup(contents);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
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

export function parseSteamPublicVersionPayload(payload: unknown): SteamPublicVersionInfo {
  if (!payload || typeof payload !== "object") {
    return {
      buildId: null,
      versionIsListable: false
    };
  }

  const response = (payload as Record<string, unknown>).response;
  if (!response || typeof response !== "object") {
    return {
      buildId: null,
      versionIsListable: false
    };
  }

  const responseRecord = response as Record<string, unknown>;
  const requiredVersion = responseRecord.required_version;

  return {
    buildId:
      typeof requiredVersion === "number" || typeof requiredVersion === "string" ? String(requiredVersion) : null,
    versionIsListable: responseRecord.version_is_listable === true
  };
}

export class SteamUpdateMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private trackedGames: SteamTrackedGame[] = [];
  private knownNewsByAppId = new Map<number, string>();
  private knownBuildByAppId = new Map<number, string>();
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
      const [latest, buildInfo] = await Promise.all([
        this.fetchLatestRelevantNews(game.appId),
        this.fetchCurrentPublicVersion(game.appId)
      ]);
      this.knownNewsByAppId.set(game.appId, latest?.gid ?? "");
      this.knownBuildByAppId.set(game.appId, buildInfo.buildId ?? "");
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
    const [latest, buildInfo] = await Promise.all([
      this.fetchLatestRelevantNews(game.appId),
      this.fetchCurrentPublicVersion(game.appId)
    ]);
    const knownGid = this.knownNewsByAppId.get(game.appId);
    const knownBuildId = this.knownBuildByAppId.get(game.appId) ?? "";
    const currentBuildId = buildInfo.buildId ?? "";

    if (!latest) {
      if (knownGid === undefined) {
        this.knownNewsByAppId.set(game.appId, "");
      }
    } else if (knownGid === undefined) {
      this.knownNewsByAppId.set(game.appId, latest.gid);
    }

    if (!this.knownBuildByAppId.has(game.appId)) {
      this.knownBuildByAppId.set(game.appId, currentBuildId);
    }

    const newsChanged = Boolean(latest && knownGid !== undefined && latest.gid !== knownGid);
    const buildChanged = currentBuildId.length > 0 && currentBuildId !== knownBuildId;

    if (!buildChanged && !(newsChanged && currentBuildId.length === 0)) {
      return;
    }

    this.knownNewsByAppId.set(game.appId, latest?.gid ?? "");
    this.knownBuildByAppId.set(game.appId, currentBuildId);

    const storeDetails = await this.fetchSteamStoreDetails(game.appId).catch((error) => {
      console.warn(`Failed to fetch Steam store details for app ${game.appId}.`, error);
      return null;
    });

    await this.gateway.sendSteamUpdateNotification({
      channelId: this.config.channelId!,
      game,
      news: latest,
      patchSummary: latest
        ? buildSteamNewsExcerpt(latest.contents, 900)
        : "Steam ghi nhận public version mới nhưng chưa thấy patch notes chính thức trong Steam News.",
      storeDetails,
      previousBuildId: knownBuildId.length > 0 ? knownBuildId : null,
      currentBuildId: currentBuildId.length > 0 ? currentBuildId : null,
      buildIdReliable: buildInfo.versionIsListable,
      detectedAt: latest?.date ?? Math.floor(Date.now() / 1000)
    });
  }

  private async fetchLatestRelevantNews(appId: number): Promise<SteamNewsItem | null> {
    const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
    url.searchParams.set("appid", String(appId));
    url.searchParams.set("count", "5");
    url.searchParams.set("maxlength", "600");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 0xoKITSU-ticket-bot/1.0)"
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Steam news for app ${appId}: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      appnews?: {
        newsitems?: Array<{
          gid: string;
          title: string;
          url: string;
          contents: string;
          date: number;
          feedlabel?: string;
        }>;
      };
    };

    const newsItems: SteamNewsItem[] = (payload.appnews?.newsitems ?? []).map((item) => ({
      gid: String(item.gid),
      title: decodeHtmlEntities(item.title),
      url: item.url,
      contents: item.contents,
      date: item.date,
      feedLabel: item.feedlabel ?? null
    }));

    return pickLatestRelevantNews(newsItems);
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

  private async fetchCurrentPublicVersion(appId: number): Promise<SteamPublicVersionInfo> {
    const url = new URL("https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/");
    url.searchParams.set("appid", String(appId));
    url.searchParams.set("version", "0");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 0xoKITSU-ticket-bot/1.0)"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Steam public version for app ${appId}: ${response.status} ${response.statusText}`
      );
    }

    return parseSteamPublicVersionPayload(await response.json());
  }
}
