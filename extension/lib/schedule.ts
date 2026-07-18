import type { AccessGrant, RestrictionRule } from './types';

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timezone);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function nowInTimeZone(now: Date, timezone: string): { weekday: number; minutes: number } {
  const parts = getFormatter(timezone).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_TO_NUMBER[values.get('weekday') ?? 'Sun'] ?? 0;
  const hour = Number(values.get('hour') ?? 0);
  const minute = Number(values.get('minute') ?? 0);
  return { weekday, minutes: hour * 60 + minute };
}

function previousWeekday(day: number): number {
  return (day + 6) % 7;
}

export function isRuleActive(rule: RestrictionRule, now = new Date()): boolean {
  if (!rule.enabled) return false;

  const { weekday, minutes } = nowInTimeZone(now, rule.timezone);
  const start = minutesFromTime(rule.startTime);
  const end = minutesFromTime(rule.endTime);

  // Equal times are invalid for a focused restriction rather than an implicit
  // all-day block. The dashboard validates this before storage as well.
  if (start === end) return false;

  if (start < end) {
    return rule.days.includes(weekday) && minutes >= start && minutes < end;
  }

  return minutes >= start
    ? rule.days.includes(weekday)
    : minutes < end && rule.days.includes(previousWeekday(weekday));
}

export function domainMatches(ruleDomain: string, hostname: string): boolean {
  return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
}

export function hasActiveGrantForDomain(
  grants: AccessGrant[],
  hostname: string,
  now = Date.now(),
): boolean {
  return grants.some(
    (grant) => new Date(grant.expiresAt).getTime() > now && domainMatches(grant.domain, hostname),
  );
}

export function findActiveRuleForDomain(
  rules: RestrictionRule[],
  hostname: string,
  now = new Date(),
): RestrictionRule | null {
  let bestMatch: RestrictionRule | null = null;
  for (const rule of rules) {
    if (!isRuleActive(rule, now) || !domainMatches(rule.domain, hostname)) continue;
    if (!bestMatch || rule.domain.length > bestMatch.domain.length) bestMatch = rule;
  }
  return bestMatch;
}

export function formatRuleEndTime(rule: RestrictionRule): string {
  const [hourText, minuteText] = rule.endTime.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(Date.UTC(2024, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}
