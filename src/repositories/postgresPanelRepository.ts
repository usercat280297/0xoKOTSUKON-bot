import { randomUUID } from "node:crypto";
import { type Pool } from "pg";
import type { AddPanelOptionInput, CreatePanelInput, TicketOption, TicketPanel, TicketPanelWithOptions } from "../domain/types";
import type { PanelRepository } from "./interfaces";

function mapPanel(row: Record<string, unknown>): TicketPanel {
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    name: String(row.name),
    channelId: String(row.channel_id),
    messageId: row.message_id ? String(row.message_id) : null,
    placeholder: String(row.placeholder),
    template: row.template === "game-activation" ? "game-activation" : "default",
    active: Boolean(row.active)
  };
}

function mapOption(row: Record<string, unknown>): TicketOption {
  return {
    id: String(row.id),
    panelId: String(row.panel_id),
    value: String(row.value),
    label: String(row.label),
    emoji: row.emoji ? String(row.emoji) : null,
    requiredRoleId: String(row.required_role_id),
    redirectChannelId: String(row.redirect_channel_id),
    targetCategoryId: String(row.target_category_id),
    staffRoleId: String(row.staff_role_id),
    active: Boolean(row.active)
  };
}

export class PostgresPanelRepository implements PanelRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: CreatePanelInput): Promise<TicketPanel> {
    const id = randomUUID();
    const result = await this.pool.query(
      `
        INSERT INTO ticket_panels (id, guild_id, name, channel_id, placeholder, template, active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id, guild_id, name, channel_id, message_id, placeholder, template, active
      `,
      [id, input.guildId, input.name, input.channelId, input.placeholder, input.template]
    );

    return mapPanel(result.rows[0]);
  }

  public async addOption(input: AddPanelOptionInput): Promise<TicketOption> {
    const id = randomUUID();
    const result = await this.pool.query(
      `
        INSERT INTO ticket_options (
          id,
          panel_id,
          value,
          label,
          emoji,
          required_role_id,
          redirect_channel_id,
          target_category_id,
          staff_role_id,
          active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING
          id,
          panel_id,
          value,
          label,
          emoji,
          required_role_id,
          redirect_channel_id,
          target_category_id,
          staff_role_id,
          active
      `,
      [
        id,
        input.panelId,
        input.value,
        input.label,
        input.emoji,
        input.requiredRoleId,
        input.redirectChannelId,
        input.targetCategoryId,
        input.staffRoleId
      ]
    );

    return mapOption(result.rows[0]);
  }

  public async getById(panelId: string): Promise<TicketPanelWithOptions | null> {
    const panelResult = await this.pool.query(
      "SELECT id, guild_id, name, channel_id, message_id, placeholder, template, active FROM ticket_panels WHERE id = $1",
      [panelId]
    );

    if (panelResult.rowCount === 0) {
      return null;
    }

    const optionsResult = await this.pool.query(
      `
        SELECT
          id,
          panel_id,
          value,
          label,
          emoji,
          required_role_id,
          redirect_channel_id,
          target_category_id,
          staff_role_id,
          active
        FROM ticket_options
        WHERE panel_id = $1
        ORDER BY created_at ASC
      `,
      [panelId]
    );

    return {
      ...mapPanel(panelResult.rows[0]),
      options: optionsResult.rows.map(mapOption)
    };
  }

  public async getOptionById(optionId: string): Promise<TicketOption | null> {
    const result = await this.pool.query(
      `
        SELECT
          id,
          panel_id,
          value,
          label,
          emoji,
          required_role_id,
          redirect_channel_id,
          target_category_id,
          staff_role_id,
          active
        FROM ticket_options
        WHERE id = $1
      `,
      [optionId]
    );

    return result.rowCount === 0 ? null : mapOption(result.rows[0]);
  }

  public async listByGuildId(guildId: string): Promise<TicketPanelWithOptions[]> {
    const panelResult = await this.pool.query(
      "SELECT id, guild_id, name, channel_id, message_id, placeholder, template, active FROM ticket_panels WHERE guild_id = $1 ORDER BY created_at ASC",
      [guildId]
    );

    if (panelResult.rowCount === 0) {
      return [];
    }

    const panels = panelResult.rows.map(mapPanel);
    const panelIds = panels.map((panel: TicketPanel) => panel.id);
    const optionResult = await this.pool.query(
      `
        SELECT
          id,
          panel_id,
          value,
          label,
          emoji,
          required_role_id,
          redirect_channel_id,
          target_category_id,
          staff_role_id,
          active
        FROM ticket_options
        WHERE panel_id = ANY($1::text[])
        ORDER BY created_at ASC
      `,
      [panelIds]
    );

    const optionsByPanelId = new Map<string, TicketOption[]>();
    for (const row of optionResult.rows) {
      const option = mapOption(row);
      const current = optionsByPanelId.get(option.panelId) ?? [];
      current.push(option);
      optionsByPanelId.set(option.panelId, current);
    }

    return panels.map((panel: TicketPanel) => ({
      ...panel,
      options: optionsByPanelId.get(panel.id) ?? []
    }));
  }

  public async savePublishedMessage(panelId: string, messageId: string): Promise<void> {
    await this.pool.query("UPDATE ticket_panels SET message_id = $2 WHERE id = $1", [panelId, messageId]);
  }

  public async disable(panelId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE ticket_panels SET active = FALSE WHERE id = $1", [panelId]);
    return (result.rowCount ?? 0) > 0;
  }
}
