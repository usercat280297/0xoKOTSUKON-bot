import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextChannel
} from "discord.js";
import { join } from "node:path";
import type { TicketPanelWithOptions, TranscriptMessage } from "../domain/types";
import { ComponentIds } from "../utils/componentIds";

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
  optionLabel: string;
}

export interface SendLogParams {
  logChannelId: string;
  content: string;
  transcriptHtml: string;
  transcriptFileName: string;
}

export interface DiscordTicketGateway {
  sendPanelMessage(panel: TicketPanelWithOptions): Promise<string>;
  createTicketChannel(params: CreateTicketChannelParams): Promise<CreateTicketChannelResult>;
  sendTicketIntro(params: SendTicketIntroParams): Promise<string>;
  updateTicketClaimState(channelId: string, ticketId: string, claimedBy: string): Promise<void>;
  moveChannel(channelId: string, categoryId: string | null): Promise<void>;
  setRequesterSendPermission(channelId: string, requesterId: string, allowSend: boolean): Promise<void>;
  addChannelMember(channelId: string, userId: string): Promise<void>;
  removeChannelMember(channelId: string, userId: string): Promise<void>;
  fetchTranscriptMessages(channelId: string): Promise<TranscriptMessage[]>;
  sendLogMessage(params: SendLogParams): Promise<string>;
  channelMention(channelId: string): string;
}

const GAME_ACTIVATION_ICON_URL =
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaGlsaGxqOGY5Y2d2aXV0dnJzNzdodGtzdW9taGg1cmF6cmc2NXhqcCZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/VeTIkcoBeync63rDWy/giphy.gif";
const GAME_ACTIVATION_IMAGE = "game-steam-1_744287f2722049808217c58c22a3f801.jpg";

function buildTicketControlContent(requesterId: string, panelName: string, optionLabel: string, claimedBy?: string): string {
  return [
    `Ticket requester: <@${requesterId}>`,
    `Panel: **${panelName}**`,
    `Type: **${optionLabel}**`,
    `Claimed by: ${claimedBy ? `<@${claimedBy}>` : "Unclaimed"}`
  ].join("\n");
}

function buildTicketActionRow(ticketId: string, isClaimed: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ComponentIds.claimButton(ticketId))
      .setLabel(isClaimed ? "Claimed" : "Claim")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isClaimed),
    new ButtonBuilder().setCustomId(ComponentIds.closeButton(ticketId)).setLabel("Close").setStyle(ButtonStyle.Danger)
  );
}

function rowContainsCustomId(row: unknown, customId: string): boolean {
  if (!row || typeof row !== "object" || !("components" in row)) {
    return false;
  }

  const components = (row as { components?: Array<{ customId?: string | null }> }).components;
  return Array.isArray(components) && components.some((component) => component.customId === customId);
}

export class DiscordJsTicketGateway implements DiscordTicketGateway {
  public constructor(private readonly client: Client) {}

  public async sendPanelMessage(panel: TicketPanelWithOptions): Promise<string> {
    const channel = await this.getTextChannel(panel.channelId);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(ComponentIds.panelSelect(panel.id))
      .setPlaceholder(panel.placeholder)
      .addOptions(
        panel.options
          .filter((option) => option.active)
          .map((option) => ({
            label: option.label,
            value: option.value,
            emoji: option.emoji ?? undefined,
            description: `Route to <@&${option.staffRoleId}>`
          }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    const payload = this.buildPanelMessage(panel, row);
    const message = await channel.send(payload);

    return message.id;
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
    const message = await channel.send({
      content: buildTicketControlContent(params.requesterId, params.panelName, params.optionLabel),
      components: [buildTicketActionRow(params.ticketId, false)]
    });

    return message.id;
  }

  public async updateTicketClaimState(channelId: string, ticketId: string, claimedBy: string): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 50 });
    const target = messages.find((message) => message.components.some((row) => rowContainsCustomId(row, ComponentIds.claimButton(ticketId))));

    if (!target) {
      return;
    }

    const content = target.content.match(/^.*Claimed by: .*$/m)
      ? target.content.replace(/^Claimed by: .*$/m, `Claimed by: <@${claimedBy}>`)
      : `${target.content}\nClaimed by: <@${claimedBy}>`;

    await target.edit({
      content,
      components: [buildTicketActionRow(ticketId, true)]
    });
  }

  public async moveChannel(channelId: string, categoryId: string | null): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.setParent(categoryId);
  }

  public async setRequesterSendPermission(channelId: string, requesterId: string, allowSend: boolean): Promise<void> {
    const channel = await this.getTextChannel(channelId);
    await channel.permissionOverwrites.edit(requesterId, {
      SendMessages: allowSend,
      ViewChannel: true,
      ReadMessageHistory: true
    });
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

  private buildPanelMessage(
    panel: TicketPanelWithOptions,
    row: ActionRowBuilder<StringSelectMenuBuilder>
  ): {
    content?: string;
    embeds?: EmbedBuilder[];
    files?: AttachmentBuilder[];
    components: [ActionRowBuilder<StringSelectMenuBuilder>];
  } {
    if (panel.template === "game-activation") {
      const hero = new AttachmentBuilder(join(process.cwd(), "src/assets", GAME_ACTIVATION_IMAGE), {
        name: GAME_ACTIVATION_IMAGE
      });
      const embed = new EmbedBuilder()
        .setColor(0x1b2838)
        .setAuthor({
          name: panel.name,
          iconURL: GAME_ACTIVATION_ICON_URL
        })
        .setTitle("Kích Hoạt Trò Chơi")
        .setDescription(
          [
            "Chọn đúng danh mục ở menu bên dưới để mở ticket kích hoạt game.",
            "Bot sẽ kiểm tra role của bạn trước khi tạo kênh riêng cho đúng đội hỗ trợ.",
            "Nếu chưa đủ role, bạn sẽ nhận hướng dẫn riêng để quay lại mở ticket sau."
          ].join("\n\n")
        )
        .setImage(`attachment://${GAME_ACTIVATION_IMAGE}`)
        .setFooter({
          text: "0xoKITSU Ticket Support"
        });

      return {
        embeds: [embed],
        files: [hero],
        components: [row]
      };
    }

    return {
      content: `**${panel.name}**\nSelect the ticket type you need from the dropdown below.`,
      components: [row]
    };
  }
}
