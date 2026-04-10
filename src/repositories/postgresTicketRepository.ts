import { randomUUID } from "node:crypto";
import { type Pool } from "pg";
import type { CreateTicketInput, Ticket, TicketEvent } from "../domain/types";
import type { TicketRepository } from "./interfaces";

function mapTicket(row: Record<string, unknown>): Ticket {
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    channelId: String(row.channel_id),
    optionId: String(row.option_id),
    status: row.status === "closed" ? "closed" : "open",
    originalCategoryId: row.original_category_id ? String(row.original_category_id) : null,
    claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    closedBy: row.closed_by ? String(row.closed_by) : null,
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
    transcriptMessageId: row.transcript_message_id ? String(row.transcript_message_id) : null
  };
}

export class PostgresTicketRepository implements TicketRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: CreateTicketInput): Promise<Ticket> {
    const id = randomUUID();
    const result = await this.pool.query(
      `
        INSERT INTO tickets (
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
      `,
      [
        id,
        input.guildId,
        input.userId,
        input.channelId,
        input.optionId,
        input.status,
        input.originalCategoryId,
        input.claimedBy,
        input.closedBy,
        input.closedAt,
        input.transcriptMessageId
      ]
    );

    return mapTicket(result.rows[0]);
  }

  public async findOpenByUser(guildId: string, userId: string): Promise<Ticket | null> {
    const result = await this.pool.query(
      `
        SELECT
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
        FROM tickets
        WHERE guild_id = $1 AND user_id = $2 AND status = 'open'
        LIMIT 1
      `,
      [guildId, userId]
    );

    return result.rowCount === 0 ? null : mapTicket(result.rows[0]);
  }

  public async findByChannelId(channelId: string): Promise<Ticket | null> {
    const result = await this.pool.query(
      `
        SELECT
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
        FROM tickets
        WHERE channel_id = $1
        LIMIT 1
      `,
      [channelId]
    );

    return result.rowCount === 0 ? null : mapTicket(result.rows[0]);
  }

  public async findById(ticketId: string): Promise<Ticket | null> {
    const result = await this.pool.query(
      `
        SELECT
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
        FROM tickets
        WHERE id = $1
        LIMIT 1
      `,
      [ticketId]
    );

    return result.rowCount === 0 ? null : mapTicket(result.rows[0]);
  }

  public async markClaimed(ticketId: string, claimedBy: string): Promise<Ticket> {
    const result = await this.pool.query(
      `
        UPDATE tickets
        SET claimed_by = $2
        WHERE id = $1
        RETURNING
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
      `,
      [ticketId, claimedBy]
    );

    return mapTicket(result.rows[0]);
  }

  public async close(ticketId: string, closedBy: string, transcriptMessageId: string | null): Promise<Ticket> {
    const result = await this.pool.query(
      `
        UPDATE tickets
        SET
          status = 'closed',
          closed_by = $2,
          closed_at = NOW(),
          transcript_message_id = $3
        WHERE id = $1
        RETURNING
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
      `,
      [ticketId, closedBy, transcriptMessageId]
    );

    return mapTicket(result.rows[0]);
  }

  public async reopen(ticketId: string): Promise<Ticket> {
    const result = await this.pool.query(
      `
        UPDATE tickets
        SET
          status = 'open',
          closed_by = NULL,
          closed_at = NULL
        WHERE id = $1
        RETURNING
          id,
          guild_id,
          user_id,
          channel_id,
          option_id,
          status,
          original_category_id,
          claimed_by,
          closed_by,
          closed_at,
          transcript_message_id
      `,
      [ticketId]
    );

    return mapTicket(result.rows[0]);
  }

  public async addEvent(event: TicketEvent): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO ticket_events (ticket_id, actor_id, event_type, payload)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [event.ticketId, event.actorId, event.eventType, JSON.stringify(event.payload)]
    );
  }
}
