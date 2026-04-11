export interface BusinessHoursConfig {
  timezone: string;
  startHour: number;
  endHour: number;
}

export interface BusinessHoursStatus {
  isOpen: boolean;
  currentTimeLabel: string;
  windowLabel: string;
  timezone: string;
}

export interface BusinessHoursCountdown extends BusinessHoursStatus {
  nextOpenAt: Date;
  closesAt: Date | null;
}

export class BusinessHoursService {
  private readonly formatter: Intl.DateTimeFormat;
  private readonly dateTimeFormatter: Intl.DateTimeFormat;

  public constructor(
    private readonly config: BusinessHoursConfig,
    private readonly nowProvider: () => Date = () => new Date()
  ) {
    this.formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    this.dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  public getStatus(): BusinessHoursStatus {
    const now = this.nowProvider();
    const parts = this.formatter.formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    const currentMinutes = hour * 60 + minute;
    const startMinutes = this.config.startHour * 60;
    const endMinutes = this.config.endHour * 60;

    return {
      isOpen: currentMinutes >= startMinutes && currentMinutes < endMinutes,
      currentTimeLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      windowLabel: `${String(this.config.startHour).padStart(2, "0")}:00-${String(this.config.endHour).padStart(2, "0")}:00`,
      timezone: this.config.timezone
    };
  }

  public getCountdown(): BusinessHoursCountdown {
    const now = this.nowProvider();
    const status = this.getStatus();
    const localParts = this.getLocalDateParts(now);
    const startToday = this.createWindowDate(localParts.year, localParts.month, localParts.day, this.config.startHour);
    const nextOpenAt =
      status.isOpen || now >= startToday
        ? this.createWindowDate(localParts.year, localParts.month, localParts.day + 1, this.config.startHour)
        : startToday;

    return {
      ...status,
      nextOpenAt,
      closesAt: status.isOpen
        ? this.createWindowDate(localParts.year, localParts.month, localParts.day, this.config.endHour)
        : null
    };
  }

  private getLocalDateParts(date: Date): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const parts = this.dateTimeFormatter.formatToParts(date);

    return {
      year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
      month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
      day: Number(parts.find((part) => part.type === "day")?.value ?? "1"),
      hour: Number(parts.find((part) => part.type === "hour")?.value ?? "0"),
      minute: Number(parts.find((part) => part.type === "minute")?.value ?? "0"),
      second: Number(parts.find((part) => part.type === "second")?.value ?? "0")
    };
  }

  private createWindowDate(year: number, month: number, day: number, hour: number): Date {
    const dayAnchor = new Date(Date.UTC(year, month - 1, day));
    const extraDays = Math.floor(hour / 24);
    const normalizedHour = hour % 24;
    dayAnchor.setUTCDate(dayAnchor.getUTCDate() + extraDays);

    const targetYear = dayAnchor.getUTCFullYear();
    const targetMonth = dayAnchor.getUTCMonth() + 1;
    const targetDay = dayAnchor.getUTCDate();
    const utcGuess = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, normalizedHour, 0, 0));
    const offset = this.getTimeZoneOffsetMilliseconds(utcGuess);

    return new Date(utcGuess.getTime() - offset);
  }

  private getTimeZoneOffsetMilliseconds(date: Date): number {
    const local = this.getLocalDateParts(date);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    return localAsUtc - date.getTime();
  }
}
