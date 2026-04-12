import type { DailyCheckinRepository } from "../repositories/interfaces";

export interface DailyCheckinResult {
  alreadyCheckedIn: boolean;
  checkedInDate: string;
  streak: number;
  total: number;
  message: string;
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function previousDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

function calculateStreak(dates: string[], today: string): number {
  const remaining = new Set(dates);
  let cursor = today;
  let streak = 0;

  while (remaining.has(cursor)) {
    streak += 1;
    cursor = previousDate(cursor);
  }

  return streak;
}

export class DailyCheckinService {
  public constructor(
    private readonly repository: DailyCheckinRepository,
    private readonly timezone: string
  ) {}

  public async checkIn(guildId: string, userId: string, now = new Date()): Promise<DailyCheckinResult> {
    const checkedInDate = formatDateInTimezone(now, this.timezone);
    const alreadyCheckedIn = await this.repository.hasCheckinOnDate(guildId, userId, checkedInDate);

    if (!alreadyCheckedIn) {
      await this.repository.createCheckin(guildId, userId, checkedInDate);
    }

    const dates = await this.repository.listDatesForUser(guildId, userId);
    const streak = calculateStreak(dates, checkedInDate);
    const total = dates.length;

    return {
      alreadyCheckedIn,
      checkedInDate,
      streak,
      total,
      message: alreadyCheckedIn
        ? `Hôm nay bạn đã điểm danh rồi. Chuỗi hiện tại: ${streak} ngày. Tổng điểm danh: ${total} ngày.`
        : `Điểm danh thành công hôm nay. Chuỗi hiện tại: ${streak} ngày. Tổng điểm danh: ${total} ngày.`
    };
  }
}
