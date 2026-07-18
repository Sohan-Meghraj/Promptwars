import type { RestrictionRule } from "@/lib/types";

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localClock(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayByName: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayByName[value("weekday")] ?? 0, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function isRuleActive(rule: Pick<RestrictionRule, "activeDays" | "startTime" | "endTime" | "timezone" | "enabled">, now = new Date()) {
  if (!rule.enabled || rule.activeDays.length === 0 || rule.startTime === rule.endTime) return false;
  const { weekday, minutes } = localClock(rule.timezone, now);
  const start = toMinutes(rule.startTime);
  const end = toMinutes(rule.endTime);

  if (start < end) {
    return rule.activeDays.includes(weekday) && minutes >= start && minutes < end;
  }

  const previousDay = (weekday + 6) % 7;
  return (rule.activeDays.includes(weekday) && minutes >= start) || (rule.activeDays.includes(previousDay) && minutes < end);
}

export function scheduleLabel(rule: Pick<RestrictionRule, "activeDays" | "startTime" | "endTime">) {
  const time = `${formatTime(rule.startTime)}–${formatTime(rule.endTime)}`;
  if (rule.activeDays.length === 7) return `Every day · ${time}`;
  if (rule.activeDays.length === 5 && rule.activeDays.every((day) => day >= 1 && day <= 5)) return `Weekdays · ${time}`;
  return `${rule.activeDays.length} days · ${time}`;
}

export function formatTime(value: string) {
  const [hourValue, minute] = value.split(":");
  const hour = Number(hourValue);
  const suffix = hour >= 12 ? "p.m." : "a.m.";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}
