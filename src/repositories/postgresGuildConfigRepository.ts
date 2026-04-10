import { type Pool } from "pg";
import type { GuildConfigRepository } from "./interfaces";
import type { GuildConfig } from "../domain/types";

function mapRow(row: Record<string, unknown>): GuildConfig {
  return {
    guildId: String(row.guild_id),
    logChannelId: row.log_channel_id ? String(row.log_channel_id) : null,
    closedCategoryId: row.closed_category_id ? String(row.closed_category_id) : null
  };
}

export class PostgresGuildConfigRepository implements GuildConfigRepository {
  public constructor(private readonly pool: Pool) {}

  public async getByGuildId(guildId: string): Promise<GuildConfig | null> {
    const result = await this.pool.query("SELECT guild_id, log_channel_id, closed_category_id FROM guild_configs WHERE guild_id = $1", [guildId]);
    return result.rowCount === 0 ? null : mapRow(result.rows[0]);
  }

  public async upsert(
    guildId: string,
    patch: { logChannelId?: string | null; closedCategoryId?: string | null }
  ): Promise<GuildConfig> {
    const current = await this.getByGuildId(guildId);
    const logChannelId = patch.logChannelId !== undefined ? patch.logChannelId : current?.logChannelId ?? null;
    const closedCategoryId =
      patch.closedCategoryId !== undefined ? patch.closedCategoryId : current?.closedCategoryId ?? null;

    const result = await this.pool.query(
      `
        INSERT INTO guild_configs (guild_id, log_channel_id, closed_category_id, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (guild_id)
        DO UPDATE SET
          log_channel_id = EXCLUDED.log_channel_id,
          closed_category_id = EXCLUDED.closed_category_id,
          updated_at = NOW()
        RETURNING guild_id, log_channel_id, closed_category_id
      `,
      [guildId, logChannelId, closedCategoryId]
    );

    return mapRow(result.rows[0]);
  }
}
