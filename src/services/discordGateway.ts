import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildMember,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextChannel
} from "discord.js";
import { join } from "node:path";
import { ticketIssueCatalog } from "../config/ticketIssueCatalog";
import type { GuildConfig, PanelTemplate, TicketOption, TicketPanelWithOptions, TranscriptMessage } from "../domain/types";
import type { BusinessHoursService } from "./businessHoursService";
import { ComponentIds } from "../utils/componentIds";
import { slugifyTicketName } from "../utils/formatters";

export interface CreateTicketChannelParams {
  guildId: string;
  channelName: string;
  targetCategoryId: string;
  requesterId: string;
  staffRoleId: string;
}

export interface CreateTicketChannelResult {
  channelId: string;
  channelName: string;
}

export interface SendTicketIntroParams {
  channelId: string;
  ticketId: string;
  requesterId: string;
  panelName: string;
  panelTemplate: PanelTemplate;
  optionLabel: string;
}

export interface SendLogParams {
  logChannelId: string;
  content: string;
  transcriptHtml: string;
  transcriptFileName: string;
}

export interface SendActivationTokenPanelParams {
  channelId: string;
  ticketId: string;
  fileName?: string | null;
  fileUrl?: string | null;
  linkUrl?: string | null;
  tokenExpiresAt: Date;
}

export interface SendDonationPromptParams {
  channelId: string;
  ticketId: string;
  donationLinkUrl?: string | null;
  donationQrImageUrl?: string | null;
}

export interface SendDonationThanksParams {
  guildId: string;
  thanksChannelId: string;
  userId: string;
}

export interface SendSteamUpdateNotificationParams {
  channelId: string;
  game: {
    appId: number;
    title: string;
    storeUrl: string;
    imageUrl: string | null;
    steamDbPatchnotesUrl: string;
  };
  news: {
    gid: string;
    title: string;
    url: string;
    contents: string;
      date: number;
      feedLabel: string | null;
  } | null;
  patchSummary: string;
  storeDetails: {
    shortDescription: string | null;
    headerImageUrl: string | null;
    capsuleImageUrl: string | null;
    developers: string[];
    publishers: string[];
    genres: string[];
  } | null;
  previousBuildId: string | null;
  currentBuildId: string | null;
  buildIdReliable: boolean;
  detectedAt: number;
}

export interface DiscordTicketGateway {
  sendPanelMessage(panel: TicketPanelWithOptions): Promise<string[]>;
  createTicketChannel(params: CreateTicketChannelParams): Promise<CreateTicketChannelResult>;
  sendTicketIntro(params: SendTicketIntroParams): Promise<string>;
  updateTicketClaimState(channelId: string, ticketId: string, claimedBy: string): Promise<void>;
  updateTicketIssueState(channelId: string, ticketId: string, issueValue: string, issueLabel: string): Promise<void>;
  sendChannelMessage(channelId: string, content: string): Promise<void>;
  sendDonationPrompt(params: SendDonationPromptParams): Promise<void>;
  sendSteamUpdateNotification(params: SendSteamUpdateNotificationParams): Promise<void>;
  markDonationIntentState(channelId: string, ticketId: string): Promise<void>;
  markDonationApprovedState(channelId: string, ticketId: string, approvedBy: string): Promise<void>;
  sendDonationThanks(params: SendDonationThanksParams): Promise<string>;
  addGuildMemberRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<void>;
  sendVerificationReadyPrompt(channelId: string, ticketId: string): Promise<void>;
  markVerificationReadyState(channelId: string, ticketId: string, activatedBy: string): Promise<void>;
  sendActivationTokenPanel(params: SendActivationTokenPanelParams): Promise<void>;
  markActivationTokenConfirmed(channelId: string, ticketId: string, activatedBy: string, autoCloseAt: Date): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  addChannelMember(channelId: string, userId: string): Promise<void>;
  removeChannelMember(channelId: string, userId: string): Promise<void>;
  fetchTranscriptMessages(channelId: string): Promise<TranscriptMessage[]>;
  sendLogMessage(params: SendLogParams): Promise<string>;
  channelMention(channelId: string): string;
}

interface GameBoardSection {
  label: string;
  scope: string;
  options: TicketOption[];
}

interface PanelMessagePayload {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>>;
}

const GAME_ACTIVATION_ICON_URL =
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaGlsaGxqOGY5Y2d2aXV0dnJzNzdodGtzdW9taGg1cmF6cmc2NXhqcCZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/VeTIkcoBeync63rDWy/giphy.gif";
const GAME_ACTIVATION_IMAGE = "game-steam-1_744287f2722049808217c58c22a3f801.jpg";
const STEAM_ACTIVATION_TICKET_IMAGE = "sonic-1.webp";
const STEAM_ACTIVATION_DOWNLOAD_GUIDE_CHANNEL_ID = "1492126197604155487";
const STEAM_ACTIVATION_SHARE_REVIEW_CHANNEL_ID = "1492126875781431336";
const STEAM_ACTIVATION_SUPPORT_CHANNEL_ID = "1492119938788229180";
const STEAM_ACTIVATION_CHANNEL_ARROW = "<a:outputonlinegiftools:1492551407822176306>";
const DONATION_THANKS_EMOJI = "<a:giphy:1492567045592846526>";
const DONATION_QR_ATTACHMENT_NAME = "donation-qr.webp";
const QUICK_DETAIL_FALLBACK = "Not selected yet";
const MAX_SELECTS_PER_MESSAGE = 2;
const MAX_OPTIONS_PER_SELECT = 25;

function buildDefaultTicketControlContent(
  requesterId: string,
  panelName: string,
  optionLabel: string,
  claimedBy?: string,
  issueLabel?: string
): string {
  return [
    `Ticket requester: <@${requesterId}>`,
    `Panel: **${panelName}**`,
    `Type: **${optionLabel}**`,
    `Quick detail: **${issueLabel ?? QUICK_DETAIL_FALLBACK}**`,
    `Claimed by: ${claimedBy ? `<@${claimedBy}>` : "Unclaimed"}`,
    "",
    "Pick a quick issue summary from the dropdown below, then continue chatting directly in this ticket."
  ].join("\n");
}

function buildSteamActivationTicketControlContent(
  requesterId: string,
  optionLabel: string,
  claimedBy?: string
): string {
  return [
    `**${optionLabel}**`,
    `Người mở: <@${requesterId}>`,
    claimedBy ? `Staff: <@${claimedBy}>` : "Staff: đang chờ nhận ticket",
    "",
    claimedBy ? "Tiếp theo: gửi 1 ảnh giống mẫu bên dưới." : "Tiếp theo: chờ staff nhận ticket."
  ].join("\n");
}

function buildDonationTicketControlContent(
  requesterId: string,
  optionLabel: string,
  claimedBy?: string
): string {
  return [
    `**${optionLabel}**`,
    `Người mở: <@${requesterId}>`,
    claimedBy ? `Staff: <@${claimedBy}>` : "Staff: đang chờ nhận ticket",
    "",
    "Sau khi chuyển khoản xong, bấm **Tôi đã gửi** ở panel bên dưới rồi up ảnh xác nhận donate."
  ].join("\n");
}

function buildTicketIssueRow(ticketId: string, selectedIssueValue?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ComponentIds.issueSelect(ticketId))
      .setPlaceholder("Chọn mô tả nhanh")
      .addOptions(
        ticketIssueCatalog.map((issue) => ({
          label: issue.label,
          value: issue.value,
          description: issue.description,
          default: issue.value === selectedIssueValue
        }))
      )
  );
}

function buildTicketActionRow(ticketId: string, isClaimed: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.claimButton(ticketId))
      .setLabel(isClaimed ? "Đã nhận" : "Nhận ticket")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isClaimed),
    new ButtonBuilder().setCustomId(ComponentIds.closeButton(ticketId)).setLabel("Đóng").setStyle(ButtonStyle.Danger)
  );
}

function buildDonationActionRow(
  ticketId: string,
  options?: { confirmed?: boolean; approved?: boolean; linkUrl?: string | null }
): ActionRowBuilder<ButtonBuilder> {
  const confirmed = options?.confirmed ?? false;
  const approved = options?.approved ?? false;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.donationConfirmButton(ticketId))
      .setLabel(approved ? "Đã duyệt donate" : confirmed ? "Chờ duyệt" : "Tôi đã gửi")
      .setStyle(ButtonStyle.Success)
      .setDisabled(confirmed || approved)
  );

  if (options?.linkUrl) {
    row.addComponents(new ButtonBuilder().setLabel("Mở link donate").setStyle(ButtonStyle.Link).setURL(options.linkUrl));
  }

  return row;
}

function buildVerificationReadyRow(ticketId: string, activated = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.activationButton(ticketId))
      .setLabel(activated ? "Đã kích hoạt" : "Kích hoạt")
      .setStyle(ButtonStyle.Success)
      .setDisabled(activated),
    new ButtonBuilder().setCustomId(ComponentIds.closeButton(ticketId)).setLabel("Đóng").setStyle(ButtonStyle.Danger)
  );
}

function buildActivationTokenActionRow(
  ticketId: string,
  options?: { confirmed?: boolean; linkUrl?: string | null }
): ActionRowBuilder<ButtonBuilder> {
  const confirmed = options?.confirmed ?? false;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.tokenActivatedButton(ticketId))
      .setLabel(confirmed ? "Đã xác nhận" : "Hoạt động")
      .setStyle(ButtonStyle.Success)
      .setDisabled(confirmed),
    new ButtonBuilder()
      .setCustomId(ComponentIds.tokenSupportButton(ticketId))
      .setLabel("Support")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(confirmed),
    new ButtonBuilder().setCustomId(ComponentIds.closeButton(ticketId)).setLabel("Đóng").setStyle(ButtonStyle.Danger)
  );

  if (options?.linkUrl) {
    row.addComponents(
      new ButtonBuilder().setLabel("Mở link token").setStyle(ButtonStyle.Link).setURL(options.linkUrl)
    );
  }

  return row;
}

function buildVerificationReadyEmbed(activated = false): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(activated ? 0x22c55e : 0xf59e0b)
    .setTitle(activated ? "Đang chờ kích hoạt" : "Xác minh hoàn tất")
    .setDescription(
      activated
        ? "Vui lòng đợi 1 chút nhé, admin sẽ vào kích hoạt cho bạn."
        : "Ảnh đã đúng mẫu. Bấm **Kích hoạt** để chuyển sang bước tiếp theo."
    );
}

function buildDonationPromptEmbed(options: {
  donationLinkUrl?: string | null;
  donationQrImageUrl?: string | null;
  confirmed?: boolean;
  approved?: boolean;
}): EmbedBuilder {
  const confirmed = options.confirmed ?? false;
  const approved = options.approved ?? false;
  const description = approved
    ? "Donate đã được xác nhận. Cảm ơn bạn đã ủng hộ server."
    : confirmed
      ? "Bot đã ghi nhận bạn bấm xác nhận. Bây giờ hãy gửi ảnh xác nhận donate để admin duyệt."
      : [
          "Nếu muốn ủng hộ server, bạn có thể donate theo QR hoặc link bên dưới.",
          options.donationLinkUrl ? "Sau khi chuyển khoản xong, bấm **Tôi đã gửi** rồi up ảnh xác nhận vào ticket này." : "Admin chưa cấu hình link donate.",
          options.donationQrImageUrl ? "Nếu có QR, bot đã hiển thị ngay bên dưới." : "Admin chưa cấu hình ảnh QR donate."
        ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(approved ? 0x22c55e : confirmed ? 0xf59e0b : 0x5865f2)
    .setTitle(approved ? "Donate đã được duyệt" : confirmed ? "Đang chờ admin duyệt" : "Ủng hộ server")
    .setDescription(description);

  if (options.donationQrImageUrl) {
    embed.setImage(options.donationQrImageUrl);
  }

  return embed;
}

function buildDonationBoardEmbed(panelName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(panelName)
    .setDescription(
      [
        "Nếu muốn ủng hộ server, bấm nút bên dưới để mở ticket donate riêng.",
        "",
        "Trong ticket đó, bot sẽ gửi QR hoặc link donate để bạn chuyển khoản."
      ].join("\n")
    );
}

function buildDonationBoardRow(panelId: string, optionValue: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.donationPanelOpen(panelId, optionValue))
      .setLabel("Donate")
      .setStyle(ButtonStyle.Success)
  );
}

function truncateForField(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildSteamUpdateEmbed(params: SendSteamUpdateNotificationParams): EmbedBuilder {
  const gameInfoLines = [
    `App ID: \`${params.game.appId}\``,
    params.storeDetails?.developers.length ? `Developer: ${params.storeDetails.developers.slice(0, 2).join(", ")}` : null,
    params.storeDetails?.publishers.length ? `Publisher: ${params.storeDetails.publishers.slice(0, 2).join(", ")}` : null,
    params.storeDetails?.genres.length ? `Genres: ${params.storeDetails.genres.slice(0, 3).join(", ")}` : null
  ].filter((line): line is string => Boolean(line));

  const buildLabel =
    params.previousBuildId && params.currentBuildId && params.previousBuildId !== params.currentBuildId
      ? `\`${params.previousBuildId}\` → \`${params.currentBuildId}\``
      : params.currentBuildId
        ? `Current: \`${params.currentBuildId}\``
        : "Steam did not expose a public version number for this update.";

  const embed = new EmbedBuilder()
    .setColor(0xe879f9)
    .setTitle(`Steam Update • ${params.game.title}`)
    .setURL(params.news?.url ?? params.game.storeUrl)
    .setDescription(
      [
        `**Patch:** ${params.news?.title ?? "Public build changed on Steam"}`,
        "",
        truncateForField(params.patchSummary, 1200) ?? "No official patch notes were published in Steam News."
      ].join("\n")
    )
    .addFields(
      {
        name: "Game",
        value: gameInfoLines.join("\n"),
        inline: false
      },
      {
        name: params.buildIdReliable ? "Public Build" : "Public Version",
        value: buildLabel,
        inline: false
      },
      {
        name: "About Game",
        value:
          truncateForField(params.storeDetails?.shortDescription, 500) ??
          "Steam store did not return a short description for this title.",
        inline: false
      },
      {
        name: "Published",
        value: `<t:${params.detectedAt}:F>`,
        inline: false
      }
    )
    .setFooter({
      text: params.news?.feedLabel
        ? `Source: ${params.news.feedLabel}`
        : "Source: Steam official app/news data"
    });

  if (params.storeDetails?.headerImageUrl) {
    embed.setImage(params.storeDetails.headerImageUrl);
  } else if (params.game.imageUrl) {
    embed.setImage(params.game.imageUrl);
  }

  if (params.storeDetails?.capsuleImageUrl) {
    embed.setThumbnail(params.storeDetails.capsuleImageUrl);
  } else if (params.game.imageUrl) {
    embed.setThumbnail(params.game.imageUrl);
  }

  return embed;
}

function buildSteamUpdateRow(params: SendSteamUpdateNotificationParams): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(params.news ? "View Patch Notes" : "Open Store Page")
      .setStyle(ButtonStyle.Link)
      .setURL(params.news?.url ?? params.game.storeUrl),
    new ButtonBuilder().setLabel("Steam Store").setStyle(ButtonStyle.Link).setURL(params.game.storeUrl),
    new ButtonBuilder().setLabel("SteamDB History").setStyle(ButtonStyle.Link).setURL(params.game.steamDbPatchnotesUrl)
  );

  return row;
}

function buildActivationTokenEmbed(options: {
  hasAttachment: boolean;
  hasLink: boolean;
  tokenExpiresAt: Date;
  confirmed?: boolean;
  autoCloseAt?: Date;
}): EmbedBuilder {
  const expiresAt = toDiscordTimestamp(options.tokenExpiresAt);
  const autoCloseAt = options.autoCloseAt ? toDiscordTimestamp(options.autoCloseAt) : null;
  const downloadLine = options.hasAttachment
    ? options.hasLink
      ? "***TẢI TOKEN BÊN TRÊN HOẶC DÙNG NÚT LINK BÊN DƯỚI***"
      : "***TẢI TOKEN BÊN TRÊN***"
    : "***MỞ LINK TOKEN Ở NÚT BÊN DƯỚI***";

  return new EmbedBuilder()
    .setColor(options.confirmed ? 0x22c55e : 0x3b82f6)
    .setTitle(options.confirmed ? "Đã xác nhận tải token" : "File kích hoạt đã sẵn sàng")
    .setDescription(
      [
        ...(options.confirmed
          ? [
              "Vui lòng đợi 1 phút nhé, ticket sẽ tự đóng.",
              `Tự đóng <t:${autoCloseAt}:R>.`
            ]
          : [
              "***SAU KHI NHẬN ĐƯỢC FILE KÍCH HOẠT, HÃY LÀM ĐÚNG HƯỚNG DẪN ĐÃ NÊU***",
              "***LƯU Ý: tải file token kích hoạt, giải nén và dán vào thư mục game trong vòng 20p, nếu không làm token sẽ hết hạn***",
              `Hết hạn tải token <t:${expiresAt}:R>.`,
              "",
              "**NẾU CRACK HOẠT ĐỘNG, GỬI ẢNH VÀO**",
              `${STEAM_ACTIVATION_CHANNEL_ARROW} <#${STEAM_ACTIVATION_SHARE_REVIEW_CHANNEL_ID}> (#📸┇𝑺𝑯𝑨𝑹𝑬-𝑹𝑬𝑽𝑰𝑬𝑾)`,
              "",
              "**NẾU LỖI, HÃY GỬI ẢNH VÀO**",
              `${STEAM_ACTIVATION_CHANNEL_ARROW} <#${STEAM_ACTIVATION_SUPPORT_CHANNEL_ID}> (#⚠┇𝑺𝑼𝑷𝑷𝑶𝑹𝑻-𝑵𝑯𝑨𝑼)`,
              "",
              downloadLine
            ])
      ].join("\n")
    );
}

function formatStockDescription(option: TicketOption): string {
  if (option.stockRemaining === null || option.stockTotal === null) {
    if (option.stockRemaining !== null) {
      return `${option.stockRemaining} remaining`;
    }

    return "Open a ticket for this game";
  }

  if (option.stockTotal === 0) {
    return "0 of 0 remaining (0%)";
  }

  const percentage = Math.round((option.stockRemaining / option.stockTotal) * 100);
  return `${option.stockRemaining} of ${option.stockTotal} remaining (${percentage}%)`;
}

function buildGameBoardSections(panel: TicketPanelWithOptions): GameBoardSection[] {
  const activeOptions = panel.options
    .filter((option) => option.active)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
  const grouped = new Map<string, TicketOption[]>();

  for (const option of activeOptions) {
    const groupLabel = option.boardSection?.trim() || "Game Requests";
    const current = grouped.get(groupLabel) ?? [];
    current.push(option);
    grouped.set(groupLabel, current);
  }

  const sections: GameBoardSection[] = [];
  for (const [label, options] of grouped.entries()) {
    const chunkCount = Math.ceil(options.length / MAX_OPTIONS_PER_SELECT);

    for (let index = 0; index < chunkCount; index += 1) {
      sections.push({
        label: chunkCount > 1 ? `${label} (${index + 1}/${chunkCount})` : label,
        scope: `${slugifyTicketName(label) || "games"}${chunkCount > 1 ? `-${index + 1}` : ""}`,
        options: options.slice(index * MAX_OPTIONS_PER_SELECT, (index + 1) * MAX_OPTIONS_PER_SELECT)
      });
    }
  }

  return sections;
}

function rowContainsCustomId(row: unknown, customId: string): boolean {
  if (!row || typeof row !== "object" || !("components" in row)) {
    return false;
  }

  const components = (row as { components?: Array<{ customId?: string | null }> }).components;
  return Array.isArray(components) && components.some((component) => component.customId === customId);
}

function readIssueLabelFromContent(content: string): string | null {
  const match = content.match(/^Quick detail: \*\*(.+)\*\*$/m);
  if (!match) {
    return null;
  }

  return match[1] === QUICK_DETAIL_FALLBACK ? null : match[1];
}

function readClaimedByFromContent(content: string): string | null {
  const match = content.match(/^Staff: <@(\d+)>$/m);
  return match?.[1] ?? null;
}

function buildPanelResetRow(panelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.panelReset(panelId))
      .setLabel("Reset")
      .setStyle(ButtonStyle.Secondary)
  );
}

function toDiscordTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function buildCountdownLines(
  businessHours?: BusinessHoursService
): string[] {
  if (!businessHours) {
    return [];
  }

  const countdown = businessHours.getCountdown();
  if (countdown.isOpen && countdown.closesAt) {
    const closeAt = toDiscordTimestamp(countdown.closesAt);
    return [
      "**Countdown**",
      `- Ticket window closes <t:${closeAt}:R>`,
      `- Closing time: <t:${closeAt}:t> (${countdown.timezone})`
    ];
  }

  const nextOpenAt = toDiscordTimestamp(countdown.nextOpenAt);
  return [
    "**Countdown**",
    `- Ticket window opens <t:${nextOpenAt}:R>`,
    `- Opening time: <t:${nextOpenAt}:t> (${countdown.timezone})`
  ];
}

function isSteamActivationTicket(panelName: string, panelTemplate: PanelTemplate): boolean {
  return panelTemplate === "game-activation" && panelName.trim().toUpperCase().includes("STEAM ACTIVATION");
}

function isDonationTicket(panelTemplate: PanelTemplate): boolean {
  return panelTemplate === "donation";
}

function buildSteamActivationTicketEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Ảnh mẫu cần gửi")
    .setDescription(
      [
        "Trước khi gửi ảnh:",
        "",
        "• chạy game bằng file `.exe`, không mở từ Steam",
        "• giữ Windows Update ở trạng thái tắt",
        "• không update game",
        "• mod hoặc việt hóa có DLL thì tự chịu trách nhiệm",
        `• nếu chưa có clean game, tải tại <#${STEAM_ACTIVATION_DOWNLOAD_GUIDE_CHANNEL_ID}>`,
        "",
        "Ảnh cần thấy rõ:",
        "• cửa sổ Windows Update Blocker có dấu X đỏ",
        "• cửa sổ Properties của thư mục game trong `SteamLibrary/steamapps/common`"
      ].join("\n")
    )
    .setImage(`attachment://${STEAM_ACTIVATION_TICKET_IMAGE}`);
}

export class DiscordJsTicketGateway implements DiscordTicketGateway {
  public constructor(
    private readonly client: Client,
    private readonly businessHours?: BusinessHoursService
  ) {}

  public async sendPanelMessage(panel: TicketPanelWithOptions): Promise<string[]> {
    const channel = await this.getTextChannel(panel.channelId);
    const payloads = this.buildPanelMessages(panel);
    const existingMessages: Message[] = [];

    for (const messageId of panel.messageIds) {
      try {
        existingMessages.push(await channel.messages.fetch(messageId));
      } catch {
        // Ignore stale panel message ids and recreate them below.
      }
    }

    const finalIds: string[] = [];
    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      const existingMessage = existingMessages[index];
      if (existingMessage) {
        await existingMessage.edit(payload);
        finalIds.push(existingMessage.id);
      } else {
        const createdMessage = await channel.send(payload);
        finalIds.push(createdMessage.id);
      }
    }

    for (const staleMessage of existingMessages.slice(payloads.length)) {
      await staleMessage.delete().catch(() => undefined);
    }

    return finalIds;
  }

  public async createTicketChannel(params: CreateTicketChannelParams): Promise<CreateTicketChannelResult> {
    const guild = await this.client.guilds.fetch(params.guildId);
    const channel = await guild.channels.create({
      name: params.channelName,
      type: ChannelType.GuildText,
      parent: params.targetCategoryId,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: params.requesterId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: params.staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        },
        {
          id: this.client.user!.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

    return {
      channelId: channel.id,
      channelName: channel.name
    };
  }

  public async sendTicketIntro(params: SendTicketIntroParams): Promise<string> {
    const channel = await this.getTextChannel(params.channelId);
    const embeds: EmbedBuilder[] = [];
    const files: AttachmentBuilder[] = [];
    const isSteamActivation = isSteamActivationTicket(params.panelName, params.panelTemplate);
    const isDonation = isDonationTicket(params.panelTemplate);

    if (isSteamActivation) {
      embeds.push(buildSteamActivationTicketEmbed());
      files.push(
        new AttachmentBuilder(join(process.cwd(), STEAM_ACTIVATION_TICKET_IMAGE), {
          name: STEAM_ACTIVATION_TICKET_IMAGE
        })
      );
    }

    const message = await channel.send({
      content: isSteamActivation
        ? buildSteamActivationTicketControlContent(params.requesterId, params.optionLabel)
        : isDonation
          ? buildDonationTicketControlContent(params.requesterId, params.optionLabel)
          : buildDefaultTicketControlContent(params.requesterId, params.panelName, params.optionLabel),
      embeds,
      files,
      components: isSteamActivation
        ? [buildTicketActionRow(params.ticketId, false)]
        : isDonation
          ? [buildTicketActionRow(params.ticketId, false)]
        : [buildTicketIssueRow(params.ticketId), buildTicketActionRow(params.ticketId, false)]
    });

    return message.id;
  }

  public async updateTicketClaimState(channelId: string, ticketId: string, claimedBy: string): Promise<void> {
    const target = await this.findTicketControlMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    const currentIssueLabel = readIssueLabelFromContent(target.content) ?? undefined;
    const selectedIssueValue = ticketIssueCatalog.find((issue) => issue.label === currentIssueLabel)?.value;
    const hasIssueRow = target.components.some((row) => rowContainsCustomId(row, ComponentIds.issueSelect(ticketId)));

    await target.edit({
      content: hasIssueRow
        ? this.replaceContentLine(target.content, /^Claimed by: .*$/m, `Claimed by: <@${claimedBy}>`)
        : this.replaceContentLine(
            this.replaceContentLine(target.content, /^Staff: .*$/m, `Staff: <@${claimedBy}>`),
            /^Tiếp theo: .*$/m,
            "Tiếp theo: gửi 1 ảnh giống mẫu bên dưới."
          ),
      embeds: target.embeds.map((embed) => EmbedBuilder.from(embed)),
      components: hasIssueRow
        ? [buildTicketIssueRow(ticketId, selectedIssueValue), buildTicketActionRow(ticketId, true)]
        : [buildTicketActionRow(ticketId, true)]
    });
  }

  public async updateTicketIssueState(channelId: string, ticketId: string, issueValue: string, issueLabel: string): Promise<void> {
    const target = await this.findTicketControlMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    const hasIssueRow = target.components.some((row) => rowContainsCustomId(row, ComponentIds.issueSelect(ticketId)));
    if (!hasIssueRow) {
      return;
    }

    await target.edit({
      content: this.replaceContentLine(target.content, /^Quick detail: \*\*.*\*\*$/m, `Quick detail: **${issueLabel}**`),
      embeds: target.embeds.map((embed) => EmbedBuilder.from(embed)),
      components: [buildTicketIssueRow(ticketId, issueValue), buildTicketActionRow(ticketId, Boolean(readClaimedByFromContent(target.content)))]
    });
  }

  public async sendChannelMessage(channelId: string, content: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.send({ content });
  }

  public async sendDonationPrompt(params: SendDonationPromptParams): Promise<void> {
    const channel = await this.getTextChannel(params.channelId);
    const { embed, files } = await this.buildDonationPromptMessage(params);

    await channel.send({
      embeds: [embed],
      files,
      components: [
        buildDonationActionRow(params.ticketId, {
          linkUrl: params.donationLinkUrl
        })
      ]
    });
  }

  public async sendSteamUpdateNotification(params: SendSteamUpdateNotificationParams): Promise<void> {
    const channel = await this.getTextChannel(params.channelId);
    const embed = buildSteamUpdateEmbed(params);

    await channel.send({
      embeds: [embed],
      components: [buildSteamUpdateRow(params)]
    });
  }

  public async markDonationIntentState(channelId: string, ticketId: string): Promise<void> {
    const target = await this.findDonationPromptMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    const linkUrl = this.readLinkButtonUrl(target);
    const imageUrl = target.embeds[0]?.image?.url ?? null;

    await target.edit({
      embeds: [
        buildDonationPromptEmbed({
          donationLinkUrl: linkUrl,
          donationQrImageUrl: imageUrl,
          confirmed: true
        })
      ],
      components: [buildDonationActionRow(ticketId, { confirmed: true, linkUrl })]
    });
  }

  public async markDonationApprovedState(channelId: string, ticketId: string, approvedBy: string): Promise<void> {
    const target = await this.findDonationPromptMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    const linkUrl = this.readLinkButtonUrl(target);
    const imageUrl = target.embeds[0]?.image?.url ?? null;

    await target.edit({
      embeds: [
        buildDonationPromptEmbed({
          donationLinkUrl: linkUrl,
          donationQrImageUrl: imageUrl,
          confirmed: true,
          approved: true
        }).setFooter({ text: `Đã duyệt bởi ${approvedBy}` })
      ],
      components: [buildDonationActionRow(ticketId, { confirmed: true, approved: true, linkUrl })]
    });
  }

  public async sendDonationThanks(params: SendDonationThanksParams): Promise<string> {
    const channel = await this.getTextChannel(params.thanksChannelId);
    const guild = await this.client.guilds.fetch(params.guildId);
    const member = await guild.members.fetch(params.userId).catch(() => null);
    const user = member?.user ?? (await this.client.users.fetch(params.userId).catch(() => null));
    const displayName = member?.displayName ?? user?.username ?? "Donator";
    const avatarUrl = member?.displayAvatarURL() ?? user?.displayAvatarURL() ?? null;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`Cảm ơn ${displayName} ${DONATION_THANKS_EMOJI}`)
      .setDescription("Cảm ơn bạn đã ủng hộ server. Sự ủng hộ của bạn giúp server duy trì và cập nhật tốt hơn.")
      .setThumbnail(avatarUrl);

    const message = await channel.send({
      content: `<@${params.userId}>`,
      embeds: [embed]
    });

    return message.id;
  }

  public async addGuildMemberRole(guildId: string, userId: string, roleId: string, reason = "Role granted by bot"): Promise<void> {
    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId, reason);
  }

  public async sendVerificationReadyPrompt(channelId: string, ticketId: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.send({
      embeds: [buildVerificationReadyEmbed(false)],
      components: [buildVerificationReadyRow(ticketId)]
    });
  }

  public async markVerificationReadyState(channelId: string, ticketId: string, _activatedBy: string): Promise<void> {
    const target = await this.findVerificationReadyMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    await target.edit({
      content: null,
      embeds: [buildVerificationReadyEmbed(true)],
      components: [buildVerificationReadyRow(ticketId, true)]
    });
  }

  public async sendActivationTokenPanel(params: SendActivationTokenPanelParams): Promise<void> {
    const channel = await this.getTextChannel(params.channelId);
    const files: AttachmentBuilder[] = [];

    if (params.fileUrl && params.fileName) {
      const response = await fetch(params.fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download activation token file: ${response.status}`);
      }

      files.push(
        new AttachmentBuilder(Buffer.from(await response.arrayBuffer()), {
          name: params.fileName
        })
      );
    }

    await channel.send({
      embeds: [
        buildActivationTokenEmbed({
          hasAttachment: files.length > 0,
          hasLink: Boolean(params.linkUrl),
          tokenExpiresAt: params.tokenExpiresAt
        })
      ],
      files,
      components: [buildActivationTokenActionRow(params.ticketId, { linkUrl: params.linkUrl })]
    });
  }

  public async markActivationTokenConfirmed(
    channelId: string,
    ticketId: string,
    _activatedBy: string,
    autoCloseAt: Date
  ): Promise<void> {
    const target = await this.findActivationTokenMessage(channelId, ticketId);
    if (!target) {
      return;
    }

    const hasAttachment = target.attachments.size > 0;
    const linkUrl = this.readLinkButtonUrl(target);

    await target.edit({
      embeds: [
        buildActivationTokenEmbed({
          hasAttachment,
          hasLink: Boolean(linkUrl),
          tokenExpiresAt: autoCloseAt,
          confirmed: true,
          autoCloseAt
        })
      ],
      components: [buildActivationTokenActionRow(ticketId, { confirmed: true, linkUrl })]
    });
  }

  public async deleteChannel(channelId: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.delete("Ticket closed");
  }

  public async addChannelMember(channelId: string, userId: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });
  }

  public async removeChannelMember(channelId: string, userId: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.permissionOverwrites.delete(userId);
  }

  public async fetchTranscriptMessages(channelId: string): Promise<TranscriptMessage[]> {
    const channel = await this.getTextChannel(channelId);
    const allMessages: Message[] = [];
    let before: string | undefined;

    for (;;) {
      const batch = await channel.messages.fetch({
        limit: 100,
        before
      });

      if (batch.size === 0) {
        break;
      }

      allMessages.push(...batch.values());
      before = batch.last()?.id;
    }

    return allMessages
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map((message) => ({
        id: message.id,
        authorId: message.author.id,
        authorTag: message.author.tag,
        avatarUrl: message.author.displayAvatarURL(),
        content: message.content,
        createdAt: message.createdAt,
        attachments: [...message.attachments.values()].map((attachment) => ({
          name: attachment.name ?? attachment.url.split("/").pop() ?? "attachment",
          url: attachment.url
        }))
      }));
  }

  public async sendLogMessage(params: SendLogParams): Promise<string> {
    const channel = await this.getTextChannel(params.logChannelId);
    const file = new AttachmentBuilder(Buffer.from(params.transcriptHtml, "utf8"), {
      name: params.transcriptFileName
    });

    const message = await channel.send({
      content: params.content,
      files: [file]
    });

    return message.id;
  }

  public channelMention(channelId: string): string {
    return `<#${channelId}>`;
  }

  private async getTextChannel(channelId: string): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(`Channel ${channelId} is not a text channel.`);
    }

    return channel;
  }

  private async findTicketControlMessage(channelId: string, ticketId: string): Promise<Message | null> {
    const channel = await this.getTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });

    return (
      messages.find((message) =>
        message.components.some(
          (row) =>
            rowContainsCustomId(row, ComponentIds.claimButton(ticketId)) ||
            rowContainsCustomId(row, ComponentIds.issueSelect(ticketId))
        )
      ) ?? null
    );
  }

  private async findVerificationReadyMessage(channelId: string, ticketId: string): Promise<Message | null> {
    const channel = await this.getTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });

    return (
      messages.find((message) =>
        message.components.some((row) => rowContainsCustomId(row, ComponentIds.activationButton(ticketId)))
      ) ?? null
    );
  }

  private async findActivationTokenMessage(channelId: string, ticketId: string): Promise<Message | null> {
    const channel = await this.getTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });

    return (
      messages.find((message) =>
        message.components.some(
          (row) =>
            rowContainsCustomId(row, ComponentIds.tokenActivatedButton(ticketId)) ||
            rowContainsCustomId(row, ComponentIds.tokenSupportButton(ticketId))
        )
      ) ?? null
    );
  }

  private async findDonationPromptMessage(channelId: string, ticketId: string): Promise<Message | null> {
    const channel = await this.getTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });

    return (
      messages.find((message) =>
        message.components.some((row) => rowContainsCustomId(row, ComponentIds.donationConfirmButton(ticketId)))
      ) ?? null
    );
  }

  private readLinkButtonUrl(message: Message): string | null {
    for (const row of message.components) {
      if (!("components" in row) || !Array.isArray(row.components)) {
        continue;
      }
      for (const component of row.components) {
        if ("url" in component && typeof component.url === "string" && component.url.length > 0) {
          return component.url;
        }
      }
    }

    return null;
  }

  private replaceContentLine(content: string, pattern: RegExp, replacement: string): string {
    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }

    return `${content}\n${replacement}`;
  }

  private buildPanelMessages(panel: TicketPanelWithOptions): PanelMessagePayload[] {
    const activeOptions = panel.options.filter((option) => option.active);
    if (activeOptions.length === 0) {
      throw new Error("Panel has no active options.");
    }

    if (panel.template === "donation") {
      const option = activeOptions[0];
      return [
        {
          embeds: [buildDonationBoardEmbed(panel.name)],
          components: [buildDonationBoardRow(panel.id, option.value)]
        }
      ];
    }

    if (panel.template !== "game-activation") {
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ComponentIds.panelSelect(panel.id))
          .setPlaceholder(panel.placeholder)
          .addOptions(
            activeOptions.map((option) => ({
              label: option.label,
              value: option.value,
              emoji: option.emoji ?? undefined,
              description: `Route to <@&${option.staffRoleId}>`
            }))
          )
      );

      return [
        {
          content: `**${panel.name}**\nSelect the ticket type you need from the dropdown below.`,
          components: [row, buildPanelResetRow(panel.id)]
        }
      ];
    }

    const hero = new AttachmentBuilder(join(process.cwd(), "src/assets", GAME_ACTIVATION_IMAGE), {
      name: GAME_ACTIVATION_IMAGE
    });
    const sections = buildGameBoardSections(panel);
    const embed = new EmbedBuilder()
      .setColor(0x1b2838)
      .setAuthor({
        name: panel.name,
        iconURL: GAME_ACTIVATION_ICON_URL
      })
      .setTitle("Steam Activation Request Board")
      .setDescription(
        [
          "Panels open only when your access role is valid and the daily window is open.",
          "",
          "**Before You Start**",
          "• Pick the exact game from the correct menu below.",
          "• Check the visible stock line before opening a ticket.",
          "• When staff claim your ticket, send the verification screenshot exactly like the sample in the ticket.",
          "",
          "**How To Request**",
          "• Select your game from one of the dropdown menus below.",
          "• The bot creates a private ticket in the mapped staff route.",
          "• Wait for staff to claim, then upload your verification screenshot inside that ticket."
        ].join("\n")
      )
      .setImage(`attachment://${GAME_ACTIVATION_IMAGE}`)
      .setFooter({
        text: "0xoKITSU Ticket Support"
      });

    const countdownLines = buildCountdownLines(this.businessHours);
    if (countdownLines.length > 0) {
      embed.addFields({
        name: countdownLines[0],
        value: countdownLines.slice(1).join("\n")
      });
    }

    const rows = sections.map((section) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ComponentIds.panelSelect(panel.id, section.scope))
          .setPlaceholder(section.label)
          .addOptions(
            section.options.map((option) => ({
              label: option.label,
              value: option.value,
              emoji: option.emoji ?? undefined,
              description: formatStockDescription(option)
            }))
          )
      )
    );

    const payloads: PanelMessagePayload[] = [];
    for (let index = 0; index < rows.length; index += MAX_SELECTS_PER_MESSAGE) {
      const slice = rows.slice(index, index + MAX_SELECTS_PER_MESSAGE);
      if (index === 0) {
        payloads.push({
          embeds: [embed],
          files: [hero],
          components: [...slice, buildPanelResetRow(panel.id)]
        });
      } else {
        payloads.push({
          content: `**${panel.name}** continued`,
          components: [...slice, buildPanelResetRow(panel.id)]
        });
      }
    }

    return payloads;
  }

  private async buildDonationPromptMessage(params: SendDonationPromptParams): Promise<{
    embed: EmbedBuilder;
    files: AttachmentBuilder[];
  }> {
    const files: AttachmentBuilder[] = [];
    let imageUrl = params.donationQrImageUrl ?? null;

    if (params.donationQrImageUrl) {
      try {
        const response = await fetch(params.donationQrImageUrl);
        if (response.ok) {
          files.push(
            new AttachmentBuilder(Buffer.from(await response.arrayBuffer()), {
              name: DONATION_QR_ATTACHMENT_NAME
            })
          );
          imageUrl = `attachment://${DONATION_QR_ATTACHMENT_NAME}`;
        } else {
          console.warn(`Failed to download donation QR image: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.warn(`Failed to fetch donation QR image from ${params.donationQrImageUrl}. Falling back to direct URL.`, error);
      }
    }

    return {
      embed: buildDonationPromptEmbed({
        donationLinkUrl: params.donationLinkUrl,
        donationQrImageUrl: imageUrl
      }),
      files
    };
  }
}
