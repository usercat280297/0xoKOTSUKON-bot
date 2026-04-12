import { describe, expect, it } from "vitest";
import {
  buildSteamNewsExcerpt,
  isLikelyGameUpdate,
  normalizeSteamUpdateTitle,
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
      url: "https://steam.example.com/news/abc",
      contents: "[h1]Patch Notes[/h1] Fixed crashing on startup and improved stability across all regions.",
      date: 1775942400,
      feedLabel: "Community Announcements"
    };

    expect(isLikelyGameUpdate(news)).toBe(true);
    expect(pickLatestRelevantNews([news])).toEqual(news);
    expect(buildSteamNewsExcerpt(news.contents)).toContain("Fixed crashing on startup");
  });

  it("normalizes steam update titles with html entities", () => {
    expect(normalizeSteamUpdateTitle("EA SPORTS FC&amp;#8482; 26")).toBe("EA SPORTS FC™ 26");
  });
});
