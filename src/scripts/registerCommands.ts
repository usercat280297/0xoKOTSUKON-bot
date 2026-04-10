import { REST, Routes } from "discord.js";
import { getDiscordCommandEnv } from "../config/env";
import { commandCatalog } from "../config/commandCatalog";

async function main(): Promise<void> {
  const env = getDiscordCommandEnv();
  const rest = new REST({ version: "10" }).setToken(env.discordToken);
  const payload = commandCatalog.map((command) => command.toJSON());

  if (env.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.discordApplicationId, env.discordGuildId), {
      body: payload
    });
    console.log(`Registered ${payload.length} guild commands.`);
    return;
  }

  await rest.put(Routes.applicationCommands(env.discordApplicationId), {
    body: payload
  });
  console.log(`Registered ${payload.length} global commands.`);
}

main().catch((error) => {
  console.error("Failed to register commands.", error);
  process.exitCode = 1;
});
