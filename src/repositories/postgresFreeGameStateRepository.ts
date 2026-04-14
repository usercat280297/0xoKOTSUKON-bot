import { type Pool } from "pg";
import type { FreeGamePlatform, FreeGameStateRecord, FreeGameStateRepository } from "./interfaces";

export class PostgresFreeGameStateRepository implements FreeGameStateRepository {
  public constructor(private readonly pool: Pool) {}

  public async getStates(platform: FreeGamePlatform, gameIds: string[]): Promise<Map<string, FreeGameStateRecord>> {
    if (gameIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query(
      `
        SELECT game_id, title, is_currently_free, offer_key
        FROM free_game_states
        WHERE platform = $1
          AND game_id = ANY($2::text[])
      `,
      [platform, gameIds]
    );

    return new Map(
      result.rows.map((row) => [
        String(row.game_id),
        {
          gameId: String(row.game_id),
          title: String(row.title),
          isCurrentlyFree: Boolean(row.is_currently_free),
          offerKey: row.offer_key ? String(row.offer_key) : null
        }
      ])
    );
  }

  public async listCurrentlyFree(platform: FreeGamePlatform): Promise<Map<string, FreeGameStateRecord>> {
    const result = await this.pool.query(
      `
        SELECT game_id, title, is_currently_free, offer_key
        FROM free_game_states
        WHERE platform = $1
          AND is_currently_free = TRUE
      `,
      [platform]
    );

    return new Map(
      result.rows.map((row) => [
        String(row.game_id),
        {
          gameId: String(row.game_id),
          title: String(row.title),
          isCurrentlyFree: Boolean(row.is_currently_free),
          offerKey: row.offer_key ? String(row.offer_key) : null
        }
      ])
    );
  }

  public async upsertState(input: {
    platform: FreeGamePlatform;
    gameId: string;
    title: string;
    isCurrentlyFree: boolean;
    offerKey: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO free_game_states (
          platform,
          game_id,
          title,
          is_currently_free,
          offer_key,
          starts_at,
          ends_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (platform, game_id)
        DO UPDATE
        SET
          title = EXCLUDED.title,
          is_currently_free = EXCLUDED.is_currently_free,
          offer_key = EXCLUDED.offer_key,
          starts_at = EXCLUDED.starts_at,
          ends_at = EXCLUDED.ends_at,
          updated_at = NOW()
      `,
      [input.platform, input.gameId, input.title, input.isCurrentlyFree, input.offerKey, input.startsAt, input.endsAt]
    );
  }
}
