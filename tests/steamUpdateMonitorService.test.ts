import { describe, expect, it } from "vitest";
import {
  buildSteamNewsExcerpt,
  isOfficialSteamNewsUrl,
  isLikelyGameUpdate,
  normalizeSteamUpdateTitle,
  parseSteamPublicVersionPayload,
  parseSteamStoreDetailsPayload,
  parseCuratorGamesHtml,
  pickLatestRelevantNews,
  selectTrackedGames,
  type SteamNewsItem
} from "../src/services/steamUpdateMonitorService";

describe("steamUpdateMonitorService helpers", () => {
  it("parses app ids, titles, store links and images from curator html", () => {
    const html = `
      <a data-ds-appid="3321460" href="https://store.steampowered.com/app/3321460/Crimson_Desert/">
        <div class="capsule capsule_image_ctn smallcapsule">
          <img src="https://cdn.example.com/crimson.jpg" alt="Crimson Desert">
        </div>
      </a>
      <a data-ds-appid="1446780" href="https://store.steampowered.com/app/1446780/Monster_Hunter_Wilds/">
        <div class="capsule capsule_image_ctn smallcapsule">
          <img src="https://cdn.example.com/wilds.jpg" alt="Monster Hunter Wilds">
        </div>
      </a>
    `;

    expect(parseCuratorGamesHtml(html)).toEqual([
      {
        appId: 3321460,
        title: "Crimson Desert",
        storeUrl: "https://store.steampowered.com/app/3321460/Crimson_Desert/",
        imageUrl: "https://cdn.example.com/crimson.jpg",
        steamDbPatchnotesUrl: "https://steamdb.info/app/3321460/patchnotes/"
      },
      {
        appId: 1446780,
        title: "Monster Hunter Wilds",
        storeUrl: "https://store.steampowered.com/app/1446780/Monster_Hunter_Wilds/",
        imageUrl: "https://cdn.example.com/wilds.jpg",
        steamDbPatchnotesUrl: "https://steamdb.info/app/1446780/patchnotes/"
      }
    ]);
  });

  it("keeps only requested denuvo titles when an allowlist is provided", () => {
    const games = [
      {
        appId: 1,
        title: "Resident Evil Requiem",
        storeUrl: "https://store.steampowered.com/app/1/",
        imageUrl: null,
        steamDbPatchnotesUrl: "https://steamdb.info/app/1/patchnotes/"
      },
      {
        appId: 2,
        title: "EA SPORTS FC™ 26",
        storeUrl: "https://store.steampowered.com/app/2/",
        imageUrl: null,
        steamDbPatchnotesUrl: "https://steamdb.info/app/2/patchnotes/"
      }
    ];

    expect(selectTrackedGames(games, ["ea sports fc™ 26"])).toEqual([games[1]]);
  });

  it("detects patch-like news and builds a short excerpt", () => {
    const news: SteamNewsItem = {
      gid: "abc",
      title: "Hotfix 1.0.2 is live",
      url: "https://steamcommunity.com/games/123/announcements/detail/456",
      contents: "[h1]Patch Notes[/h1] Fixed crashing on startup and improved stability across all regions.",
      date: 1775942400,
      feedLabel: "Community Announcements"
    };

    expect(isLikelyGameUpdate(news)).toBe(true);
    expect(pickLatestRelevantNews([news])).toEqual(news);
    expect(buildSteamNewsExcerpt(news.contents)).toContain("Fixed crashing on startup");
  });

  it("uses only official steam news urls for patch notifications", () => {
    const externalNews: SteamNewsItem = {
      gid: "external",
      title: "Patch 1.0 is live",
      url: "https://gamemag.ru/news/example",
      contents: "Patch notes mirrored on external press site.",
      date: 1775942400,
      feedLabel: "GameMag"
    };
    const steamNews: SteamNewsItem = {
      gid: "steam",
      title: "Patch 1.0 is live",
      url: "https://steamcommunity.com/games/3764200/announcements/detail/1234567890",
      contents: "Official patch notes on Steam.",
      date: 1775942500,
      feedLabel: "Community Announcements"
    };

    expect(isOfficialSteamNewsUrl(externalNews.url)).toBe(false);
    expect(isOfficialSteamNewsUrl(steamNews.url)).toBe(true);
    expect(pickLatestRelevantNews([externalNews, steamNews])).toEqual(steamNews);
  });

  it("normalizes steam update titles with html entities", () => {
    expect(normalizeSteamUpdateTitle("EA SPORTS FC&amp;#8482; 26")).toBe("EA SPORTS FC™ 26");
  });

  it("parses steam store app details for richer notifications", () => {
    const payload = {
      "3321460": {
        success: true,
        data: {
          short_description: "Open-world action adventure in Pywel.",
          header_image: "https://cdn.example.com/header.jpg",
          capsule_image: "https://cdn.example.com/capsule.jpg",
          developers: ["Pearl Abyss"],
          publishers: ["Pearl Abyss"],
          genres: [{ id: "1", description: "Action" }, { id: "25", description: "Adventure" }]
        }
      }
    };

    expect(parseSteamStoreDetailsPayload(payload, 3321460)).toEqual({
      shortDescription: "Open-world action adventure in Pywel.",
      headerImageUrl: "https://cdn.example.com/header.jpg",
      capsuleImageUrl: "https://cdn.example.com/capsule.jpg",
      developers: ["Pearl Abyss"],
      publishers: ["Pearl Abyss"],
      genres: ["Action", "Adventure"]
    });
  });

  it("parses steam public version payload", () => {
    const payload = {
      response: {
        success: true,
        up_to_date: false,
        version_is_listable: true,
        required_version: 22748572
      }
    };

    expect(parseSteamPublicVersionPayload(payload)).toEqual({
      buildId: "22748572",
      versionIsListable: true
    });
  });
});
