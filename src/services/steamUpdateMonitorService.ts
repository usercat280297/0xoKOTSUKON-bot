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
    news: SteamNewsItem;
    excerpt: string;
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
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\/?[^\]]+\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyGameUpdate(news: SteamNewsItem): boolean {
  const haystack = `${news.title} ${stripSteamMarkup(news.contents)}`.toLowerCase();
  if (PATCH_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  return /\bv?\d+\.\d+(\.\d+)?\b/.test(haystack);
}

export function pickLatestRelevantNews(newsItems: SteamNewsItem[]): SteamNewsItem | null {
  return newsItems.find((item) => isLikelyGameUpdate(item)) ?? null;
}

export function buildSteamNewsExcerpt(contents: string, maxLength = 260): string {
  const cleaned = stripSteamMarkup(contents);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

export class SteamUpdateMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private trackedGames: SteamTrackedGame[] = [];
  private knownNewsByAppId = new Map<number, string>();
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
    await this.primeKnownNews();
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

  private async primeKnownNews(): Promise<void> {
    if (this.trackedGames.length === 0) {
      return;
    }

    await this.runWithConcurrency(this.trackedGames, SWEEP_CONCURRENCY, async (game) => {
      const latest = await this.fetchLatestRelevantNews(game.appId);
      this.knownNewsByAppId.set(game.appId, latest?.gid ?? "");
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
    const latest = await this.fetchLatestRelevantNews(game.appId);
    const knownGid = this.knownNewsByAppId.get(game.appId);

    if (!latest) {
      if (knownGid === undefined) {
        this.knownNewsByAppId.set(game.appId, "");
      }
      return;
    }

    if (knownGid === undefined) {
      this.knownNewsByAppId.set(game.appId, latest.gid);
      return;
    }

    if (knownGid === latest.gid) {
      return;
    }

    this.knownNewsByAppId.set(game.appId, latest.gid);
    await this.gateway.sendSteamUpdateNotification({
      channelId: this.config.channelId!,
      game,
      news: latest,
      excerpt: buildSteamNewsExcerpt(latest.contents)
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
}
