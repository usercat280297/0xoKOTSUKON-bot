export type TicketStatus = "open" | "closed";
export type PanelTemplate = "default" | "game-activation";

export interface GuildConfig {
  guildId: string;
  logChannelId: string | null;
  closedCategoryId: string | null;
}

export interface TicketPanel {
  id: string;
  guildId: string;
  name: string;
  channelId: string;
  messageId: string | null;
  placeholder: string;
  template: PanelTemplate;
  active: boolean;
}

export interface TicketOption {
  id: string;
  panelId: string;
  value: string;
  label: string;
  emoji: string | null;
  requiredRoleId: string;
  redirectChannelId: string;
  targetCategoryId: string;
  staffRoleId: string;
  active: boolean;
}

export interface TicketPanelWithOptions extends TicketPanel {
  options: TicketOption[];
}

export interface Ticket {
  id: string;
  guildId: string;
  userId: string;
  channelId: string;
  optionId: string;
  status: TicketStatus;
  originalCategoryId: string | null;
  claimedBy: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  transcriptMessageId: string | null;
}

export interface TicketEvent {
  id?: number;
  ticketId: string;
  actorId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
}

export interface CreatePanelInput {
  guildId: string;
  name: string;
  channelId: string;
  placeholder: string;
  template: PanelTemplate;
}

export interface AddPanelOptionInput {
  panelId: string;
  value: string;
  label: string;
  emoji: string | null;
  requiredRoleId: string;
  redirectChannelId: string;
  targetCategoryId: string;
  staffRoleId: string;
}

export interface CreateTicketInput {
  guildId: string;
  userId: string;
  channelId: string;
  optionId: string;
  status: TicketStatus;
  originalCategoryId: string | null;
  claimedBy: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  transcriptMessageId: string | null;
}

export interface TranscriptMessage {
  id: string;
  authorId: string;
  authorTag: string;
  avatarUrl: string | null;
  content: string;
  createdAt: Date;
  attachments: Array<{ name: string; url: string }>;
}

export interface TicketRouteContext {
  panel: TicketPanelWithOptions;
  option: TicketOption;
}
