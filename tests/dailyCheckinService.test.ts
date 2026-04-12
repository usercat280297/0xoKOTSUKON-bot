import { describe, expect, it } from "vitest";
import { DailyCheckinService } from "../src/services/dailyCheckinService";
import type { DailyCheckinRepository } from "../src/repositories/interfaces";

class FakeDailyCheckinRepository implements DailyCheckinRepository {
  private readonly datesByUser = new Map<string, Set<string>>();

  public async hasCheckinOnDate(guildId: string, userId: string, date: string): Promise<boolean> {
    return this.datesByUser.get(`${guildId}:${userId}`)?.has(date) ?? false;
  }

  public async createCheckin(guildId: string, userId: string, date: string): Promise<void> {
    const key = `${guildId}:${userId}`;
    const dates = this.datesByUser.get(key) ?? new Set<string>();
    dates.add(date);
    this.datesByUser.set(key, dates);
  }

  public async listDatesForUser(guildId: string, userId: string): Promise<string[]> {
    return [...(this.datesByUser.get(`${guildId}:${userId}`) ?? new Set<string>())].sort((left, right) =>
      right.localeCompare(left)
    );
  }

  public seed(guildId: string, userId: string, ...dates: string[]): void {
    const key = `${guildId}:${userId}`;
    this.datesByUser.set(key, new Set(dates));
  }
}

describe("DailyCheckinService", () => {
  it("creates a new check-in and reports streak and total", async () => {
    const repository = new FakeDailyCheckinRepository();
    repository.seed("guild-1", "user-1", "2026-04-10", "2026-04-11");
    const service = new DailyCheckinService(repository, "Asia/Bangkok");

    const result = await service.checkIn("guild-1", "user-1", new Date("2026-04-12T02:00:00.000Z"));

    expect(result.alreadyCheckedIn).toBe(false);
    expect(result.checkedInDate).toBe("2026-04-12");
    expect(result.streak).toBe(3);
    expect(result.total).toBe(3);
  });

  it("does not create a duplicate check-in for the same day", async () => {
    const repository = new FakeDailyCheckinRepository();
    repository.seed("guild-1", "user-1", "2026-04-12", "2026-04-11");
    const service = new DailyCheckinService(repository, "Asia/Bangkok");

    const result = await service.checkIn("guild-1", "user-1", new Date("2026-04-12T05:00:00.000Z"));

    expect(result.alreadyCheckedIn).toBe(true);
    expect(result.streak).toBe(2);
    expect(result.total).toBe(2);
  });
});
