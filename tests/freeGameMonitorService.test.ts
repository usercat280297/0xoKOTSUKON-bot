import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FreeGameMonitorService,
  parseEpicFreeGamesPayload,
  parseSteamFreeGamesSearchHtml
} from "../src/services/freeGameMonitorService";
import type { FreeGamePlatform, FreeGameStateRecord, FreeGameStateRepository } from "../src/repositories/interfaces";

class InMemoryFreeGameStateRepository implements FreeGameStateRepository {
  private readonly store = new Map<string, FreeGameStateRecord>();

  public async getStates(platform: FreeGamePlatform, gameIds: string[]): Promise<Map<string, FreeGameStateRecord>> {
    const result = new Map<string, FreeGameStateRecord>();
    for (const gameId of gameIds) {
      const state = this.store.get(`${platform}:${gameId}`);
      if (state) {
        result.set(gameId, state);
      }
    }

    return result;
  }

  public async listCurrentlyFree(platform: FreeGamePlatform): Promise<Map<string, FreeGameStateRecord>> {
    const result = new Map<string, FreeGameStateRecord>();
    for (const [key, value] of this.store) {
      if (key.startsWith(`${platform}:`) && value.isCurrentlyFree) {
        result.set(value.gameId, value);
      }
    }

    return result;
  }

  public async upsertState(input: {
    platform: FreeGamePlatform;
    gameId: string;
    title: string;
    isCurrentlyFree: boolean;
    offerKey: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }): Promise<void> {
    this.store.set(`${input.platform}:${input.gameId}`, {
      gameId: input.gameId,
      title: input.title,
      isCurrentlyFree: input.isCurrentlyFree,
      offerKey: input.offerKey
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("freeGameMonitorService helpers", () => {
  it("parses 100% off Steam search rows into free offers", () => {
    const html = `
      <a href="https://store.steampowered.com/app/123456/Test_Game/?snr=1_7_7_230_7">
        <div class="search_capsule"><img src="https://cdn.example.com/test.jpg"></div>
        <span class="title">Test Game</span>
        <div class="search_price_discount_combined responsive_secondrow" data-price-final="0">
          <div class="discount_block search_discount_block" data-discount="100">
            <div class="discount_prices">
              <div class="discount_original_price">94.000 ₫</div>
              <div class="discount_final_price">0đ</div>
            </div>
          </div>
        </div>
      </a>
      <a href="https://store.steampowered.com/app/999999/Not_Free/">
        <span class="title">Not Free</span>
        <div class="search_price_discount_combined responsive_secondrow" data-price-final="5000">
          <div class="discount_block search_discount_block" data-discount="90">
            <div class="discount_prices">
              <div class="discount_original_price">50.000 ₫</div>
              <div class="discount_final_price">5.000đ</div>
            </div>
          </div>
        </div>
      </a>
    `;

    expect(parseSteamFreeGamesSearchHtml(html)).toEqual([
      {
        platform: "steam",
        gameId: "app:123456",
        title: "Test Game",
        storeUrl: "https://store.steampowered.com/app/123456/Test_Game/",
        imageUrl: "https://cdn.example.com/test.jpg",
        description: null,
        seller: null,
        originalPriceText: "94.000đ",
        offerKey: null,
        startsAt: null,
        endsAt: null
      }
    ]);
  });

  it("parses active Epic free promotions and ignores upcoming offers", () => {
    const payload = {
      data: {
        Catalog: {
          searchStore: {
            elements: [
              {
                title: "Current Epic Freebie",
                id: "offer-1",
                description: "Free this week.",
                productSlug: "current-epic-freebie/home",
                keyImages: [{ type: "OfferImageWide", url: "https://cdn.example.com/current.jpg" }],
                seller: { name: "Epic Seller" },
                price: {
                  totalPrice: {
                    originalPrice: 120000,
                    discountPrice: 0,
                    fmtPrice: {
                      originalPrice: "120.000 ₫"
                    }
                  }
                },
                promotions: {
                  promotionalOffers: [
                    {
                      promotionalOffers: [
                        {
                          startDate: "2026-04-10T15:00:00.000Z",
                          endDate: "2026-04-17T15:00:00.000Z"
                        }
                      ]
                    }
                  ],
                  upcomingPromotionalOffers: []
                }
              },
              {
                title: "Upcoming Epic Freebie",
                id: "offer-2",
                description: "Free next week.",
                productSlug: "upcoming-epic-freebie/home",
                keyImages: [{ type: "OfferImageWide", url: "https://cdn.example.com/upcoming.jpg" }],
                seller: { name: "Epic Seller" },
                price: {
                  totalPrice: {
                    originalPrice: 90000,
                    discountPrice: 0,
                    fmtPrice: {
                      originalPrice: "90.000 ₫"
                    }
                  }
                },
                promotions: {
                  promotionalOffers: [],
                  upcomingPromotionalOffers: [
                    {
                      promotionalOffers: [
                        {
                          startDate: "2026-04-17T15:00:00.000Z",
                          endDate: "2026-04-24T15:00:00.000Z"
                        }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    };

    expect(parseEpicFreeGamesPayload(payload, Date.parse("2026-04-14T12:00:00.000Z"), "vi")).toEqual([
      {
        platform: "epic",
        gameId: "offer:offer-1",
        title: "Current Epic Freebie",
        storeUrl: "https://store.epicgames.com/vi/p/current-epic-freebie",
        imageUrl: "https://cdn.example.com/current.jpg",
        description: "Free this week.",
        seller: "Epic Seller",
        originalPriceText: "120.000đ",
        offerKey: "offer-1:2026-04-10T15:00:00.000Z:2026-04-17T15:00:00.000Z",
        startsAt: new Date("2026-04-10T15:00:00.000Z"),
        endsAt: new Date("2026-04-17T15:00:00.000Z")
      }
    ]);
  });

  it("notifies only when a title transitions into a free state", async () => {
    const repository = new InMemoryFreeGameStateRepository();
    const gateway = {
      sendFreeGameNotification: vi.fn().mockResolvedValue(undefined)
    };

    const currentPayload = {
      data: {
        Catalog: {
          searchStore: {
            elements: [
              {
                title: "Current Epic Freebie",
                id: "offer-1",
                description: "Free this week.",
                productSlug: "current-epic-freebie/home",
                keyImages: [{ type: "OfferImageWide", url: "https://cdn.example.com/current.jpg" }],
                seller: { name: "Epic Seller" },
                price: {
                  totalPrice: {
                    originalPrice: 120000,
                    discountPrice: 0,
                    fmtPrice: {
                      originalPrice: "120.000 ₫"
                    }
                  }
                },
                promotions: {
                  promotionalOffers: [
                    {
                      promotionalOffers: [
                        {
                          startDate: "2026-04-10T15:00:00.000Z",
                          endDate: "2026-04-17T15:00:00.000Z"
                        }
                      ]
                    }
                  ],
                  upcomingPromotionalOffers: []
                }
              }
            ]
          }
        }
      }
    };

    const emptyPayload = {
      data: {
        Catalog: {
          searchStore: {
            elements: []
          }
        }
      }
    };

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => currentPayload
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => currentPayload
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => emptyPayload
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => currentPayload
        })
    );

    const service = new FreeGameMonitorService(gateway, repository, {
      enabled: true,
      steamChannelId: null,
      epicChannelId: "epic-channel",
      pollIntervalMs: 60_000,
      countryCode: "VN",
      locale: "vi"
    });

    await (service as { sweepOnce(): Promise<void> }).sweepOnce();
    await (service as { sweepOnce(): Promise<void> }).sweepOnce();
    await (service as { sweepOnce(): Promise<void> }).sweepOnce();
    await (service as { sweepOnce(): Promise<void> }).sweepOnce();

    expect(gateway.sendFreeGameNotification).toHaveBeenCalledTimes(2);
  });
});
