import type { CommandInteraction, GuildMember, InteractionReplyOptions, MessageComponentInteraction } from "discord.js";

type ReplyableInteraction = CommandInteraction | MessageComponentInteraction;

export async function replyEphemeral(interaction: ReplyableInteraction, content: string): Promise<void> {
  const payload: InteractionReplyOptions = {
    content,
    ephemeral: true
  };

  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

export function extractRoleIds(member: GuildMember | null | undefined | { roles?: string[] | { cache?: Map<string, unknown> } }): string[] {
  if (!member || !("roles" in member) || !member.roles) {
    return [];
  }

  if (Array.isArray(member.roles)) {
    return member.roles.map(String);
  }

  if ("cache" in member.roles && member.roles.cache) {
    return [...member.roles.cache.keys()];
  }

  return [];
}

export function extractDisplayName(member: GuildMember | null | undefined, fallback: string): string {
  return member?.displayName ?? fallback;
}
