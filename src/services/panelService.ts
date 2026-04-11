import type { PanelRepository } from "../repositories/interfaces";
import type { CreatePanelInput, AddPanelOptionInput, TicketOption, TicketPanelWithOptions } from "../domain/types";
import type { DiscordTicketGateway } from "./discordGateway";
import { formatPanelSummary, slugifyTicketName } from "../utils/formatters";

export interface AddPanelGameInput {
  panelId: string;
  label: string;
  section: string;
  stockRemaining: number;
  stockTotal: number;
  emoji: string | null;
  requiredRoleId: string;
  redirectChannelId: string;
  targetCategoryId: string;
  staffRoleId: string;
  sortOrder?: number | null;
}

export interface UpdatePanelGameStockInput {
  panelId: string;
  gameReference: string;
  stockRemaining: number;
  stockTotal?: number | null;
}

export interface PanelOptionMutationResult {
  option: TicketOption;
  refreshed: boolean;
}

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

  public async addGame(input: AddPanelGameInput): Promise<PanelOptionMutationResult> {
    this.validateStock(input.stockRemaining, input.stockTotal);

    const panel = await this.panels.getById(input.panelId);
    if (!panel || !panel.active) {
      throw new Error("Panel not found or disabled.");
    }

    if (panel.template !== "game-activation") {
      throw new Error("Only game-activation panels support DB-backed game boards.");
    }

    const option = await this.panels.addOption({
      panelId: input.panelId,
      value: this.buildUniqueValue(panel, input.label),
      label: input.label,
      emoji: input.emoji,
      boardSection: input.section,
      stockRemaining: input.stockRemaining,
      stockTotal: input.stockTotal,
      sortOrder: input.sortOrder ?? this.getNextSortOrder(panel),
      requiredRoleId: input.requiredRoleId,
      redirectChannelId: input.redirectChannelId,
      targetCategoryId: input.targetCategoryId,
      staffRoleId: input.staffRoleId
    });

    return {
      option,
      refreshed: await this.refreshPublishedPanel(input.panelId)
    };
  }

  public async updateGameStock(input: UpdatePanelGameStockInput): Promise<PanelOptionMutationResult> {
    const panel = await this.panels.getById(input.panelId);
    if (!panel || !panel.active) {
      throw new Error("Panel not found or disabled.");
    }

    const option = this.findOption(panel, input.gameReference);
    if (!option) {
      throw new Error("Game not found in this panel. Use the game value, option id, or exact label.");
    }

    const nextTotal = input.stockTotal === undefined ? option.stockTotal : input.stockTotal;
    this.validateStock(input.stockRemaining, nextTotal);

    const updated = await this.panels.updateOptionStock({
      optionId: option.id,
      stockRemaining: input.stockRemaining,
      stockTotal: nextTotal ?? null
    });

    if (!updated) {
      throw new Error("Failed to update stock for this game.");
    }

    return {
      option: updated,
      refreshed: await this.refreshPublishedPanel(input.panelId)
    };
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

  private validateStock(stockRemaining: number, stockTotal: number | null | undefined): void {
    if (stockRemaining < 0) {
      throw new Error("Stock remaining must be zero or greater.");
    }

    if (stockTotal !== null && stockTotal !== undefined) {
      if (stockTotal < 0) {
        throw new Error("Stock total must be zero or greater.");
      }

      if (stockRemaining > stockTotal) {
        throw new Error("Stock remaining cannot be greater than stock total.");
      }
    }
  }

  private buildUniqueValue(panel: TicketPanelWithOptions, label: string): string {
    const raw = slugifyTicketName(label) || "game";
    let value = raw;
    let suffix = 2;

    while (panel.options.some((option) => option.value === value)) {
      const suffixText = `-${suffix}`;
      value = `${raw.slice(0, Math.max(1, 40 - suffixText.length))}${suffixText}`;
      suffix += 1;
    }

    return value;
  }

  private getNextSortOrder(panel: TicketPanelWithOptions): number {
    return panel.options.reduce((max, option) => Math.max(max, option.sortOrder), 0) + 1;
  }

  private findOption(panel: TicketPanelWithOptions, reference: string): TicketOption | null {
    const normalized = reference.trim().toLowerCase();
    return (
      panel.options.find((option) => option.id === reference) ??
      panel.options.find((option) => option.value.toLowerCase() === normalized) ??
      panel.options.find((option) => option.label.trim().toLowerCase() === normalized) ??
      null
    );
  }

  private async refreshPublishedPanel(panelId: string): Promise<boolean> {
    const panel = await this.panels.getById(panelId);
    if (!panel || !panel.active || !panel.messageId) {
      return false;
    }

    const messageId = await this.gateway.sendPanelMessage(panel);
    if (messageId !== panel.messageId) {
      await this.panels.savePublishedMessage(panelId, messageId);
    }
    return true;
  }
}
