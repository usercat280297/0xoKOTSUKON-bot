import { Client, GatewayIntentBits } from "discord.js";
import { getBotEnv } from "../config/env";
import { DiscordJsTicketGateway } from "../services/discordGateway";

const DEFAULT_CHANNEL_ID = "1492835160415010908";

async function main(): Promise<void> {
  const env = getBotEnv();
  const channelId = process.argv[2] ?? DEFAULT_CHANNEL_ID;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });
  const gateway = new DiscordJsTicketGateway(client);

  try {
    await client.login(env.discordToken);
    const messageId = await gateway.sendDailyCheckinPanel(channelId);
    const guildId = env.discordGuildId;
    console.log(
      guildId
        ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
        : `Sent daily check-in panel to channel ${channelId} as message ${messageId}`
    );
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error("Failed to publish daily check-in panel.", error);
  process.exitCode = 1;
});
