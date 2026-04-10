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

export class BusinessHoursService {
  private readonly formatter: Intl.DateTimeFormat;

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
}
