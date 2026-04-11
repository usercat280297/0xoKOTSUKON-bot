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
  UpdatePanelOptionStockInput
} from "../domain/types";

export interface GuildConfigRepository {
  getByGuildId(guildId: string): Promise<GuildConfig | null>;
  upsert(
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
  ): Promise<GuildConfig>;
}

export interface PanelRepository {
  create(input: CreatePanelInput): Promise<TicketPanel>;
  addOption(input: AddPanelOptionInput): Promise<TicketOption>;
  updateOptionStock(input: UpdatePanelOptionStockInput): Promise<TicketOption | null>;
  getById(panelId: string): Promise<TicketPanelWithOptions | null>;
  getOptionById(optionId: string): Promise<TicketOption | null>;
  listByGuildId(guildId: string): Promise<TicketPanelWithOptions[]>;
  savePublishedMessages(panelId: string, messageIds: string[]): Promise<void>;
  disable(panelId: string): Promise<boolean>;
}

export interface TicketRepository {
  create(input: CreateTicketInput): Promise<Ticket>;
  findOpenByUser(guildId: string, userId: string): Promise<Ticket | null>;
  listOpen(): Promise<Ticket[]>;
  findByChannelId(channelId: string): Promise<Ticket | null>;
  findById(ticketId: string): Promise<Ticket | null>;
  markClaimed(ticketId: string, claimedBy: string): Promise<Ticket>;
  close(ticketId: string, closedBy: string, transcriptMessageId: string | null): Promise<Ticket>;
  reopen(ticketId: string): Promise<Ticket>;
  addEvent(event: TicketEvent): Promise<void>;
  listEvents(ticketId: string): Promise<TicketEvent[]>;
}
