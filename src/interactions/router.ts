import { ButtonInteraction, GuildMember, PermissionFlagsBits, StringSelectMenuInteraction } from "discord.js";
import { PanelService } from "../services/panelService";
import { TicketService } from "../services/ticketService";
import { parsePanelResetId, parsePanelSelectId, parseTicketButton, parseTicketIssueSelectId } from "../utils/componentIds";
import { extractDisplayName, extractRoleIds, replyEphemeral } from "../utils/interactions";

export interface InteractionDependencies {
  panels: PanelService;
  tickets: TicketService;
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
      : await closeFromButton(interaction, dependencies.tickets, parsed.ticketId, actor);

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
