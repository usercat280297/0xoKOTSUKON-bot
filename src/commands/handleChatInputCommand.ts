import { ChannelType, ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from "discord.js";
import type { GuildConfigRepository } from "../repositories/interfaces";
import { PanelService } from "../services/panelService";
import { TicketService } from "../services/ticketService";
import { extractRoleIds, replyEphemeral } from "../utils/interactions";

export interface CommandDependencies {
  guildConfigs: GuildConfigRepository;
  panels: PanelService;
  tickets: TicketService;
}

export async function handleChatInputCommand(
  interaction: ChatInputCommandInteraction,
  dependencies: CommandDependencies
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await replyEphemeral(interaction, "This bot only works inside a guild.");
    return;
  }

  switch (interaction.commandName) {
    case "panel":
      await handlePanelCommand(interaction, dependencies.panels);
      return;
    case "config":
      await handleConfigCommand(interaction, dependencies.guildConfigs);
      return;
    case "ticket":
      await handleTicketCommand(interaction, dependencies.tickets);
      return;
    default:
      await replyEphemeral(interaction, "Unknown command.");
  }
}

async function handlePanelCommand(interaction: ChatInputCommandInteraction, panels: PanelService): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  try {
    switch (subcommand) {
      case "create": {
        const name = interaction.options.getString("name", true);
        const channel = interaction.options.getChannel("channel", true);
        const placeholder = interaction.options.getString("placeholder", true);
        const template = interaction.options.getString("template") as "default" | "game-activation" | null;
        if (channel.type !== ChannelType.GuildText) {
          throw new Error("Panel channel must be a text channel.");
        }

        const panel = await panels.createPanel({
          guildId: interaction.guildId!,
          name,
          channelId: channel.id,
          placeholder,
          template: template ?? "default"
        });
        await replyEphemeral(interaction, `Panel created.\nID: \`${panel.id}\``);
        return;
      }
      case "add-option": {
        const targetCategory = interaction.options.getChannel("target-category", true);
        const redirectChannel = interaction.options.getChannel("redirect-channel", true);
        if (targetCategory.type !== ChannelType.GuildCategory) {
          throw new Error("Target category must be a category channel.");
        }
        if (redirectChannel.type !== ChannelType.GuildText) {
          throw new Error("Redirect channel must be a text channel.");
        }

        const option = await panels.addOption({
          panelId: interaction.options.getString("panel-id", true),
          value: interaction.options.getString("value", true),
          label: interaction.options.getString("label", true),
          emoji: interaction.options.getString("emoji"),
          requiredRoleId: interaction.options.getRole("required-role", true).id,
          redirectChannelId: redirectChannel.id,
          targetCategoryId: targetCategory.id,
          staffRoleId: interaction.options.getRole("staff-role", true).id
        });

        await replyEphemeral(interaction, `Panel option added.\nOption ID: \`${option.id}\``);
        return;
      }
      case "publish": {
        const panel = await panels.publishPanel(interaction.options.getString("panel-id", true));
        await replyEphemeral(
          interaction,
          `Panel published in <#${panel.channelId}>.\nMessage ID: \`${panel.messageId}\``
        );
        return;
      }
      case "list": {
        const content = await panels.renderPanelList(interaction.guildId!);
        await replyEphemeral(interaction, content);
        return;
      }
      case "disable": {
        const disabled = await panels.disablePanel(interaction.options.getString("panel-id", true));
        await replyEphemeral(interaction, disabled ? "Panel disabled." : "Panel not found.");
        return;
      }
      default:
        await replyEphemeral(interaction, "Unsupported panel subcommand.");
    }
  } catch (error) {
    await replyEphemeral(interaction, error instanceof Error ? error.message : "Failed to execute panel command.");
  }
}

async function handleConfigCommand(
  interaction: ChatInputCommandInteraction,
  guildConfigs: GuildConfigRepository
): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "set-log-channel": {
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) {
        await replyEphemeral(interaction, "Log channel must be a text channel.");
        return;
      }

      await guildConfigs.upsert(interaction.guildId!, {
        logChannelId: channel.id
      });
      await replyEphemeral(interaction, `Log channel set to <#${channel.id}>.`);
      return;
    }
    case "set-closed-category": {
      await replyEphemeral(
        interaction,
        "Bot hiện đang được cấu hình theo kiểu đóng ticket là xóa hẳn kênh, nên closed category không còn được dùng nữa."
      );
      return;
    }
    default:
      await replyEphemeral(interaction, "Unsupported config subcommand.");
  }
}

async function handleTicketCommand(interaction: ChatInputCommandInteraction, tickets: TicketService): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const actor = {
    actorId: interaction.user.id,
    actorRoleIds: extractRoleIds(member),
    hasManageChannels: interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false
  };

  switch (subcommand) {
    case "claim": {
      const result = await tickets.claimByChannelId(interaction.channelId, actor);
      await replyEphemeral(interaction, result.message);
      return;
    }
    case "close": {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      const result = await tickets.closeByChannelId(interaction.channelId, actor);
      await replyEphemeral(interaction, result.message);
      return;
    }
    case "reopen": {
      const result = await tickets.reopenByChannelId(interaction.channelId, actor);
      await replyEphemeral(interaction, result.message);
      return;
    }
    case "add-member": {
      const memberToAdd = interaction.options.getUser("member", true);
      const result = await tickets.addMember(interaction.channelId, memberToAdd.id, actor);
      await replyEphemeral(interaction, result.message);
      return;
    }
    case "remove-member": {
      const memberToRemove = interaction.options.getUser("member", true);
      const result = await tickets.removeMember(interaction.channelId, memberToRemove.id, actor);
      await replyEphemeral(interaction, result.message);
      return;
    }
    default:
      await replyEphemeral(interaction, "Unsupported ticket subcommand.");
  }
}
