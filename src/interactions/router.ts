import { ButtonInteraction, GuildMember, PermissionFlagsBits, StringSelectMenuInteraction } from "discord.js";
import { TicketService } from "../services/ticketService";
import { parsePanelSelectId, parseTicketButton } from "../utils/componentIds";
import { extractDisplayName, extractRoleIds, replyEphemeral } from "../utils/interactions";

export interface InteractionDependencies {
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
  if (!panelId) {
    return;
  }

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
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  dependencies: InteractionDependencies
): Promise<void> {
  if (!interaction.inGuild()) {
    await replyEphemeral(interaction, "This interaction only works inside a guild.");
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
      : await dependencies.tickets.closeByTicketId(parsed.ticketId, actor);

  await replyEphemeral(interaction, result.message);
}
