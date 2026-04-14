import type { FreeGamePlatform, FreeGameStateRepository } from "../repositories/interfaces";
import { parseSteamStoreDetailsPayload } from "./steamUpdateMonitorService";

export interface FreeGameOffer {
  platform: FreeGamePlatform;
  gameId: string;
  title: string;
  storeUrl: string;
  imageUrl: string | null;
  description: string | null;
  seller: string | null;
  originalPriceText: string;
  offerKey: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface FreeGameMonitorConfig {
  enabled: boolean;
  steamChannelId: string | null;
  epicChannelId: string | null;
  pollIntervalMs: number;
  countryCode: string;
  locale: string;
}

export interface FreeGameGateway {
  sendFreeGameNotification(params: {
    channelId: string;
    offer: FreeGameOffer;
  }): Promise<void>;
}

interface EpicPromotionPayload {
  data?: {
    Catalog?: {
      searchStore?: {
        elements?: unknown[];
      };
    };
  };
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

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function normalizePriceText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s*₫/g, "đ").replace(/\s+/g, " ").trim();
}

function formatVndPrice(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;
}

function parseStorePath(url: string): { kind: "app" | "sub"; id: string; cleanUrl: string } | null {
  try {
    const parsed = new URL(url);
    const match = /^\/(?<kind>app|sub)\/(?<id>\d+)\//.exec(parsed.pathname);
    if (!match?.groups) {
      return null;
    }

    return {
      kind: match.groups.kind as "app" | "sub",
      id: match.groups.id,
      cleanUrl: `${parsed.origin}${parsed.pathname}`
    };
  } catch {
    return null;
  }
}

export function parseSteamFreeGamesSearchHtml(html: string): FreeGameOffer[] {
  const blocks = html.match(/<a\b[\s\S]*?<\/a>/g) ?? [];
  const offers: FreeGameOffer[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (!/data-discount="100"/.test(block) || !/data-price-final="0"/.test(block)) {
      continue;
    }

    const href = /<a\b[^>]*href="([^"]+)"/.exec(block)?.[1] ?? null;
    const title = /<span class="title">([\s\S]*?)<\/span>/.exec(block)?.[1] ?? null;
    const imageUrl = /<img src="([^"]+)"/.exec(block)?.[1] ?? null;
    const originalPrice = /<div class="discount_original_price">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? null;
    if (!href || !title || !originalPrice) {
      continue;
    }

    const storePath = parseStorePath(decodeHtmlEntities(href));
    if (!storePath) {
      continue;
    }

    const gameId = `${storePath.kind}:${storePath.id}`;
    if (seen.has(gameId)) {
      continue;
    }

    seen.add(gameId);
    offers.push({
      platform: "steam",
      gameId,
      title: normalizeWhitespace(title),
      storeUrl: storePath.cleanUrl,
      imageUrl: imageUrl ? decodeHtmlEntities(imageUrl) : null,
      description: null,
      seller: null,
      originalPriceText: normalizePriceText(normalizeWhitespace(originalPrice)),
      offerKey: null,
      startsAt: null,
      endsAt: null
    });
  }

  return offers;
}

function readEpicPromotions(source: unknown): Array<{ startDate: string; endDate: string }> {
  if (!source || typeof source !== "object") {
    return [];
  }

  const outerPromotions = (source as { promotionalOffers?: unknown[] }).promotionalOffers;
  if (!Array.isArray(outerPromotions)) {
    return [];
  }

  const promotions: Array<{ startDate: string; endDate: string }> = [];
  for (const outer of outerPromotions) {
    const inner = outer && typeof outer === "object" ? (outer as { promotionalOffers?: unknown[] }).promotionalOffers : null;
    if (!Array.isArray(inner)) {
      continue;
    }

    for (const item of inner) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { startDate?: unknown }).startDate === "string" &&
        typeof (item as { endDate?: unknown }).endDate === "string"
      ) {
        promotions.push({
          startDate: (item as { startDate: string }).startDate,
          endDate: (item as { endDate: string }).endDate
        });
      }
    }
  }

  return promotions;
}

function pickEpicImage(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }

  const preferredTypes = ["OfferImageWide", "DieselStoreFrontWide", "featuredMedia", "Thumbnail", "OfferImageTall"];
  for (const type of preferredTypes) {
    const match = images.find(
      (image) =>
        image &&
        typeof image === "object" &&
        (image as { type?: unknown }).type === type &&
        typeof (image as { url?: unknown }).url === "string"
    ) as { url: string } | undefined;

    if (match) {
      return match.url;
    }
  }

  return null;
}

function stripEpicSlug(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\/home$/i, "").replace(/^\/+|\/+$/g, "");
}

function buildEpicStoreUrl(element: Record<string, unknown>, locale: string): string {
  const directSlug = stripEpicSlug(typeof element.productSlug === "string" ? element.productSlug : null);
  if (directSlug) {
    return `https://store.epicgames.com/${locale}/p/${directSlug}`;
  }

  const directMappings = Array.isArray(element.offerMappings)
    ? element.offerMappings
    : Array.isArray((element.catalogNs as { mappings?: unknown[] } | undefined)?.mappings)
      ? (element.catalogNs as { mappings?: unknown[] }).mappings ?? []
      : [];

  const mappedSlug = directMappings
    .map((mapping) =>
      mapping && typeof mapping === "object" && typeof (mapping as { pageSlug?: unknown }).pageSlug === "string"
        ? stripEpicSlug((mapping as { pageSlug: string }).pageSlug)
        : null
    )
    .find((value): value is string => Boolean(value));

  if (mappedSlug) {
    return `https://store.epicgames.com/${locale}/p/${mappedSlug}`;
  }

  const urlSlug = stripEpicSlug(typeof element.urlSlug === "string" ? element.urlSlug : null);
  if (urlSlug) {
    return `https://store.epicgames.com/${locale}/p/${urlSlug}`;
  }

  return `https://store.epicgames.com/${locale}/`;
}

export function parseEpicFreeGamesPayload(payload: EpicPromotionPayload, now = Date.now(), locale = "vi"): FreeGameOffer[] {
  const elements = payload.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) {
    return [];
  }

  const offers: FreeGameOffer[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }

    const record = element as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : null;
    const id = typeof record.id === "string" ? record.id : null;
    const totalPrice =
      record.price &&
      typeof record.price === "object" &&
      (record.price as { totalPrice?: unknown }).totalPrice &&
      typeof (record.price as { totalPrice?: unknown }).totalPrice === "object"
        ? ((record.price as { totalPrice: Record<string, unknown> }).totalPrice as Record<string, unknown>)
        : null;

    if (!title || !id || !totalPrice) {
      continue;
    }

    const originalPrice = typeof totalPrice.originalPrice === "number" ? totalPrice.originalPrice : null;
    const discountPrice = typeof totalPrice.discountPrice === "number" ? totalPrice.discountPrice : null;
    if (originalPrice === null || discountPrice !== 0 || originalPrice <= 0) {
      continue;
    }

    const promotions = readEpicPromotions(record.promotions);
    const activePromotion = promotions.find((promotion) => {
      const startsAt = Date.parse(promotion.startDate);
      const endsAt = Date.parse(promotion.endDate);
      return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now < endsAt;
    });

    if (!activePromotion) {
      continue;
    }

    const formattedOriginal =
      totalPrice.fmtPrice &&
      typeof totalPrice.fmtPrice === "object" &&
      typeof (totalPrice.fmtPrice as { originalPrice?: unknown }).originalPrice === "string"
        ? normalizePriceText((totalPrice.fmtPrice as { originalPrice: string }).originalPrice)
        : formatVndPrice(originalPrice);

    offers.push({
      platform: "epic",
      gameId: `offer:${id}`,
      title: normalizeWhitespace(title),
      storeUrl: buildEpicStoreUrl(record, locale),
      imageUrl: pickEpicImage(record.keyImages),
      description: typeof record.description === "string" ? normalizeWhitespace(record.description) : null,
      seller:
        record.seller && typeof record.seller === "object" && typeof (record.seller as { name?: unknown }).name === "string"
          ? (record.seller as { name: string }).name
          : null,
      originalPriceText: formattedOriginal,
      offerKey: `${id}:${activePromotion.startDate}:${activePromotion.endDate}`,
      startsAt: new Date(activePromotion.startDate),
      endsAt: new Date(activePromotion.endDate)
    });
  }

  return offers;
}

export class FreeGameMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  public constructor(
    private readonly gateway: FreeGameGateway,
    private readonly stateRepository: FreeGameStateRepository,
    private readonly config: FreeGameMonitorConfig
  ) {}

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.sweepOnce();
    this.timer = setInterval(() => {
      this.sweepOnce().catch((error) => {
        console.error("Failed to sweep free game promotions.", error);
      });
    }, this.config.pollIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sweepOnce(): Promise<void> {
    if (this.sweepRunning) {
      return;
    }

    this.sweepRunning = true;
    try {
      if (this.config.steamChannelId) {
        await this.syncPlatform("steam", this.config.steamChannelId, () => this.fetchSteamCurrentFreeOffers());
      }

      if (this.config.epicChannelId) {
        await this.syncPlatform("epic", this.config.epicChannelId, () => this.fetchEpicCurrentFreeOffers());
      }
    } finally {
      this.sweepRunning = false;
    }
  }

  private async syncPlatform(
    platform: FreeGamePlatform,
    channelId: string,
    loader: () => Promise<FreeGameOffer[]>
  ): Promise<void> {
    const offers = await loader();
    const currentIds = new Set(offers.map((offer) => offer.gameId));
    const previousStates = await this.stateRepository.getStates(
      platform,
      offers.map((offer) => offer.gameId)
    );

    for (const offer of offers) {
      const previous = previousStates.get(offer.gameId);
      const shouldNotify =
        !previous?.isCurrentlyFree || (offer.offerKey !== null && previous.offerKey !== offer.offerKey);

      if (shouldNotify) {
        await this.gateway.sendFreeGameNotification({ channelId, offer });
      }

      await this.stateRepository.upsertState({
        platform,
        gameId: offer.gameId,
        title: offer.title,
        isCurrentlyFree: true,
        offerKey: offer.offerKey,
        startsAt: offer.startsAt,
        endsAt: offer.endsAt
      });
    }

    const staleStates = await this.stateRepository.listCurrentlyFree(platform);
    for (const [gameId, state] of staleStates) {
      if (currentIds.has(gameId)) {
        continue;
      }

      await this.stateRepository.upsertState({
        platform,
        gameId,
        title: state.title,
        isCurrentlyFree: false,
        offerKey: null,
        startsAt: null,
        endsAt: null
      });
    }
  }

  private async fetchSteamCurrentFreeOffers(): Promise<FreeGameOffer[]> {
    const pageSize = 50;
    let start = 0;
    let totalCount = 0;
    const offers = new Map<string, FreeGameOffer>();

    do {
      const url = new URL("https://store.steampowered.com/search/results/");
      url.searchParams.set("query", "");
      url.searchParams.set("start", String(start));
      url.searchParams.set("count", String(pageSize));
      url.searchParams.set("dynamic_data", "");
      url.searchParams.set("sort_by", "_ASC");
      url.searchParams.set("supportedlang", "vietnamese");
      url.searchParams.set("specials", "1");
      url.searchParams.set("maxprice", "free");
      url.searchParams.set("hidef2p", "1");
      url.searchParams.set("ndl", "1");
      url.searchParams.set("infinite", "1");
      url.searchParams.set("cc", this.config.countryCode.toLowerCase());

      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0",
          "x-requested-with": "XMLHttpRequest"
        }
      });

      if (!response.ok) {
        throw new Error(`Steam free games search failed: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as { total_count?: number; results_html?: string };
      totalCount = Number(payload.total_count ?? 0);
      const pageOffers = parseSteamFreeGamesSearchHtml(String(payload.results_html ?? ""));
      for (const offer of pageOffers) {
        offers.set(offer.gameId, await this.enrichSteamOffer(offer));
      }

      start += pageSize;
      if (pageOffers.length === 0) {
        break;
      }
    } while (start < totalCount);

    return [...offers.values()];
  }

  private async enrichSteamOffer(offer: FreeGameOffer): Promise<FreeGameOffer> {
    const match = /^app:(\d+)$/.exec(offer.gameId);
    if (!match) {
      return offer;
    }

    const appId = Number(match[1]);
    const details = await this.fetchSteamStoreDetails(appId).catch((error) => {
      console.warn(`Failed to fetch Steam store details for free game app ${appId}.`, error);
      return null;
    });

    if (!details) {
      return offer;
    }

    return {
      ...offer,
      description: details.shortDescription ?? offer.description,
      imageUrl: details.headerImageUrl ?? details.capsuleImageUrl ?? offer.imageUrl,
      seller: details.publishers[0] ?? details.developers[0] ?? offer.seller
    };
  }

  private async fetchSteamStoreDetails(appId: number): Promise<ReturnType<typeof parseSteamStoreDetailsPayload>> {
    const url = new URL("https://store.steampowered.com/api/appdetails");
    url.searchParams.set("appids", String(appId));
    url.searchParams.set("cc", this.config.countryCode.toLowerCase());
    url.searchParams.set("l", "vietnamese");

    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Steam appdetails failed: ${response.status} ${response.statusText}`);
    }

    return parseSteamStoreDetailsPayload(await response.json(), appId);
  }

  private async fetchEpicCurrentFreeOffers(): Promise<FreeGameOffer[]> {
    const url = new URL("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions");
    url.searchParams.set("locale", this.config.locale);
    url.searchParams.set("country", this.config.countryCode);
    url.searchParams.set("allowCountries", this.config.countryCode);

    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Epic free games endpoint failed: ${response.status} ${response.statusText}`);
    }

    return parseEpicFreeGamesPayload((await response.json()) as EpicPromotionPayload, Date.now(), this.config.locale);
  }
}
