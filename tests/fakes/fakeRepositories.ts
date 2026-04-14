import { randomUUID } from "node:crypto";
import type {
  AddPanelOptionInput,
  CreatePanelInput,
  CreateTicketInput,
  GuildConfig,
  Ticket,
  TicketEvent,
  TicketOption,
  TicketPanel,
  TicketPanelWithOptions,
  TranscriptMessage,
  UpdatePanelOptionStockInput
} from "../../src/domain/types";
import type {
  DiscordTicketGateway,
  CreateTicketChannelParams,
  CreateTicketChannelResult,
  SendDonationPromptParams,
  SendDonationThanksParams,
  SendFreeGameNotificationParams,
  SendSteamUpdateNotificationParams,
  SendActivationTokenPanelParams,
  SendLogParams,
  SendTicketIntroParams
} from "../../src/services/discordGateway";
import type { SteamActivationScreenshotAnalyzer, SteamActivationScreenshotValidationResult } from "../../src/services/steamActivationScreenshotService";
import type { GuildConfigRepository, PanelRepository, TicketRepository } from "../../src/repositories/interfaces";

export class FakeGuildConfigRepository implements GuildConfigRepository {
  public current: GuildConfig | null = null;

  public async getByGuildId(guildId: string): Promise<GuildConfig | null> {
    return this.current?.guildId === guildId ? this.current : null;
  }

  public async upsert(
    guildId: string,
    patch: {
      logChannelId?: string | null;
      closedCategoryId?: string | null;
      donatorRoleId?: string | null;
      donationThanksChannelId?: string | null;
      donationLinkUrl?: string | null;
      donationQrImageUrl?: string | null;
      donationAllowedRoleIds?: string[] | null;
    }
  ): Promise<GuildConfig> {
    this.current = {
      guildId,
      logChannelId: patch.logChannelId ?? this.current?.logChannelId ?? null,
      closedCategoryId: patch.closedCategoryId ?? this.current?.closedCategoryId ?? null,
      donatorRoleId: patch.donatorRoleId ?? this.current?.donatorRoleId ?? null,
      donationThanksChannelId: patch.donationThanksChannelId ?? this.current?.donationThanksChannelId ?? null,
      donationLinkUrl: patch.donationLinkUrl ?? this.current?.donationLinkUrl ?? null,
      donationQrImageUrl: patch.donationQrImageUrl ?? this.current?.donationQrImageUrl ?? null,
      donationAllowedRoleIds: patch.donationAllowedRoleIds ?? this.current?.donationAllowedRoleIds ?? []
    };
    return this.current;
  }
}

export class FakePanelRepository implements PanelRepository {
  public panels = new Map<string, TicketPanelWithOptions>();
  public options = new Map<string, TicketOption>();

  public seedPanel(panel: TicketPanelWithOptions): void {
    this.panels.set(panel.id, panel);
    for (const option of panel.options) {
      this.options.set(option.id, option);
    }
  }

  public async create(input: CreatePanelInput): Promise<TicketPanel> {
    const panel: TicketPanelWithOptions = {
      id: randomUUID(),
      guildId: input.guildId,
      name: input.name,
      channelId: input.channelId,
      messageId: null,
      messageIds: [],
      placeholder: input.placeholder,
      template: input.template,
      active: true,
      options: []
    };
    this.panels.set(panel.id, panel);
    return panel;
  }

  public async addOption(input: AddPanelOptionInput): Promise<TicketOption> {
    const option: TicketOption = {
      id: randomUUID(),
      panelId: input.panelId,
      value: input.value,
      label: input.label,
      emoji: input.emoji,
      boardSection: input.boardSection ?? null,
      stockRemaining: input.stockRemaining ?? null,
      stockTotal: input.stockTotal ?? null,
      sortOrder: input.sortOrder ?? 0,
      requiredRoleId: input.requiredRoleId,
      redirectChannelId: input.redirectChannelId,
      targetCategoryId: input.targetCategoryId,
      staffRoleId: input.staffRoleId,
      active: true
    };
    const panel = this.panels.get(input.panelId);
    if (!panel) {
      throw new Error("Panel not found.");
    }
    panel.options.push(option);
    this.options.set(option.id, option);
    return option;
  }

  public async updateOptionStock(input: UpdatePanelOptionStockInput): Promise<TicketOption | null> {
    const option = this.options.get(input.optionId);
    if (!option) {
      return null;
    }

    option.stockRemaining = input.stockRemaining;
    option.stockTotal = input.stockTotal;
    return option;
  }

  public async getById(panelId: string): Promise<TicketPanelWithOptions | null> {
    return this.panels.get(panelId) ?? null;
  }

  public async getOptionById(optionId: string): Promise<TicketOption | null> {
    return this.options.get(optionId) ?? null;
  }

  public async listByGuildId(guildId: string): Promise<TicketPanelWithOptions[]> {
    return [...this.panels.values()].filter((panel) => panel.guildId === guildId);
  }

  public async savePublishedMessages(panelId: string, messageIds: string[]): Promise<void> {
    const panel = this.panels.get(panelId);
    if (panel) {
      panel.messageId = messageIds[0] ?? null;
      panel.messageIds = [...messageIds];
    }
  }

  public async disable(panelId: string): Promise<boolean> {
    const panel = this.panels.get(panelId);
    if (!panel) {
      return false;
    }
    panel.active = false;
    return true;
  }
}

export class FakeTicketRepository implements TicketRepository {
  public tickets = new Map<string, Ticket>();
  public events: TicketEvent[] = [];

  public seedTicket(ticket: Ticket): void {
    this.tickets.set(ticket.id, ticket);
  }

  public async create(input: CreateTicketInput): Promise<Ticket> {
    const ticket: Ticket = {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      channelId: input.channelId,
      optionId: input.optionId,
      status: input.status,
      originalCategoryId: input.originalCategoryId,
      claimedBy: input.claimedBy,
      closedBy: input.closedBy,
      closedAt: input.closedAt,
      transcriptMessageId: input.transcriptMessageId
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  public async findOpenByUser(guildId: string, userId: string): Promise<Ticket | null> {
    return [...this.tickets.values()].find((ticket) => ticket.guildId === guildId && ticket.userId === userId && ticket.status === "open") ?? null;
  }

  public async listOpen(): Promise<Ticket[]> {
    return [...this.tickets.values()].filter((ticket) => ticket.status === "open");
  }

  public async findByChannelId(channelId: string): Promise<Ticket | null> {
    return [...this.tickets.values()].find((ticket) => ticket.channelId === channelId) ?? null;
  }

  public async findById(ticketId: string): Promise<Ticket | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  public async markClaimed(ticketId: string, claimedBy: string): Promise<Ticket> {
    const ticket = this.mustGet(ticketId);
    ticket.claimedBy = claimedBy;
    return ticket;
  }

  public async close(ticketId: string, closedBy: string, transcriptMessageId: string | null): Promise<Ticket> {
    const ticket = this.mustGet(ticketId);
    ticket.status = "closed";
    ticket.closedBy = closedBy;
    ticket.closedAt = new Date("2026-04-10T00:00:00.000Z");
    ticket.transcriptMessageId = transcriptMessageId;
    return ticket;
  }

  public async reopen(ticketId: string): Promise<Ticket> {
    const ticket = this.mustGet(ticketId);
    ticket.status = "open";
    ticket.closedBy = null;
    ticket.closedAt = null;
    return ticket;
  }

  public async addEvent(event: TicketEvent): Promise<void> {
    this.events.push({
      ...event,
      createdAt: event.createdAt ?? new Date()
    });
  }

  public async listEvents(ticketId: string): Promise<TicketEvent[]> {
    return this.events.filter((event) => event.ticketId === ticketId);
  }

  private mustGet(ticketId: string): Ticket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found.`);
    }
    return ticket;
  }
}

export class FakeDiscordGateway implements DiscordTicketGateway {
  public publishedPanels: Array<{ panelId: string; optionCount: number; messageIds: string[] }> = [];
  public createdChannels: CreateTicketChannelParams[] = [];
  public introMessages: SendTicketIntroParams[] = [];
  public claimUpdates: Array<{ channelId: string; ticketId: string; claimedBy: string }> = [];
  public issueUpdates: Array<{ channelId: string; ticketId: string; issueValue: string; issueLabel: string }> = [];
  public channelMessages: Array<{ channelId: string; content: string }> = [];
  public donationPrompts: SendDonationPromptParams[] = [];
  public freeGameNotifications: SendFreeGameNotificationParams[] = [];
  public steamUpdateNotifications: SendSteamUpdateNotificationParams[] = [];
  public donationIntentUpdates: Array<{ channelId: string; ticketId: string }> = [];
  public donationApprovalUpdates: Array<{ channelId: string; ticketId: string; approvedBy: string }> = [];
  public donationThanksMessages: SendDonationThanksParams[] = [];
  public grantedRoles: Array<{ guildId: string; userId: string; roleId: string }> = [];
  public verificationPrompts: Array<{ channelId: string; ticketId: string }> = [];
  public verificationActivations: Array<{ channelId: string; ticketId: string; activatedBy: string }> = [];
  public activationTokenPanels: SendActivationTokenPanelParams[] = [];
  public activationTokenConfirmations: Array<{ channelId: string; ticketId: string; activatedBy: string; autoCloseAt: Date }> = [];
  public deletedChannels: string[] = [];
  public movedChannels: Array<{ channelId: string; categoryId: string | null }> = [];
  public requesterPermissions: Array<{ channelId: string; requesterId: string; allowSend: boolean }> = [];
  public addedMembers: Array<{ channelId: string; userId: string }> = [];
  public removedMembers: Array<{ channelId: string; userId: string }> = [];
  public logMessages: SendLogParams[] = [];
  public transcriptMessages: TranscriptMessage[] = [];

  public async sendPanelMessage(panel: TicketPanelWithOptions): Promise<string[]> {
    const messageIds = panel.messageIds.length > 0 ? [...panel.messageIds] : [panel.messageId ?? `panel-message-${panel.id}`];
    this.publishedPanels.push({
      panelId: panel.id,
      optionCount: panel.options.length,
      messageIds
    });
    return messageIds;
  }

  public async createTicketChannel(params: CreateTicketChannelParams): Promise<CreateTicketChannelResult> {
    this.createdChannels.push(params);
    return {
      channelId: `channel-${this.createdChannels.length}`,
      channelName: params.channelName
    };
  }

  public async sendTicketIntro(params: SendTicketIntroParams): Promise<string> {
    this.introMessages.push(params);
    return `intro-${params.ticketId}`;
  }

  public async updateTicketClaimState(channelId: string, ticketId: string, claimedBy: string): Promise<void> {
    this.claimUpdates.push({ channelId, ticketId, claimedBy });
  }

  public async updateTicketIssueState(channelId: string, ticketId: string, issueValue: string, issueLabel: string): Promise<void> {
    this.issueUpdates.push({ channelId, ticketId, issueValue, issueLabel });
  }

  public async sendChannelMessage(channelId: string, content: string): Promise<void> {
    this.channelMessages.push({ channelId, content });
  }

  public async sendDonationPrompt(params: SendDonationPromptParams): Promise<void> {
    this.donationPrompts.push(params);
  }

  public async sendSteamUpdateNotification(params: SendSteamUpdateNotificationParams): Promise<void> {
    this.steamUpdateNotifications.push(params);
  }

  public async sendFreeGameNotification(params: SendFreeGameNotificationParams): Promise<void> {
    this.freeGameNotifications.push(params);
  }

  public async markDonationIntentState(channelId: string, ticketId: string): Promise<void> {
    this.donationIntentUpdates.push({ channelId, ticketId });
  }

  public async markDonationApprovedState(channelId: string, ticketId: string, approvedBy: string): Promise<void> {
    this.donationApprovalUpdates.push({ channelId, ticketId, approvedBy });
  }

  public async sendDonationThanks(params: SendDonationThanksParams): Promise<string> {
    this.donationThanksMessages.push(params);
    return `thanks-${this.donationThanksMessages.length}`;
  }

  public async addGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    this.grantedRoles.push({ guildId, userId, roleId });
  }

  public async sendVerificationReadyPrompt(channelId: string, ticketId: string): Promise<void> {
    this.verificationPrompts.push({ channelId, ticketId });
  }

  public async markVerificationReadyState(channelId: string, ticketId: string, activatedBy: string): Promise<void> {
    this.verificationActivations.push({ channelId, ticketId, activatedBy });
  }

  public async sendActivationTokenPanel(params: SendActivationTokenPanelParams): Promise<void> {
    this.activationTokenPanels.push(params);
  }

  public async markActivationTokenConfirmed(
    channelId: string,
    ticketId: string,
    activatedBy: string,
    autoCloseAt: Date
  ): Promise<void> {
    this.activationTokenConfirmations.push({ channelId, ticketId, activatedBy, autoCloseAt });
  }

  public async deleteChannel(channelId: string): Promise<void> {
    this.deletedChannels.push(channelId);
  }

  public async moveChannel(channelId: string, categoryId: string | null): Promise<void> {
    this.movedChannels.push({ channelId, categoryId });
  }

  public async setRequesterSendPermission(channelId: string, requesterId: string, allowSend: boolean): Promise<void> {
    this.requesterPermissions.push({ channelId, requesterId, allowSend });
  }

  public async addChannelMember(channelId: string, userId: string): Promise<void> {
    this.addedMembers.push({ channelId, userId });
  }

  public async removeChannelMember(channelId: string, userId: string): Promise<void> {
    this.removedMembers.push({ channelId, userId });
  }

  public async fetchTranscriptMessages(_channelId: string): Promise<TranscriptMessage[]> {
    return this.transcriptMessages;
  }

  public async sendLogMessage(params: SendLogParams): Promise<string> {
    this.logMessages.push(params);
    return `log-${this.logMessages.length}`;
  }

  public channelMention(channelId: string): string {
    return `<#${channelId}>`;
  }
}

export class FakeSteamActivationScreenshotAnalyzer implements SteamActivationScreenshotAnalyzer {
  public nextResult: SteamActivationScreenshotValidationResult = {
    passed: true,
    score: 92,
    matchedSignals: ["thấy chữ của Windows Update Blocker", "thấy cửa sổ properties của thư mục game"],
    missingSignals: [],
    ocrExcerpt: "windows updates option disable updates file folder location steamapps common"
  };

  public seenUrls: string[] = [];

  public async validateAttachmentUrl(url: string): Promise<SteamActivationScreenshotValidationResult> {
    this.seenUrls.push(url);
    return this.nextResult;
  }
}
