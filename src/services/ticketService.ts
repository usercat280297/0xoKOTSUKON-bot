import { getTicketIssueByValue } from "../config/ticketIssueCatalog";
import type { Ticket, TicketOption, TicketPanelWithOptions } from "../domain/types";
import type { GuildConfigRepository, PanelRepository, TicketRepository } from "../repositories/interfaces";
import { shortenId, slugifyTicketName } from "../utils/formatters";
import { BusinessHoursService } from "./businessHoursService";
import type { DiscordTicketGateway } from "./discordGateway";
import { PermissionService } from "./permissionService";
import type {
  SteamActivationScreenshotAnalyzer,
  SteamActivationScreenshotValidationResult
} from "./steamActivationScreenshotService";
import { TranscriptService } from "./transcriptService";

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

export interface IncomingTicketAttachment {
  name: string;
  url: string;
  contentType: string | null;
}

export interface IncomingTicketMessage {
  channelId: string;
  authorId: string;
  attachments: IncomingTicketAttachment[];
}

export class TicketService {
  public constructor(
    private readonly guildConfigs: GuildConfigRepository,
    private readonly panels: PanelRepository,
    private readonly tickets: TicketRepository,
    private readonly gateway: DiscordTicketGateway,
    private readonly permissions: PermissionService,
    private readonly transcripts: TranscriptService,
    private readonly businessHours: BusinessHoursService,
    private readonly steamActivationScreenshots: SteamActivationScreenshotAnalyzer
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
      panelTemplate: route.panel.template,
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

  public activateByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.activateResolvedTicket(() => this.tickets.findById(ticketId), actor);
  }

  public reopenByChannelId(channelId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.reopenResolvedTicket(() => this.tickets.findByChannelId(channelId), actor);
  }

  public async selectIssueByTicketId(ticketId: string, issueValue: string, actorId: string): Promise<ServiceResponse> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    if (ticket.userId !== actorId) {
      return { ok: false, message: "Chỉ người mở ticket mới có thể chọn mô tả nhanh trong panel này." };
    }

    const issue = getTicketIssueByValue(issueValue);
    if (!issue) {
      return { ok: false, message: "Lựa chọn này không hợp lệ." };
    }

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId,
      eventType: "ticket.issue_selected",
      payload: {
        issueValue: issue.value,
        issueLabel: issue.label
      }
    });

    await this.gateway.updateTicketIssueState(ticket.channelId, ticket.id, issue.value, issue.label);

    return {
      ok: true,
      message: `Đã ghi nhận vấn đề của bạn: **${issue.label}**. Bạn có thể tiếp tục nhắn trực tiếp trong ticket này.`
    };
  }

  public async handleIncomingTicketMessage(input: IncomingTicketMessage): Promise<void> {
    const imageAttachment = this.findImageAttachment(input.attachments);
    if (!imageAttachment) {
      return;
    }

    const ticket = await this.tickets.findByChannelId(input.channelId);
    if (!ticket || ticket.status !== "open" || ticket.userId !== input.authorId) {
      return;
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isSteamActivationPanel(route.panel)) {
      return;
    }

    if (!ticket.claimedBy) {
      await this.gateway.sendChannelMessage(
        input.channelId,
        `<@${input.authorId}> đợi staff claim ticket trước rồi hãy gửi lại ảnh xác minh nhé.`
      );
      return;
    }

    try {
      await this.gateway.sendChannelMessage(input.channelId, "Đang xác minh ảnh...");
      const result = await this.steamActivationScreenshots.validateAttachmentUrl(imageAttachment.url);
      await this.tickets.addEvent({
        ticketId: ticket.id,
        actorId: input.authorId,
        eventType: result.passed ? "ticket.screenshot_validation_passed" : "ticket.screenshot_validation_failed",
        payload: {
          attachmentName: imageAttachment.name,
          score: result.score,
          matchedSignals: result.matchedSignals,
          missingSignals: result.missingSignals,
          ocrExcerpt: result.ocrExcerpt
        }
      });

      if (result.passed) {
        await this.gateway.sendVerificationReadyPrompt(input.channelId, ticket.id);
      } else {
        await this.gateway.sendChannelMessage(input.channelId, this.buildScreenshotValidationMessage(result));
      }
    } catch (error) {
      console.error("Failed to validate Steam activation screenshot.", error);
      await this.gateway.sendChannelMessage(
        input.channelId,
        [
          `<@${input.authorId}> bot chưa đọc được ảnh này.`,
          "Hãy gửi lại ảnh rõ hơn, chụp trọn cửa sổ Windows Update Blocker và cửa sổ properties của thư mục game."
        ].join("\n")
      );
    }
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

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.permissions.isStaff(actor.actorRoleIds, route.option.staffRoleId, actor.hasManageChannels)) {
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

    if (this.isSteamActivationPanel(route.panel)) {
      await this.gateway.sendChannelMessage(
        updated.channelId,
        [
          `<@${updated.userId}> staff đã claim ticket này.`,
          "Hãy gửi 1 ảnh màn hình giống mẫu bot đã gửi trong ticket.",
          "Bot sẽ kiểm tra sơ bộ các dấu hiệu như Windows Update Blocker, dấu X đỏ và cửa sổ properties của thư mục game trong SteamLibrary/steamapps/common."
        ].join("\n")
      );
    }

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

    const route = await this.resolveTicketRoute(ticket);
    if (!route) {
      return { ok: false, message: "Không resolve được route của ticket." };
    }

    if (
      !this.permissions.canCloseTicket(
        actor.actorId,
        ticket.userId,
        actor.actorRoleIds,
        route.option.staffRoleId,
        actor.hasManageChannels
      )
    ) {
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

  private async activateResolvedTicket(resolve: () => Promise<Ticket | null>, actor: ActorContext): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route) {
      return { ok: false, message: "Không resolve được route của ticket." };
    }

    const isRequester = actor.actorId === ticket.userId;
    const isStaff = this.permissions.isStaff(actor.actorRoleIds, route.option.staffRoleId, actor.hasManageChannels);
    if (!isRequester && !isStaff) {
      return { ok: false, message: "Bạn không có quyền dùng nút activation này." };
    }

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.activation_requested",
      payload: {}
    });
    await this.gateway.markVerificationReadyState(ticket.channelId, ticket.id, actor.actorId);

    return {
      ok: true,
      message: "Đã chuyển ticket sang bước activation."
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

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.permissions.isStaff(actor.actorRoleIds, route.option.staffRoleId, actor.hasManageChannels)) {
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

  private async resolveTicketRoute(ticket: Ticket): Promise<{ panel: TicketPanelWithOptions; option: TicketOption } | null> {
    const option = await this.panels.getOptionById(ticket.optionId);
    if (!option) {
      return null;
    }

    const panel = await this.panels.getById(option.panelId);
    if (!panel) {
      return null;
    }

    return { panel, option };
  }

  private isSteamActivationPanel(panel: TicketPanelWithOptions): boolean {
    return panel.template === "game-activation" && panel.name.trim().toUpperCase().includes("STEAM ACTIVATION");
  }

  private findImageAttachment(attachments: IncomingTicketAttachment[]): IncomingTicketAttachment | null {
    return (
      attachments.find((attachment) => {
        if (attachment.contentType?.startsWith("image/")) {
          return true;
        }

        return /\.(png|jpe?g|webp|bmp)$/i.test(attachment.name);
      }) ?? null
    );
  }

  private buildScreenshotValidationMessage(result: SteamActivationScreenshotValidationResult): string {
    if (result.passed) {
      return `Ảnh hợp lệ, độ khớp **${result.score}%**.`;
    }

    return `Ảnh chưa đạt, độ khớp **${result.score}%**. Hãy gửi lại ảnh rõ hơn.`;
  }

  private buildTicketChannelName(optionLabel: string, displayName: string, userId: string): string {
    const base = slugifyTicketName(`${optionLabel}-${displayName || "user"}`) || "ticket";
    return `${base}-${shortenId(userId)}`.slice(0, 90);
  }
}
