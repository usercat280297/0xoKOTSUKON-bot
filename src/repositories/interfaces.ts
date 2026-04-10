import type {
  AddPanelOptionInput,
  CreatePanelInput,
  CreateTicketInput,
  GuildConfig,
  Ticket,
  TicketEvent,
  TicketOption,
  TicketPanel,
  TicketPanelWithOptions
} from "../domain/types";

export interface GuildConfigRepository {
  getByGuildId(guildId: string): Promise<GuildConfig | null>;
  upsert(
    guildId: string,
    patch: { logChannelId?: string | null; closedCategoryId?: string | null }
  ): Promise<GuildConfig>;
}

export interface PanelRepository {
  create(input: CreatePanelInput): Promise<TicketPanel>;
  addOption(input: AddPanelOptionInput): Promise<TicketOption>;
  getById(panelId: string): Promise<TicketPanelWithOptions | null>;
  getOptionById(optionId: string): Promise<TicketOption | null>;
  listByGuildId(guildId: string): Promise<TicketPanelWithOptions[]>;
  savePublishedMessage(panelId: string, messageId: string): Promise<void>;
  disable(panelId: string): Promise<boolean>;
}

export interface TicketRepository {
  create(input: CreateTicketInput): Promise<Ticket>;
  findOpenByUser(guildId: string, userId: string): Promise<Ticket | null>;
  findByChannelId(channelId: string): Promise<Ticket | null>;
  findById(ticketId: string): Promise<Ticket | null>;
  markClaimed(ticketId: string, claimedBy: string): Promise<Ticket>;
  close(ticketId: string, closedBy: string, transcriptMessageId: string | null): Promise<Ticket>;
  reopen(ticketId: string): Promise<Ticket>;
  addEvent(event: TicketEvent): Promise<void>;
}
