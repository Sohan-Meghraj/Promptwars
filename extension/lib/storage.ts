import {
  type AccessGrant,
  type ExtensionSnapshot,
  type LocalConnectionState,
  type LocalEvent,
  type PendingGate,
  type QueuedEvent,
  type RemoteConfig,
  type RemoteCredential,
  type RestrictionRule,
} from './types';
import { isAccessPurpose, normalizeServiceUrl, parseRestrictionRules } from './validation';

const STORAGE_KEYS = {
  rules: 'scrollgate.rules.v1',
  grants: 'scrollgate.grants.v1',
  pendingGates: 'scrollgate.pending-gates.v1',
  events: 'scrollgate.events.v1',
  connection: 'scrollgate.connection.v1',
  focusDestination: 'scrollgate.focus-destination.v1',
  remoteCredential: 'scrollgate.remote-credential.v1',
  remoteEventQueue: 'scrollgate.remote-event-queue.v1',
} as const;

const DEFAULT_CONNECTION: LocalConnectionState = {
  mode: 'local_only',
  status: 'not_ready',
  serviceUrl: null,
  lastSyncAt: null,
  rulesVersion: null,
};

const MAX_PENDING_GATES = 100;
const MAX_LOCAL_EVENTS = 1_000;
export const MAX_REMOTE_EVENTS = 500;
export const MAX_REMOTE_EVENT_ATTEMPTS = 8;

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function legacyEventId(gateId: unknown, ordinal: 0 | 1): string {
  if (!isUuid(gateId)) return crypto.randomUUID();
  const first = gateId[0] ?? '0';
  const replacement = ordinal === 0
    ? first === 'f' ? 'e' : 'f'
    : first === 'd' || first === 'f' ? 'c' : 'd';
  return `${replacement}${gateId.slice(1)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

function parsePendingGates(value: unknown): PendingGate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const id = raw?.id;
    const tabId = raw?.tabId;
    const ruleId = raw?.ruleId;
    const domain = raw?.domain;
    const createdAt = parseDate(raw?.createdAt);
    const detectionEventId = raw?.detectionEventId;
    const shownEventId = raw?.shownEventId;
    const reason = raw?.reason;
    if (
      typeof id !== 'string' ||
      !isInteger(tabId) ||
      typeof ruleId !== 'string' ||
      typeof domain !== 'string' ||
      !createdAt ||
      (reason !== 'restricted_navigation' && reason !== 'access_expired')
    ) {
      return [];
    }
    return [{
      id,
      tabId,
      ruleId,
      domain,
      createdAt,
      detectionEventId: isUuid(detectionEventId) ? detectionEventId : legacyEventId(id, 0),
      shownEventId: isUuid(shownEventId) ? shownEventId : legacyEventId(id, 1),
      reason,
    }];
  });
}

function parseGrants(value: unknown): AccessGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    if (!raw) return [];
    const id = raw.id;
    const ruleId = raw.ruleId;
    const domain = raw.domain;
    const tabId = raw.tabId;
    const kind = raw.kind;
    const purpose = raw.purpose;
    const durationMinutes = raw.durationMinutes;
    const gateId = raw.gateId;
    const startedAt = parseDate(raw.startedAt);
    const expiresAt = parseDate(raw.expiresAt);
    if (
      typeof id !== 'string' ||
      typeof ruleId !== 'string' ||
      typeof domain !== 'string' ||
      (tabId !== null && !isInteger(tabId)) ||
      (kind !== 'intentional_access' && kind !== 'override') ||
      typeof purpose !== 'string' ||
      !isAccessPurpose(purpose) ||
      !isInteger(durationMinutes) ||
      (gateId !== null && gateId !== undefined && typeof gateId !== 'string') ||
      !startedAt ||
      !expiresAt
    ) {
      return [];
    }
    return [
      {
        id,
        ruleId,
        domain,
        tabId,
        kind,
        purpose,
        durationMinutes,
        gateId: typeof gateId === 'string' ? gateId : null,
        startedAt,
        expiresAt,
      },
    ];
  });
}

function parseEvents(value: unknown): LocalEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const clientEventId = raw?.clientEventId;
    const occurredAt = parseDate(raw?.occurredAt);
    const ruleId = raw?.ruleId;
    const domain = raw?.domain;
    const eventType = raw?.eventType;
    if (
      typeof clientEventId !== 'string' ||
      !occurredAt ||
      typeof ruleId !== 'string' ||
      typeof domain !== 'string' ||
      typeof eventType !== 'string'
    ) {
      return [];
    }
    return [item as LocalEvent];
  });
}

function parseConnection(value: unknown): LocalConnectionState {
  const raw = asRecord(value);
  if (!raw || (raw.mode !== 'local_only' && raw.mode !== 'paired')) return DEFAULT_CONNECTION;
  const status = raw.status;
  if (
    status !== 'not_ready' &&
    status !== 'ready' &&
    status !== 'permission_required' &&
    status !== 'offline' &&
    status !== 'session_expired'
  ) {
    return DEFAULT_CONNECTION;
  }
  const serviceUrl = raw.mode === 'paired' ? normalizeServiceUrl(raw.serviceUrl) : null;
  if (raw.mode === 'paired' && !serviceUrl) return DEFAULT_CONNECTION;
  return {
    mode: raw.mode,
    status,
    serviceUrl,
    lastSyncAt: parseDate(raw.lastSyncAt),
    rulesVersion: Number.isInteger(raw.rulesVersion) ? (raw.rulesVersion as number) : null,
  };
}

function parseCredential(value: unknown): RemoteCredential | null {
  const raw = asRecord(value);
  const baseUrl = normalizeServiceUrl(raw?.baseUrl);
  const deviceToken = typeof raw?.deviceToken === 'string' ? raw.deviceToken.trim() : '';
  const browserId = typeof raw?.browserId === 'string' ? raw.browserId.trim() : '';
  if (!baseUrl || !deviceToken || deviceToken.length > 4_096 || !browserId || browserId.length > 256) {
    return null;
  }
  return { baseUrl, deviceToken, browserId };
}

function parseQueuedEvents(value: unknown): QueuedEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const event = parseEvents([raw?.event])[0];
    const attempts = raw?.attempts;
    const nextAttemptAt = parseDate(raw?.nextAttemptAt);
    if (!event || !event.gateId || !isInteger(attempts) || attempts < 0 || !nextAttemptAt) return [];
    return [{ event, attempts, nextAttemptAt }];
  }).slice(-MAX_REMOTE_EVENTS);
}

export async function loadSnapshot(): Promise<ExtensionSnapshot> {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const focusDestination = stored[STORAGE_KEYS.focusDestination];
  return {
    rules: parseRestrictionRules(stored[STORAGE_KEYS.rules]),
    grants: parseGrants(stored[STORAGE_KEYS.grants]),
    pendingGates: parsePendingGates(stored[STORAGE_KEYS.pendingGates]),
    events: parseEvents(stored[STORAGE_KEYS.events]),
    connection: parseConnection(stored[STORAGE_KEYS.connection]),
    focusDestination: typeof focusDestination === 'string' ? focusDestination : null,
  };
}

export async function saveRules(rules: RestrictionRule[], version?: number): Promise<void> {
  const current = await loadSnapshot();
  await chrome.storage.local.set({
    [STORAGE_KEYS.rules]: rules,
    [STORAGE_KEYS.connection]: {
      ...current.connection,
      status: 'ready',
      lastSyncAt: new Date().toISOString(),
      rulesVersion: version ?? current.connection.rulesVersion,
    } satisfies LocalConnectionState,
  });
}

export async function saveRemoteConfiguration(
  credential: RemoteCredential,
  config: RemoteConfig,
): Promise<void> {
  const connection: LocalConnectionState = {
    mode: 'paired',
    status: 'ready',
    serviceUrl: credential.baseUrl,
    lastSyncAt: new Date().toISOString(),
    rulesVersion: config.rulesVersion,
  };
  await chrome.storage.local.set({
    [STORAGE_KEYS.remoteCredential]: credential,
    [STORAGE_KEYS.rules]: config.rules,
    [STORAGE_KEYS.focusDestination]: config.focusDestination,
    [STORAGE_KEYS.connection]: connection,
  });
}

export async function loadRemoteCredential(): Promise<RemoteCredential | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.remoteCredential);
  return parseCredential(stored[STORAGE_KEYS.remoteCredential]);
}

export async function saveGrants(grants: AccessGrant[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.grants]: grants });
}

export async function savePendingGates(pendingGates: PendingGate[]): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.pendingGates]: pendingGates.slice(-MAX_PENDING_GATES),
  });
}

export async function upsertPendingGate(pendingGate: PendingGate): Promise<void> {
  const snapshot = await loadSnapshot();
  const withoutCurrentTab = snapshot.pendingGates.filter((gate) => gate.tabId !== pendingGate.tabId);
  await savePendingGates([...withoutCurrentTab, pendingGate]);
}

export async function removePendingGate(tabId: number): Promise<void> {
  const snapshot = await loadSnapshot();
  await savePendingGates(snapshot.pendingGates.filter((gate) => gate.tabId !== tabId));
}

let eventWrite = Promise.resolve();

export function appendLocalEvent(event: LocalEvent): Promise<void> {
  const write = eventWrite.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.events);
    const events = parseEvents(stored[STORAGE_KEYS.events]);
    if (events.some((item) => item.clientEventId === event.clientEventId)) return;
    await chrome.storage.local.set({
      [STORAGE_KEYS.events]: [...events, event].slice(-MAX_LOCAL_EVENTS),
    });
  });
  eventWrite = write.catch(() => undefined);
  return write;
}

let queueWrite = Promise.resolve();

export function enqueueRemoteEvent(event: LocalEvent): Promise<void> {
  if (!event.gateId) return Promise.resolve();
  const write = queueWrite.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.remoteEventQueue);
    const queue = parseQueuedEvents(stored[STORAGE_KEYS.remoteEventQueue]);
    if (queue.some((item) => item.event.clientEventId === event.clientEventId)) return;
    await chrome.storage.local.set({
      [STORAGE_KEYS.remoteEventQueue]: [
        ...queue,
        { event, attempts: 0, nextAttemptAt: new Date().toISOString() },
      ].slice(-MAX_REMOTE_EVENTS),
    });
  });
  queueWrite = write.catch(() => undefined);
  return write;
}

export async function getQueuedRemoteEvents(): Promise<QueuedEvent[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.remoteEventQueue);
  return parseQueuedEvents(stored[STORAGE_KEYS.remoteEventQueue]);
}

export function removeQueuedRemoteEvent(clientEventId: string): Promise<void> {
  const write = queueWrite.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.remoteEventQueue);
    const queue = parseQueuedEvents(stored[STORAGE_KEYS.remoteEventQueue]);
    await chrome.storage.local.set({
      [STORAGE_KEYS.remoteEventQueue]: queue.filter((item) => item.event.clientEventId !== clientEventId),
    });
  });
  queueWrite = write.catch(() => undefined);
  return write;
}

export function retryQueuedRemoteEvent(clientEventId: string, attempts: number): Promise<void> {
  const boundedAttempts = Math.min(Math.max(attempts, 0), MAX_REMOTE_EVENT_ATTEMPTS);
  const backoffMs = Math.min(5_000 * 2 ** Math.min(boundedAttempts, 6), 5 * 60_000);
  const write = queueWrite.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.remoteEventQueue);
    const queue = parseQueuedEvents(stored[STORAGE_KEYS.remoteEventQueue]);
    const next = queue.map((item) =>
        item.event.clientEventId === clientEventId
        ? { ...item, attempts: boundedAttempts, nextAttemptAt: new Date(Date.now() + backoffMs).toISOString() }
        : item,
    );
    await chrome.storage.local.set({ [STORAGE_KEYS.remoteEventQueue]: next });
  });
  queueWrite = write.catch(() => undefined);
  return write;
}

export async function setConnectionStatus(
  status: LocalConnectionState['status'],
): Promise<LocalConnectionState> {
  const snapshot = await loadSnapshot();
  const next: LocalConnectionState = {
    ...snapshot.connection,
    status,
    lastSyncAt: status === 'ready' ? new Date().toISOString() : snapshot.connection.lastSyncAt,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.connection]: next });
  return next;
}
