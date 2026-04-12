import { type Pool } from "pg";
import type { SteamUpdateStateRepository } from "./interfaces";

export class PostgresSteamUpdateStateRepository implements SteamUpdateStateRepository {
  public constructor(private readonly pool: Pool) {}

  public async getLastSeenBuilds(appIds: number[]): Promise<Map<number, string>> {
    if (appIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query(
      `
        SELECT app_id, last_seen_build_id
        FROM steam_update_states
        WHERE app_id = ANY($1::bigint[])
      `,
      [appIds]
    );

    return new Map(
      result.rows.map((row) => [Number(row.app_id), String(row.last_seen_build_id)])
    );
  }

  public async upsertLastSeenBuild(appId: number, buildId: string): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO steam_update_states (app_id, last_seen_build_id)
        VALUES ($1, $2)
        ON CONFLICT (app_id)
        DO UPDATE
        SET
          last_seen_build_id = EXCLUDED.last_seen_build_id,
          updated_at = NOW()
      `,
      [appId, buildId]
    );
  }
}
