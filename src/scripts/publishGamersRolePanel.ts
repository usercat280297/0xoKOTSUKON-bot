import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits
} from "discord.js";
import { ComponentIds } from "../utils/componentIds";

const GUILD_ID = "1492076309323714570";
const CHANNEL_ID = "1492265306385678336";
const GAMERS_ROLE_ID = "1492130518869999737";

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is missing.");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  try {
    await client.login(token);

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("Target channel is not a text channel.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("Nhận role GAMERS")
      .setDescription(
        [
          `Bấm nút bên dưới để nhận role <@&${GAMERS_ROLE_ID}>.`,
          "",
          "Role này dùng để mở ticket activation và các luồng dành cho member đã vào game."
        ].join("\n")
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ComponentIds.selfRoleButton(GAMERS_ROLE_ID))
        .setLabel("Nhận GAMERS")
        .setStyle(ButtonStyle.Success)
    );

    const message = await channel.send({
      embeds: [embed],
      components: [row]
    });

    console.log(
      JSON.stringify({
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        roleId: GAMERS_ROLE_ID,
        messageId: message.id
      })
    );
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error("Failed to publish GAMERS role panel.", error);
  process.exitCode = 1;
});
