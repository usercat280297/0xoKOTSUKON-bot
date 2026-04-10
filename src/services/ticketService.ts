import type { GuildConfigRepository, PanelRepository, TicketRepository } from "../repositories/interfaces";
import type { Ticket, TicketOption, TicketPanelWithOptions } from "../domain/types";
import type { DiscordTicketGateway } from "./discordGateway";
import { BusinessHoursService } from "./businessHoursService";
import { PermissionService } from "./permissionService";
import { TranscriptService } from "./transcriptService";
import { shortenId, slugifyTicketName } from "../utils/formatters";

export interface SelectionContext {
  guildId: string;
  panelId: string;
  optionValue: string;
  userId: string;
  memberRoleIds: string[];
  displayName: string;
}

export interface ActorContext {
  actorId: string;
  actorRoleIds: string[];
  hasManageChannels: boolean;
}

export interface ServiceResponse {
  ok: boolean;
  message: string;
}

export class TicketService {
  public constructor(
    private readonly guildConfigs: GuildConfigRepository,
    private readonly panels: PanelRepository,
    private readonly tickets: TicketRepository,
    private readonly gateway: DiscordTicketGateway,
    private readonly permissions: PermissionService,
    private readonly transcripts: TranscriptService,
    private readonly businessHours: BusinessHoursService
  ) {}

  public async createFromSelection(input: SelectionContext): Promise<ServiceResponse> {
    const route = await this.resolvePanelOption(input.panelId, input.optionValue);
    if (!route || !route.panel.active || !route.option.active) {
      return {
        ok: false,
        message: "Panel hoặc loại ticket này không còn hoạt động."
      };
    }

    const hours = this.businessHours.getStatus();
    if (!hours.isOpen) {
      return {
        ok: false,
        message: `Khung giờ mở ticket là ${hours.windowLabel} (${hours.timezone}) mỗi ngày. Hiện tại là ${hours.currentTimeLabel}, nên bạn chưa thể mở ticket.`
      };
    }

    if (!this.permissions.hasRequiredRole(input.memberRoleIds, route.option.requiredRoleId)) {
      return {
        ok: false,
        message: `Bạn chưa có role hợp lệ để mở ticket này. Hãy vào ${this.gateway.channelMention(route.option.redirectChannelId)} để chọn role rồi quay lại panel.`
      };
    }

    const existing = await this.tickets.findOpenByUser(input.guildId, input.userId);
    if (existing) {
      return {
        ok: false,
        message: `Bạn đang có ticket đang mở tại ${this.gateway.channelMention(existing.channelId)}. Hãy đóng ticket hiện tại trước khi mở ticket mới.`
      };
    }

    const channelName = this.buildTicketChannelName(route.option.label, input.displayName, input.userId);
    const channel = await this.gateway.createTicketChannel({
      guildId: input.guildId,
      channelName,
      targetCategoryId: route.option.targetCategoryId,
      requesterId: input.userId,
      staffRoleId: route.option.staffRoleId
    });

    const ticket = await this.tickets.create({
      guildId: input.guildId,
      userId: input.userId,
      channelId: channel.channelId,
      optionId: route.option.id,
      status: "open",
      originalCategoryId: route.option.targetCategoryId,
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: input.userId,
      eventType: "ticket.created",
      payload: {
        panelId: route.panel.id,
        optionId: route.option.id,
        optionValue: route.option.value
      }
    });

    await this.gateway.sendTicketIntro({
      channelId: channel.channelId,
      ticketId: ticket.id,
      requesterId: input.userId,
      panelName: route.panel.name,
      optionLabel: route.option.label
    });

    return {
      ok: true,
      message: `Ticket đã được mở tại ${this.gateway.channelMention(channel.channelId)}.`
    };
  }

  public claimByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.claimResolvedTicket(() => this.tickets.findById(ticketId), actor);
  }

  public claimByChannelId(channelId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.claimResolvedTicket(() => this.tickets.findByChannelId(channelId), actor);
  }

  public closeByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.closeResolvedTicket(() => this.tickets.findById(ticketId), actor);
  }

  public closeByChannelId(channelId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.closeResolvedTicket(() => this.tickets.findByChannelId(channelId), actor);
  }

  public reopenByChannelId(channelId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.reopenResolvedTicket(() => this.tickets.findByChannelId(channelId), actor);
  }

  public async addMember(channelId: string, memberId: string, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await this.tickets.findByChannelId(channelId);
    if (!ticket) {
      return { ok: false, message: "Kênh này không gắn với ticket nào." };
    }

    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option || !this.permissions.isStaff(actor.actorRoleIds, option.staffRoleId, actor.hasManageChannels)) {
      return { ok: false, message: "Bạn không có quyền thêm thành viên vào ticket này." };
    }

    await this.gateway.addChannelMember(channelId, memberId);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.member_added",
      payload: {
        memberId
      }
    });

    return { ok: true, message: `Đã thêm <@${memberId}> vào ticket.` };
  }

  public async removeMember(channelId: string, memberId: string, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await this.tickets.findByChannelId(channelId);
    if (!ticket) {
      return { ok: false, message: "Kênh này không gắn với ticket nào." };
    }

    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option || !this.permissions.isStaff(actor.actorRoleIds, option.staffRoleId, actor.hasManageChannels)) {
      return { ok: false, message: "Bạn không có quyền xóa thành viên khỏi ticket này." };
    }

    await this.gateway.removeChannelMember(channelId, memberId);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.member_removed",
      payload: {
        memberId
      }
    });

    return { ok: true, message: `Đã xóa <@${memberId}> khỏi ticket.` };
  }

  private async claimResolvedTicket(resolve: () => Promise<Ticket | null>, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option || !this.permissions.isStaff(actor.actorRoleIds, option.staffRoleId, actor.hasManageChannels)) {
      return { ok: false, message: "Bạn không có quyền claim ticket này." };
    }

    if (ticket.claimedBy && ticket.claimedBy !== actor.actorId) {
      return { ok: false, message: `Ticket này đã được claim bởi <@${ticket.claimedBy}>.` };
    }

    if (ticket.claimedBy === actor.actorId) {
      return { ok: true, message: "Ticket này đã do bạn claim trước đó." };
    }

    const updated = await this.tickets.markClaimed(ticket.id, actor.actorId);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.claimed",
      payload: {}
    });
    await this.gateway.updateTicketClaimState(updated.channelId, updated.id, actor.actorId);

    return { ok: true, message: `Đã claim ticket ${this.gateway.channelMention(updated.channelId)}.` };
  }

  private async closeResolvedTicket(resolve: () => Promise<Ticket | null>, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option) {
      return { ok: false, message: "Không resolve được route của ticket." };
    }

    if (!this.permissions.canCloseTicket(actor.actorId, ticket.userId, actor.actorRoleIds, option.staffRoleId, actor.hasManageChannels)) {
      return { ok: false, message: "Bạn không có quyền đóng ticket này." };
    }

    const guildConfig = await this.guildConfigs.getByGuildId(ticket.guildId);
    if (!guildConfig?.logChannelId) {
      return {
        ok: false,
        message: "Guild chưa cấu hình log channel. Hãy dùng lệnh /config set-log-channel trước."
      };
    }

    const transcriptMessages = await this.gateway.fetchTranscriptMessages(ticket.channelId);
    const transcriptHtml = this.transcripts.render(ticket.channelId, transcriptMessages);
    const transcriptMessageId = await this.gateway.sendLogMessage({
      logChannelId: guildConfig.logChannelId,
      content: [
        `Ticket closed: ${this.gateway.channelMention(ticket.channelId)}`,
        `Requester: <@${ticket.userId}>`,
        `Closed by: <@${actor.actorId}>`
      ].join("\n"),
      transcriptHtml,
      transcriptFileName: `${ticket.channelId}.html`
    });

    await this.tickets.close(ticket.id, actor.actorId, transcriptMessageId);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.closed",
      payload: {
        transcriptMessageId
      }
    });

    await this.gateway.deleteChannel(ticket.channelId);

    return {
      ok: true,
      message: `Đã đóng ticket, gửi transcript về ${this.gateway.channelMention(guildConfig.logChannelId)} và xóa kênh.`
    };
  }

  private async reopenResolvedTicket(resolve: () => Promise<Ticket | null>, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "closed") {
      return { ok: false, message: "Ticket này đang mở." };
    }

    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option || !this.permissions.isStaff(actor.actorRoleIds, option.staffRoleId, actor.hasManageChannels)) {
      return { ok: false, message: "Bạn không có quyền mở lại ticket này." };
    }

    return {
      ok: false,
      message: "Bot đang chạy ở chế độ xóa kênh khi close, nên không thể reopen ticket đã đóng."
    };
  }

  private async resolvePanelOption(panelId: string, optionValue: string): Promise<{ panel: TicketPanelWithOptions; option: TicketOption } | null> {
    const panel = await this.panels.getById(panelId);
    if (!panel) {
      return null;
    }

    const option = panel.options.find((item) => item.value === optionValue);
    if (!option) {
      return null;
    }

    return { panel, option };
  }

  private buildTicketChannelName(optionLabel: string, displayName: string, userId: string): string {
    const base = slugifyTicketName(`${optionLabel}-${displayName || "user"}`) || "ticket";
    return `${base}-${shortenId(userId)}`.slice(0, 90);
  }
}
