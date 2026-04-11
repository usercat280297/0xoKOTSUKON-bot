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

export interface OutgoingTicketAttachment {
  name: string | null;
  url: string | null;
  linkUrl: string | null;
}

export interface IncomingTicketMessage {
  channelId: string;
  authorId: string;
  attachments: IncomingTicketAttachment[];
}

interface SteamWorkflowSnapshot {
  claimedAt: Date | null;
  screenshotValidatedAt: Date | null;
  activationRequestedAt: Date | null;
  tokenSentAt: Date | null;
  tokenDueAt: Date | null;
  downloadConfirmedAt: Date | null;
  autoCloseAt: Date | null;
  screenshotDueAt: Date | null;
}

interface DonationWorkflowSnapshot {
  intentConfirmedAt: Date | null;
  proofUploadedAt: Date | null;
  approvedAt: Date | null;
}

const SCREENSHOT_WINDOW_MS = 20 * 60 * 1000;
const TOKEN_WINDOW_MS = 30 * 60 * 1000;
const AUTO_CLOSE_AFTER_ACTIVATION_MS = 60 * 1000;
const SYSTEM_ACTOR_ID = "system";

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

    const guildConfig = await this.guildConfigs.getByGuildId(input.guildId);
    const extraAllowedRoleIds =
      this.isSteamActivationPanel(route.panel) && guildConfig?.donatorRoleId ? [guildConfig.donatorRoleId] : [];

    if (!this.permissions.hasRequiredRole(input.memberRoleIds, route.option.requiredRoleId, extraAllowedRoleIds)) {
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

    if (this.isDonationPanel(route.panel)) {
      await this.gateway.sendDonationPrompt({
        channelId: channel.channelId,
        ticketId: ticket.id,
        donationLinkUrl: guildConfig?.donationLinkUrl ?? null,
        donationQrImageUrl: guildConfig?.donationQrImageUrl ?? null
      });
    }

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

  public sendActivationTokenByChannel(
    channelId: string,
    actor: ActorContext,
    attachment: OutgoingTicketAttachment
  ): Promise<ServiceResponse> {
    return this.sendActivationTokenResolved(() => this.tickets.findByChannelId(channelId), actor, attachment);
  }

  public confirmDonationIntentByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.confirmDonationIntentResolved(() => this.tickets.findById(ticketId), actor);
  }

  public approveDonationByChannel(channelId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.approveDonationResolved(() => this.tickets.findByChannelId(channelId), actor);
  }

  public activateByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.activateResolvedTicket(() => this.tickets.findById(ticketId), actor);
  }

  public confirmTokenDownloadedByTicketId(ticketId: string, actor: ActorContext): Promise<ServiceResponse> {
    return this.confirmTokenDownloadedResolved(() => this.tickets.findById(ticketId), actor);
  }

  public submitTokenSupportByTicketId(ticketId: string, actor: ActorContext, reason: string): Promise<ServiceResponse> {
    return this.submitTokenSupportResolved(() => this.tickets.findById(ticketId), actor, reason);
  }

  public async processExpiredSteamDeadlines(): Promise<void> {
    const openTickets = await this.tickets.listOpen();

    for (const ticket of openTickets) {
      const route = await this.resolveTicketRoute(ticket);
      if (!route || !this.isSteamActivationPanel(route.panel)) {
        continue;
      }

      const workflow = await this.getSteamWorkflow(ticket.id);
      const now = new Date();

      if (workflow.autoCloseAt && workflow.autoCloseAt.getTime() <= now.getTime()) {
        await this.gateway.sendChannelMessage(ticket.channelId, "Đã đủ 1 phút, mình đóng ticket này nhé.");
        await this.forceCloseTicket(ticket, "Ticket tự đóng sau khi xác nhận hoạt động.");
        continue;
      }

      if (workflow.tokenDueAt && workflow.tokenDueAt.getTime() <= now.getTime()) {
        await this.gateway.sendChannelMessage(ticket.channelId, "Đã quá 30 phút tải token, ticket này sẽ được đóng.");
        await this.forceCloseTicket(ticket, "Ticket quá hạn tải token.");
        continue;
      }

      if (
        workflow.screenshotDueAt &&
        !workflow.screenshotValidatedAt &&
        workflow.screenshotDueAt.getTime() <= now.getTime()
      ) {
        await this.gateway.sendChannelMessage(ticket.channelId, "Đã quá 20 phút gửi ảnh xác minh, ticket này sẽ được đóng.");
        await this.forceCloseTicket(ticket, "Ticket quá hạn gửi ảnh xác minh.");
      }
    }
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
    if (!route) {
      return;
    }

    if (this.isDonationPanel(route.panel)) {
      const workflow = await this.getDonationWorkflow(ticket.id);
      if (workflow.approvedAt) {
        return;
      }

      if (!workflow.intentConfirmedAt) {
        await this.gateway.sendChannelMessage(
          input.channelId,
          "Hãy bấm **Tôi đã gửi** trước, rồi gửi ảnh xác nhận donate vào ticket này."
        );
        return;
      }

      await this.tickets.addEvent({
        ticketId: ticket.id,
        actorId: input.authorId,
        eventType: "ticket.donation_proof_uploaded",
        payload: {
          attachmentName: imageAttachment.name,
          attachmentUrl: imageAttachment.url
        }
      });

      const staffMention = ticket.claimedBy ? `<@${ticket.claimedBy}>` : `<@&${route.option.staffRoleId}>`;
      await this.gateway.sendChannelMessage(
        input.channelId,
        `${staffMention} member đã gửi ảnh xác nhận donate. Admin có thể dùng /ticket approve-donation để duyệt.`
      );
      return;
    }

    if (!this.isSteamActivationPanel(route.panel)) {
      return;
    }

    if (!ticket.claimedBy) {
      await this.gateway.sendChannelMessage(
        input.channelId,
        "Ticket này chưa được staff nhận. Chờ staff nhận rồi gửi lại ảnh nhé."
      );
      return;
    }

    const workflow = await this.getSteamWorkflow(ticket.id);
    if (workflow.screenshotDueAt && workflow.screenshotDueAt.getTime() <= Date.now()) {
      await this.gateway.sendChannelMessage(input.channelId, "Đã quá 20 phút gửi ảnh xác minh, ticket này sẽ được đóng.");
      await this.forceCloseTicket(ticket, "Ticket quá hạn gửi ảnh xác minh.");
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
        "Mình chưa đọc được ảnh này. Gửi lại ảnh rõ hơn giúp mình nhé."
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
        "Đã nhận ticket. Bạn có 20 phút để gửi 1 ảnh giống mẫu bot đã ghim trong ticket."
      );
    } else if (this.isDonationPanel(route.panel)) {
      await this.gateway.sendChannelMessage(
        updated.channelId,
        "Đã nhận ticket donate. Khi member bấm **Tôi đã gửi** và up ảnh xác nhận, admin dùng `/ticket approve-donation` để duyệt."
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

    const workflow = await this.getSteamWorkflow(ticket.id);
    if (!workflow.screenshotValidatedAt) {
      return { ok: false, message: "Ảnh xác minh chưa đạt, chưa thể chuyển sang bước kích hoạt." };
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

  private async confirmDonationIntentResolved(
    resolve: () => Promise<Ticket | null>,
    actor: ActorContext
  ): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isDonationPanel(route.panel)) {
      return { ok: false, message: "Nút này chỉ dùng cho ticket donate." };
    }

    if (actor.actorId !== ticket.userId) {
      return { ok: false, message: "Chỉ người mở ticket mới được xác nhận donate." };
    }

    const workflow = await this.getDonationWorkflow(ticket.id);
    if (workflow.approvedAt) {
      return { ok: true, message: "Donate này đã được duyệt trước đó." };
    }

    if (workflow.intentConfirmedAt) {
      return { ok: true, message: "Mình đã ghi nhận bạn xác nhận donate rồi. Giờ chỉ cần gửi ảnh xác nhận vào ticket." };
    }

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.donation_intent_confirmed",
      payload: {}
    });

    await this.gateway.markDonationIntentState(ticket.channelId, ticket.id);
    await this.gateway.sendChannelMessage(
      ticket.channelId,
      "Đã ghi nhận. Giờ hãy gửi ảnh xác nhận donate vào ticket này để admin duyệt."
    );

    return {
      ok: true,
      message: "Đã ghi nhận bạn xác nhận donate."
    };
  }

  private async approveDonationResolved(
    resolve: () => Promise<Ticket | null>,
    actor: ActorContext
  ): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isDonationPanel(route.panel)) {
      return { ok: false, message: "Lệnh này chỉ dùng cho ticket donate." };
    }

    if (!actor.hasManageChannels) {
      return { ok: false, message: "Chỉ admin mới được duyệt donate." };
    }

    const workflow = await this.getDonationWorkflow(ticket.id);
    if (!workflow.intentConfirmedAt) {
      return { ok: false, message: "Member chưa bấm xác nhận donate." };
    }

    if (!workflow.proofUploadedAt) {
      return { ok: false, message: "Member chưa gửi ảnh xác nhận donate." };
    }

    if (workflow.approvedAt) {
      return { ok: true, message: "Donate này đã được duyệt trước đó." };
    }

    const guildConfig = await this.guildConfigs.getByGuildId(ticket.guildId);
    if (!guildConfig?.donatorRoleId) {
      return { ok: false, message: "Guild chưa cấu hình DONATOR role. Dùng /config set-donator-role trước." };
    }

    if (!guildConfig.donationThanksChannelId) {
      return {
        ok: false,
        message: "Guild chưa cấu hình kênh cảm ơn donate. Dùng /config set-donation-thanks-channel trước."
      };
    }

    await this.gateway.addGuildMemberRole(ticket.guildId, ticket.userId, guildConfig.donatorRoleId);
    const thanksMessageId = await this.gateway.sendDonationThanks({
      guildId: ticket.guildId,
      thanksChannelId: guildConfig.donationThanksChannelId,
      userId: ticket.userId
    });

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.donation_approved",
      payload: {
        thanksChannelId: guildConfig.donationThanksChannelId,
        thanksMessageId,
        grantedRoleId: guildConfig.donatorRoleId
      }
    });

    await this.gateway.markDonationApprovedState(ticket.channelId, ticket.id, actor.actorId);
    await this.gateway.sendChannelMessage(
      ticket.channelId,
      `Đã xác nhận donate cho <@${ticket.userId}> và cấp role <@&${guildConfig.donatorRoleId}>.`
    );

    return {
      ok: true,
      message: `Đã duyệt donate cho <@${ticket.userId}>.`
    };
  }

  private async sendActivationTokenResolved(
    resolve: () => Promise<Ticket | null>,
    actor: ActorContext,
    attachment: OutgoingTicketAttachment
  ): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isSteamActivationPanel(route.panel)) {
      return { ok: false, message: "Lệnh này chỉ dùng cho ticket Steam Activation." };
    }

    if (!actor.hasManageChannels) {
      return { ok: false, message: "Chỉ admin mới được dùng lệnh này." };
    }

    if (!attachment.url && !attachment.linkUrl) {
      return { ok: false, message: "Bạn phải gửi file hoặc link token." };
    }

    const workflow = await this.getSteamWorkflow(ticket.id);
    if (!workflow.activationRequestedAt) {
      return { ok: false, message: "User chưa bấm bước kích hoạt, chưa thể gửi token." };
    }

    const tokenExpiresAt = new Date(Date.now() + TOKEN_WINDOW_MS);

    await this.gateway.sendActivationTokenPanel({
      channelId: ticket.channelId,
      ticketId: ticket.id,
      fileName: attachment.name,
      fileUrl: attachment.url,
      linkUrl: attachment.linkUrl,
      tokenExpiresAt
    });
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.activation_token_sent",
      payload: {
        fileName: attachment.name,
        hasLink: Boolean(attachment.linkUrl)
      }
    });

    return {
      ok: true,
      message: "Đã gửi panel token kích hoạt."
    };
  }

  private async confirmTokenDownloadedResolved(
    resolve: () => Promise<Ticket | null>,
    actor: ActorContext
  ): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isSteamActivationPanel(route.panel)) {
      return { ok: false, message: "Nút này chỉ dùng cho ticket Steam Activation." };
    }

    if (actor.actorId !== ticket.userId) {
      return { ok: false, message: "Chỉ người mở ticket mới được xác nhận token hoạt động." };
    }

    const workflow = await this.getSteamWorkflow(ticket.id);
    if (!workflow.tokenSentAt || !workflow.tokenDueAt) {
      return { ok: false, message: "Admin chưa gửi token ở ticket này." };
    }

    if (workflow.tokenDueAt.getTime() <= Date.now()) {
      await this.gateway.sendChannelMessage(ticket.channelId, "Đã quá 30 phút tải token, ticket này sẽ được đóng.");
      await this.forceCloseTicket(ticket, "Ticket quá hạn tải token.");
      return { ok: false, message: "Token đã quá hạn." };
    }

    const autoCloseAt = new Date(Date.now() + AUTO_CLOSE_AFTER_ACTIVATION_MS);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.activation_download_confirmed",
      payload: {
        autoCloseAt: autoCloseAt.toISOString()
      }
    });
    await this.gateway.markActivationTokenConfirmed(ticket.channelId, ticket.id, actor.actorId, autoCloseAt);

    return {
      ok: true,
      message: "Đã xác nhận token hoạt động."
    };
  }

  private async submitTokenSupportResolved(
    resolve: () => Promise<Ticket | null>,
    actor: ActorContext,
    reason: string
  ): Promise<ServiceResponse> {
    const ticket = await resolve();
    if (!ticket) {
      return { ok: false, message: "Không tìm thấy ticket." };
    }

    if (ticket.status !== "open") {
      return { ok: false, message: "Ticket này đã đóng." };
    }

    const route = await this.resolveTicketRoute(ticket);
    if (!route || !this.isSteamActivationPanel(route.panel)) {
      return { ok: false, message: "Nút support chỉ dùng cho ticket Steam Activation." };
    }

    if (actor.actorId !== ticket.userId) {
      return { ok: false, message: "Chỉ người mở ticket mới được gửi lý do support ở bước này." };
    }

    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      return { ok: false, message: "Lý do support không được để trống." };
    }

    const workflow = await this.getSteamWorkflow(ticket.id);
    if (!workflow.tokenSentAt || !workflow.tokenDueAt) {
      return { ok: false, message: "Admin chưa gửi token ở ticket này." };
    }

    if (workflow.tokenDueAt.getTime() <= Date.now()) {
      await this.gateway.sendChannelMessage(ticket.channelId, "Đã quá 30 phút tải token, ticket này sẽ được đóng.");
      await this.forceCloseTicket(ticket, "Ticket quá hạn tải token.");
      return { ok: false, message: "Token đã quá hạn." };
    }

    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: actor.actorId,
      eventType: "ticket.activation_support_requested",
      payload: {
        reason: normalizedReason
      }
    });

    const staffMention = ticket.claimedBy ? `<@${ticket.claimedBy}>` : `<@&${route.option.staffRoleId}>`;
    await this.gateway.sendChannelMessage(
      ticket.channelId,
      `${staffMention} member cần support.\nLý do: ${normalizedReason}`
    );

    return {
      ok: true,
      message: "Đã gửi lý do support cho admin."
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

  private isDonationPanel(panel: TicketPanelWithOptions): boolean {
    return panel.template === "donation";
  }

  private async getSteamWorkflow(ticketId: string): Promise<SteamWorkflowSnapshot> {
    const events = await this.tickets.listEvents(ticketId);
    let claimedAt: Date | null = null;
    let screenshotValidatedAt: Date | null = null;
    let activationRequestedAt: Date | null = null;
    let tokenSentAt: Date | null = null;
    let downloadConfirmedAt: Date | null = null;

    for (const event of events) {
      const createdAt = event.createdAt ?? new Date();

      switch (event.eventType) {
        case "ticket.claimed":
          claimedAt = createdAt;
          screenshotValidatedAt = null;
          activationRequestedAt = null;
          tokenSentAt = null;
          downloadConfirmedAt = null;
          break;
        case "ticket.screenshot_validation_passed":
          screenshotValidatedAt = createdAt;
          break;
        case "ticket.activation_requested":
          activationRequestedAt = createdAt;
          break;
        case "ticket.activation_token_sent":
          tokenSentAt = createdAt;
          downloadConfirmedAt = null;
          break;
        case "ticket.activation_download_confirmed":
          downloadConfirmedAt = createdAt;
          break;
        default:
          break;
      }
    }

    return {
      claimedAt,
      screenshotValidatedAt,
      activationRequestedAt,
      tokenSentAt,
      tokenDueAt: tokenSentAt ? new Date(tokenSentAt.getTime() + TOKEN_WINDOW_MS) : null,
      downloadConfirmedAt,
      autoCloseAt: downloadConfirmedAt ? new Date(downloadConfirmedAt.getTime() + AUTO_CLOSE_AFTER_ACTIVATION_MS) : null,
      screenshotDueAt: claimedAt ? new Date(claimedAt.getTime() + SCREENSHOT_WINDOW_MS) : null
    };
  }

  private async getDonationWorkflow(ticketId: string): Promise<DonationWorkflowSnapshot> {
    const events = await this.tickets.listEvents(ticketId);
    let intentConfirmedAt: Date | null = null;
    let proofUploadedAt: Date | null = null;
    let approvedAt: Date | null = null;

    for (const event of events) {
      const createdAt = event.createdAt ?? new Date();

      switch (event.eventType) {
        case "ticket.donation_intent_confirmed":
          intentConfirmedAt = createdAt;
          break;
        case "ticket.donation_proof_uploaded":
          proofUploadedAt = createdAt;
          break;
        case "ticket.donation_approved":
          approvedAt = createdAt;
          break;
        default:
          break;
      }
    }

    return {
      intentConfirmedAt,
      proofUploadedAt,
      approvedAt
    };
  }

  private async forceCloseTicket(ticket: Ticket, reason: string): Promise<void> {
    const transcriptMessages = await this.gateway.fetchTranscriptMessages(ticket.channelId);
    const transcriptHtml = this.transcripts.render(ticket.channelId, transcriptMessages);
    const guildConfig = await this.guildConfigs.getByGuildId(ticket.guildId);
    let transcriptMessageId: string | null = null;

    if (guildConfig?.logChannelId) {
      transcriptMessageId = await this.gateway.sendLogMessage({
        logChannelId: guildConfig.logChannelId,
        content: [
          `Ticket closed: ${this.gateway.channelMention(ticket.channelId)}`,
          `Requester: <@${ticket.userId}>`,
          `Closed by: System`,
          `Reason: ${reason}`
        ].join("\n"),
        transcriptHtml,
        transcriptFileName: `${ticket.channelId}.html`
      });
    }

    await this.tickets.close(ticket.id, SYSTEM_ACTOR_ID, transcriptMessageId);
    await this.tickets.addEvent({
      ticketId: ticket.id,
      actorId: SYSTEM_ACTOR_ID,
      eventType: "ticket.closed",
      payload: {
        transcriptMessageId,
        reason
      }
    });
    await this.gateway.deleteChannel(ticket.channelId);
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

    return "Ảnh chưa đúng mẫu, vui lòng gửi lại ảnh.";
  }

  private buildTicketChannelName(optionLabel: string, displayName: string, userId: string): string {
    const base = slugifyTicketName(`${optionLabel}-${displayName || "user"}`) || "ticket";
    return `${base}-${shortenId(userId)}`.slice(0, 90);
  }
}
