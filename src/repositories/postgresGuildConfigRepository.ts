import { type Pool } from "pg";
import type { GuildConfigRepository } from "./interfaces";
import type { GuildConfig } from "../domain/types";

function mapRow(row: Record<string, unknown>): GuildConfig {
  return {
    guildId: String(row.guild_id),
    logChannelId: row.log_channel_id ? String(row.log_channel_id) : null,
    closedCategoryId: row.closed_category_id ? String(row.closed_category_id) : null,
    donatorRoleId: row.donator_role_id ? String(row.donator_role_id) : null,
    donationThanksChannelId: row.donation_thanks_channel_id ? String(row.donation_thanks_channel_id) : null,
    donationLinkUrl: row.donation_link_url ? String(row.donation_link_url) : null,
    donationQrImageUrl: row.donation_qr_image_url ? String(row.donation_qr_image_url) : null
  };
}

export class PostgresGuildConfigRepository implements GuildConfigRepository {
  public constructor(private readonly pool: Pool) {}

  public async getByGuildId(guildId: string): Promise<GuildConfig | null> {
    const result = await this.pool.query(
      `
        SELECT
          guild_id,
          log_channel_id,
          closed_category_id,
          donator_role_id,
          donation_thanks_channel_id,
          donation_link_url,
          donation_qr_image_url
        FROM guild_configs
        WHERE guild_id = $1
      `,
      [guildId]
    );
    return result.rowCount === 0 ? null : mapRow(result.rows[0]);
  }

  public async upsert(
    guildId: string,
    patch: {
      logChannelId?: string | null;
      closedCategoryId?: string | null;
      donatorRoleId?: string | null;
      donationThanksChannelId?: string | null;
      donationLinkUrl?: string | null;
      donationQrImageUrl?: string | null;
    }
  ): Promise<GuildConfig> {
    const current = await this.getByGuildId(guildId);
    const logChannelId = patch.logChannelId !== undefined ? patch.logChannelId : current?.logChannelId ?? null;
    const closedCategoryId =
      patch.closedCategoryId !== undefined ? patch.closedCategoryId : current?.closedCategoryId ?? null;
    const donatorRoleId = patch.donatorRoleId !== undefined ? patch.donatorRoleId : current?.donatorRoleId ?? null;
    const donationThanksChannelId =
      patch.donationThanksChannelId !== undefined
        ? patch.donationThanksChannelId
        : current?.donationThanksChannelId ?? null;
    const donationLinkUrl =
      patch.donationLinkUrl !== undefined ? patch.donationLinkUrl : current?.donationLinkUrl ?? null;
    const donationQrImageUrl =
      patch.donationQrImageUrl !== undefined ? patch.donationQrImageUrl : current?.donationQrImageUrl ?? null;

    const result = await this.pool.query(
      `
        INSERT INTO guild_configs (
          guild_id,
          log_channel_id,
          closed_category_id,
          donator_role_id,
          donation_thanks_channel_id,
          donation_link_url,
          donation_qr_image_url,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (guild_id)
        DO UPDATE SET
          log_channel_id = EXCLUDED.log_channel_id,
          closed_category_id = EXCLUDED.closed_category_id,
          donator_role_id = EXCLUDED.donator_role_id,
          donation_thanks_channel_id = EXCLUDED.donation_thanks_channel_id,
          donation_link_url = EXCLUDED.donation_link_url,
          donation_qr_image_url = EXCLUDED.donation_qr_image_url,
          updated_at = NOW()
        RETURNING
          guild_id,
          log_channel_id,
          closed_category_id,
          donator_role_id,
          donation_thanks_channel_id,
          donation_link_url,
          donation_qr_image_url
      `,
      [guildId, logChannelId, closedCategoryId, donatorRoleId, donationThanksChannelId, donationLinkUrl, donationQrImageUrl]
    );

    return mapRow(result.rows[0]);
  }
}
