import type { Pool } from "pg";
import type { DailyCheckinRepository } from "./interfaces";

export class PostgresDailyCheckinRepository implements DailyCheckinRepository {
  public constructor(private readonly pool: Pool) {}

  public async hasCheckinOnDate(guildId: string, userId: string, date: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM daily_checkins
          WHERE guild_id = $1 AND user_id = $2 AND checkin_date = $3::date
        ) AS exists
      `,
      [guildId, userId, date]
    );

    return Boolean(result.rows[0]?.exists);
  }

  public async createCheckin(guildId: string, userId: string, date: string): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO daily_checkins (guild_id, user_id, checkin_date)
        VALUES ($1, $2, $3::date)
        ON CONFLICT (guild_id, user_id, checkin_date) DO NOTHING
      `,
      [guildId, userId, date]
    );
  }

  public async listDatesForUser(guildId: string, userId: string): Promise<string[]> {
    const result = await this.pool.query<{ checkin_date: string }>(
      `
        SELECT checkin_date::text
        FROM daily_checkins
        WHERE guild_id = $1 AND user_id = $2
        ORDER BY checkin_date DESC
      `,
      [guildId, userId]
    );

    return result.rows.map((row) => row.checkin_date);
  }
}
