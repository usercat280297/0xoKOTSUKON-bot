import { beforeEach, describe, expect, it } from "vitest";
import type { TicketPanelWithOptions } from "../src/domain/types";
import { PanelService } from "../src/services/panelService";
import { FakeDiscordGateway, FakePanelRepository } from "./fakes/fakeRepositories";

function makeGamePanel(): TicketPanelWithOptions {
  return {
    id: "panel-1",
    guildId: "guild-1",
    name: "Steam Activation",
    channelId: "panel-channel",
    messageId: "message-1",
    placeholder: "Choose a game",
    template: "game-activation",
    active: true,
    options: [
      {
        id: "option-1",
        panelId: "panel-1",
        value: "mafia-the-old-country",
        label: "Mafia The Old Country",
        emoji: "M",
        boardSection: "Steam (M-S)",
        stockRemaining: 173,
        stockTotal: 200,
        sortOrder: 1,
        requiredRoleId: "gamers-role",
        redirectChannelId: "role-channel",
        targetCategoryId: "steam-category",
        staffRoleId: "steam-staff",
        active: true
      }
    ]
  };
}

describe("PanelService game boards", () => {
  let panels: FakePanelRepository;
  let gateway: FakeDiscordGateway;
  let service: PanelService;

  beforeEach(() => {
    panels = new FakePanelRepository();
    gateway = new FakeDiscordGateway();
    panels.seedPanel(makeGamePanel());
    service = new PanelService(panels, gateway);
  });

  it("adds a game with a generated unique value and refreshes the published board", async () => {
    const result = await service.addGame({
      panelId: "panel-1",
      label: "Mafia The Old Country",
      section: "Steam (M-S)",
      stockRemaining: 24,
      stockTotal: 25,
      emoji: "M",
      requiredRoleId: "gamers-role",
      redirectChannelId: "role-channel",
      targetCategoryId: "steam-category",
      staffRoleId: "steam-staff"
    });

    expect(result.option.value).toBe("mafia-the-old-country-2");
    expect(result.option.boardSection).toBe("Steam (M-S)");
    expect(result.option.stockRemaining).toBe(24);
    expect(result.option.stockTotal).toBe(25);
    expect(result.refreshed).toBe(true);
    expect(gateway.publishedPanels).toHaveLength(1);
    expect(gateway.publishedPanels[0]).toMatchObject({
      panelId: "panel-1",
      optionCount: 2,
      messageId: "message-1"
    });
  });

  it("updates stock by game value and refreshes the published board", async () => {
    const result = await service.updateGameStock({
      panelId: "panel-1",
      gameReference: "mafia-the-old-country",
      stockRemaining: 150,
      stockTotal: 200
    });

    expect(result.option.stockRemaining).toBe(150);
    expect(result.option.stockTotal).toBe(200);
    expect(result.refreshed).toBe(true);
    expect(gateway.publishedPanels).toHaveLength(1);
  });
});
