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
  TranscriptMessage
} from "../../src/domain/types";
import type { DiscordTicketGateway, CreateTicketChannelParams, CreateTicketChannelResult, SendLogParams, SendTicketIntroParams } from "../../src/services/discordGateway";
import type { GuildConfigRepository, PanelRepository, TicketRepository } from "../../src/repositories/interfaces";

export class FakeGuildConfigRepository implements GuildConfigRepository {
  public current: GuildConfig | null = null;

  public async getByGuildId(guildId: string): Promise<GuildConfig | null> {
    return this.current?.guildId === guildId ? this.current : null;
  }

  public async upsert(
    guildId: string,
    patch: { logChannelId?: string | null; closedCategoryId?: string | null }
  ): Promise<GuildConfig> {
    this.current = {
      guildId,
      logChannelId: patch.logChannelId ?? this.current?.logChannelId ?? null,
      closedCategoryId: patch.closedCategoryId ?? this.current?.closedCategoryId ?? null
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

  public async getById(panelId: string): Promise<TicketPanelWithOptions | null> {
    return this.panels.get(panelId) ?? null;
  }

  public async getOptionById(optionId: string): Promise<TicketOption | null> {
    return this.options.get(optionId) ?? null;
  }

  public async listByGuildId(guildId: string): Promise<TicketPanelWithOptions[]> {
    return [...this.panels.values()].filter((panel) => panel.guildId === guildId);
  }

  public async savePublishedMessage(panelId: string, messageId: string): Promise<void> {
    const panel = this.panels.get(panelId);
    if (panel) {
      panel.messageId = messageId;
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
    this.events.push(event);
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
  public createdChannels: CreateTicketChannelParams[] = [];
  public introMessages: SendTicketIntroParams[] = [];
  public claimUpdates: Array<{ channelId: string; ticketId: string; claimedBy: string }> = [];
  public movedChannels: Array<{ channelId: string; categoryId: string | null }> = [];
  public requesterPermissions: Array<{ channelId: string; requesterId: string; allowSend: boolean }> = [];
  public addedMembers: Array<{ channelId: string; userId: string }> = [];
  public removedMembers: Array<{ channelId: string; userId: string }> = [];
  public logMessages: SendLogParams[] = [];
  public transcriptMessages: TranscriptMessage[] = [];

  public async sendPanelMessage(panel: TicketPanelWithOptions): Promise<string> {
    return `panel-message-${panel.id}`;
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

  public async fetchTranscriptMessages(): Promise<TranscriptMessage[]> {
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
