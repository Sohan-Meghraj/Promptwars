import {
  ACCESS_PURPOSES,
  type AccessPurpose,
  type Intervention,
  type RemoteConfig,
  type RestrictionRule,
  TONES,
  type Tone,
} from './types';

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(CONTROL_CHARACTERS, '').trim();
  return clean.length > 0 ? clean.slice(0, maxLength) : null;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLowerCase().replace(/^\*\./, '');
  if (!input || input.includes('/') || input.includes('@') || input.includes(':')) return null;
  const domain = input.replace(/^www\./, '');
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

export function isAccessPurpose(value: unknown): value is AccessPurpose {
  return typeof value === 'string' && ACCESS_PURPOSES.includes(value as AccessPurpose);
}

function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && TONES.includes(value as Tone);
}

function isSupportedTimeZone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseRestrictionRule(value: unknown): RestrictionRule | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const id = asBoundedText(raw.id, 128);
  const domain = normalizeDomain(raw.domain);
  const startTime = asBoundedText(raw.startTime, 5);
  const endTime = asBoundedText(raw.endTime, 5);
  const timezone = asBoundedText(raw.timezone, 128);
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const rawMaxMinutes = Number(raw.maxAccessMinutes);

  if (
    !id ||
    !domain ||
    !startTime ||
    !endTime ||
    !TIME_PATTERN.test(startTime) ||
    !TIME_PATTERN.test(endTime) ||
    !timezone ||
    !isSupportedTimeZone(timezone) ||
    days.length === 0 ||
    !Number.isFinite(rawMaxMinutes)
  ) {
    return null;
  }

  return {
    id,
    domain,
    days,
    startTime,
    endTime,
    timezone,
    enabled: raw.enabled === true,
    goal: asBoundedText(raw.goal, 500),
    reason: asBoundedText(raw.reason, 500),
    tone: isTone(raw.tone) ? raw.tone : 'calm_neutral',
    maxAccessMinutes: Math.min(Math.max(Math.floor(rawMaxMinutes), 1), 120),
  };
}

export function parseRestrictionRules(value: unknown): RestrictionRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = parseRestrictionRule(item);
    return parsed ? [parsed] : [];
  });
}

export function clampDuration(value: unknown, maximum: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, maximum);
}

export function normalizeServiceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !isLocalHttp) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSixDigitPairingCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

function normalizeFocusDestination(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 1_500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseRemoteConfig(value: unknown): RemoteConfig | null {
  const raw = asRecord(value);
  if (!raw || !isInteger(raw.rulesVersion) || raw.rulesVersion < 0 || !Array.isArray(raw.rules)) {
    return null;
  }
  const rules = parseRestrictionRules(raw.rules);
  if (rules.length !== raw.rules.length) return null;
  const focusDestination = normalizeFocusDestination(raw.focusDestination);
  if (raw.focusDestination !== null && raw.focusDestination !== undefined && !focusDestination) return null;
  return { rulesVersion: raw.rulesVersion, rules, focusDestination };
}

export function parseRemoteIntervention(value: unknown): Intervention | null {
  const raw = asRecord(value);
  const intervention = asRecord(raw?.intervention);
  if (!intervention || !isTone(intervention.tone)) return null;
  const source = intervention.source;
  if (source !== 'ai_generated' && source !== 'cached_ai_generated' && source !== 'local_fallback') return null;
  const headline = asBoundedText(intervention.headline, 120);
  const message = asBoundedText(intervention.message, 500);
  const microAction = asBoundedText(intervention.microAction, 180);
  if (!headline || !message || !microAction) return null;
  return {
    headline,
    message,
    microAction,
    resetText:
      asBoundedText(intervention.resetText, 300) ??
      'Take one slow breath, then choose the smallest next step in your task.',
    source,
  };
}
