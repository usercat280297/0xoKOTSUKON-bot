import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const panelCommand = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("Manage ticket dropdown panels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a new panel")
      .addStringOption((option) => option.setName("name").setDescription("Panel name").setRequired(true))
      .addChannelOption((option) =>
        option.setName("channel").setDescription("Text channel where the panel will be published").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("placeholder").setDescription("Dropdown placeholder text").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("template")
          .setDescription("Visual template for this panel")
          .addChoices(
            { name: "Default", value: "default" },
            { name: "Game Activation", value: "game-activation" }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add-option")
      .setDescription("Add a dropdown option to a panel")
      .addStringOption((option) => option.setName("panel-id").setDescription("Panel id").setRequired(true))
      .addStringOption((option) => option.setName("value").setDescription("Stable option value").setRequired(true))
      .addStringOption((option) => option.setName("label").setDescription("Visible option label").setRequired(true))
      .addRoleOption((option) => option.setName("required-role").setDescription("Role required to open the ticket").setRequired(true))
      .addChannelOption((option) =>
        option
          .setName("redirect-channel")
          .setDescription("Role selection channel shown when access is denied")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName("target-category")
          .setDescription("Category where the ticket channel will be created")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addRoleOption((option) => option.setName("staff-role").setDescription("Staff role that handles this route").setRequired(true))
      .addStringOption((option) => option.setName("emoji").setDescription("Optional emoji for the dropdown option"))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("publish")
      .setDescription("Publish the panel dropdown message")
      .addStringOption((option) => option.setName("panel-id").setDescription("Panel id").setRequired(true))
  )
  .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List all panels in this guild"))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable")
      .setDescription("Disable a panel")
      .addStringOption((option) => option.setName("panel-id").setDescription("Panel id").setRequired(true))
  );

const configCommand = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure guild level ticket settings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set-log-channel")
      .setDescription("Set the transcript log channel")
      .addChannelOption((option) =>
        option.setName("channel").setDescription("Log text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
  );

const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Manage an existing ticket from the current channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((subcommand) => subcommand.setName("claim").setDescription("Claim the current ticket"))
  .addSubcommand((subcommand) => subcommand.setName("close").setDescription("Close the current ticket"))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add-member")
      .setDescription("Add a guild member to the current ticket")
      .addUserOption((option) => option.setName("member").setDescription("Member to add").setRequired(true))
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove-member")
      .setDescription("Remove a guild member from the current ticket")
      .addUserOption((option) => option.setName("member").setDescription("Member to remove").setRequired(true))
  );

export const commandCatalog = [panelCommand, configCommand, ticketCommand];
