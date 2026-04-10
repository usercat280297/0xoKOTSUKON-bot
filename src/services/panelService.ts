import type { PanelRepository } from "../repositories/interfaces";
import type { CreatePanelInput, AddPanelOptionInput, TicketPanelWithOptions } from "../domain/types";
import type { DiscordTicketGateway } from "./discordGateway";
import { formatPanelSummary } from "../utils/formatters";

export class PanelService {
  public constructor(
    private readonly panels: PanelRepository,
    private readonly gateway: Pick<DiscordTicketGateway, "sendPanelMessage">
  ) {}

  public createPanel(input: CreatePanelInput) {
    return this.panels.create(input);
  }

  public addOption(input: AddPanelOptionInput) {
    return this.panels.addOption(input);
  }

  public async publishPanel(panelId: string): Promise<TicketPanelWithOptions> {
    const panel = await this.panels.getById(panelId);
    if (!panel || !panel.active) {
      throw new Error("Panel not found or disabled.");
    }

    if (panel.options.filter((option) => option.active).length === 0) {
      throw new Error("Panel has no active options.");
    }

    const messageId = await this.gateway.sendPanelMessage(panel);
    await this.panels.savePublishedMessage(panelId, messageId);

    return {
      ...panel,
      messageId
    };
  }

  public listPanels(guildId: string): Promise<TicketPanelWithOptions[]> {
    return this.panels.listByGuildId(guildId);
  }

  public async renderPanelList(guildId: string): Promise<string> {
    const panels = await this.listPanels(guildId);
    if (panels.length === 0) {
      return "No panels configured yet.";
    }

    return panels.map((panel) => formatPanelSummary(panel.name, panel.active, panel.options.length, panel.channelId, panel.id)).join("\n\n");
  }

  public disablePanel(panelId: string): Promise<boolean> {
    return this.panels.disable(panelId);
  }
}
