import { describe, expect, it } from "vitest";
import {
  buildSteamDbPatchExcerpt,
  normalizeSteamUpdateTitle,
  parseCuratorGamesHtml,
  parseSteamDbPatchnotesRss,
  parseSteamStoreDetailsPayload,
  selectTrackedGames
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

  it("normalizes steam update titles with html entities", () => {
    expect(normalizeSteamUpdateTitle("EA SPORTS FC&#8482; 26")).toBe("EA SPORTS FC™ 26");
  });

  it("builds a readable patch excerpt from SteamDB descriptions", () => {
    expect(buildSteamDbPatchExcerpt("Notice of Update Distribution (SteamDB Build 22472737)")).toBe(
      "Notice of Update Distribution (SteamDB Build 22472737)"
    );
  });

  it("parses SteamDB patchnotes RSS items with build ids and thumbnails", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" version="2.0">
        <channel>
          <title>SteamDB Builds for Resident Evil Requiem</title>
          <item>
            <guid isPermaLink="false">build#22472737</guid>
            <title>Resident Evil Requiem update for 27 March 2026</title>
            <link>https://steamdb.info/patchnotes/22472737/?utm_source=rss&amp;utm_medium=rss&amp;utm_campaign=Patchnotes</link>
            <description>Notice of Update Distribution (SteamDB Build 22472737)</description>
            <pubDate>Fri, 27 Mar 2026 01:00:31 +0000</pubDate>
            <media:thumbnail width="1200" height="630" url="https://steamdb.info/patchnotes/22472737.png?_=1774577351"/>
          </item>
          <item>
            <guid isPermaLink="false">build#22277314</guid>
            <title>Resident Evil Requiem update for 13 March 2026</title>
            <link>https://steamdb.info/patchnotes/22277314/?utm_source=rss&amp;utm_medium=rss&amp;utm_campaign=Patchnotes</link>
            <description>SteamDB Build 22277314</description>
            <pubDate>Fri, 13 Mar 2026 05:16:13 +0000</pubDate>
            <media:thumbnail width="1200" height="630" url="https://steamdb.info/patchnotes/22277314.png?_=1773378973"/>
          </item>
        </channel>
      </rss>`;

    expect(parseSteamDbPatchnotesRss(xml)).toEqual([
      {
        guid: "build#22472737",
        buildId: "22472737",
        title: "Resident Evil Requiem update for 27 March 2026",
        url: "https://steamdb.info/patchnotes/22472737/?utm_source=rss&utm_medium=rss&utm_campaign=Patchnotes",
        description: "Notice of Update Distribution (SteamDB Build 22472737)",
        date: 1774573231,
        thumbnailUrl: "https://steamdb.info/patchnotes/22472737.png?_=1774577351"
      },
      {
        guid: "build#22277314",
        buildId: "22277314",
        title: "Resident Evil Requiem update for 13 March 2026",
        url: "https://steamdb.info/patchnotes/22277314/?utm_source=rss&utm_medium=rss&utm_campaign=Patchnotes",
        description: "SteamDB Build 22277314",
        date: 1773378973,
        thumbnailUrl: "https://steamdb.info/patchnotes/22277314.png?_=1773378973"
      }
    ]);
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
});
