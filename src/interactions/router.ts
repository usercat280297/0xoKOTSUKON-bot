import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { PanelService } from "../services/panelService";
import { TicketService } from "../services/ticketService";
import {
  ComponentIds,
  parseDonationPanelButtonId,
  parseDonationTicketButton,
  parsePanelResetId,
  parsePanelSelectId,
  parseSelfRoleButtonId,
  parseTicketButton,
  parseTicketIssueSelectId,
  parseTokenButton,
  parseTokenSupportModalId
} from "../utils/componentIds";
import { extractDisplayName, extractRoleIds, replyEphemeral } from "../utils/interactions";
import { SelfRoleService } from "../services/selfRoleService";

export interface InteractionDependencies {
  panels: PanelService;
  tickets: TicketService;
  selfRoles: SelfRoleService;
}

export async function handleStringSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
  dependencies: InteractionDependencies
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await replyEphemeral(interaction, "This interaction only works inside a guild.");
    return;
  }

  const panelId = parsePanelSelectId(interaction.customId);
  if (panelId) {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const result = await dependencies.tickets.createFromSelection({
      guildId: interaction.guildId,
      panelId,
      optionValue: interaction.values[0],
      userId: interaction.user.id,
      memberRoleIds: extractRoleIds(member),
      displayName: extractDisplayName(member, interaction.user.username)
    });

    await replyEphemeral(interaction, result.message);
    await dependencies.panels.publishPanel(panelId).catch((error) => {
      console.error(`Failed to auto-refresh panel ${panelId} after selection.`, error);
    });
    return;
  }

  const ticketId = parseTicketIssueSelectId(interaction.customId);
  if (!ticketId) {
    return;
  }

  const result = await dependencies.tickets.selectIssueByTicketId(ticketId, interaction.values[0], interaction.user.id);
  await replyEphemeral(interaction, result.message);
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  dependencies: InteractionDependencies
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, "This interaction only works inside a guild.");
    return;
  }

  const panelId = parsePanelResetId(interaction.customId);
  if (panelId) {
    await interaction.deferUpdate();
    await dependencies.panels.publishPanel(panelId);
    return;
  }

  const donationPanelButton = parseDonationPanelButtonId(interaction.customId);
  if (donationPanelButton) {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const result = await dependencies.tickets.createFromSelection({
      guildId: interaction.guildId!,
      panelId: donationPanelButton.panelId,
      optionValue: donationPanelButton.optionValue,
      userId: interaction.user.id,
      memberRoleIds: extractRoleIds(member),
      displayName: extractDisplayName(member, interaction.user.username)
    });

    await replyEphemeral(interaction, result.message);
    await dependencies.panels.publishPanel(donationPanelButton.panelId).catch((error) => {
      console.error(`Failed to auto-refresh donate panel ${donationPanelButton.panelId} after click.`, error);
    });
    return;
  }

  const selfRoleButton = parseSelfRoleButtonId(interaction.customId);
  if (selfRoleButton) {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const result = await dependencies.selfRoles.claimRole({
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      memberRoleIds: extractRoleIds(member),
      roleId: selfRoleButton.roleId
    });

    await replyEphemeral(interaction, result.message);
    return;
  }

  const donationTicketButton = parseDonationTicketButton(interaction.customId);
  if (donationTicketButton) {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const actor = {
      actorId: interaction.user.id,
      actorRoleIds: extractRoleIds(member),
      hasManageChannels: interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false
    };
    const result = await dependencies.tickets.confirmDonationIntentByTicketId(donationTicketButton.ticketId, actor);
    if (result.ok) {
      await interaction.deferUpdate();
      return;
    }

    await replyEphemeral(interaction, result.message);
    return;
  }

  const tokenButton = parseTokenButton(interaction.customId);
  if (tokenButton) {
    if (tokenButton.action === "support") {
      const modal = new ModalBuilder()
        .setCustomId(ComponentIds.tokenSupportModal(tokenButton.ticketId))
        .setTitle("Lý do cần support")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Mô tả ngắn lỗi bạn đang gặp")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(500)
          )
        );
      await interaction.showModal(modal);
      return;
    }

    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const actor = {
      actorId: interaction.user.id,
      actorRoleIds: extractRoleIds(member),
      hasManageChannels: interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false
    };
    const result = await dependencies.tickets.confirmTokenDownloadedByTicketId(tokenButton.ticketId, actor);
    if (result.ok) {
      await interaction.deferUpdate();
      return;
    }

    await replyEphemeral(interaction, result.message);
    return;
  }

  const parsed = parseTicketButton(interaction.customId);
  if (!parsed) {
    return;
  }

  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const actor = {
    actorId: interaction.user.id,
    actorRoleIds: extractRoleIds(member),
    hasManageChannels: interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false
  };

  const result =
    parsed.action === "claim"
      ? await dependencies.tickets.claimByTicketId(parsed.ticketId, actor)
      : parsed.action === "activate"
        ? await dependencies.tickets.activateByTicketId(parsed.ticketId, actor)
      : await closeFromButton(interaction, dependencies.tickets, parsed.ticketId, actor);

  if (result.ok && (parsed.action === "claim" || parsed.action === "activate")) {
    await interaction.deferUpdate();
    return;
  }

  await replyEphemeral(interaction, result.message);
}

export async function handleModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
  dependencies: InteractionDependencies
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, "This interaction only works inside a guild.");
    return;
  }

  const ticketId = parseTokenSupportModalId(interaction.customId);
  if (!ticketId) {
    return;
  }

  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const actor = {
    actorId: interaction.user.id,
    actorRoleIds: extractRoleIds(member),
    hasManageChannels: interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false
  };
  const result = await dependencies.tickets.submitTokenSupportByTicketId(
    ticketId,
    actor,
    interaction.fields.getTextInputValue("reason")
  );
  await replyEphemeral(interaction, result.message);
}

async function closeFromButton(
  interaction: ButtonInteraction,
  tickets: TicketService,
  ticketId: string,
  actor: { actorId: string; actorRoleIds: string[]; hasManageChannels: boolean }
) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  return tickets.closeByTicketId(ticketId, actor);
}
