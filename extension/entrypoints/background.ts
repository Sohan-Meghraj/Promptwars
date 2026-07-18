import { matchingActiveRule, reconcileEnforcement, setGrantExpiryAlarm, setScheduleAlarm } from '../lib/enforcement';
import {
  fetchIntervention,
  fetchRemoteConfig,
  pairExtension,
  postRemoteEvent,
  RemoteRequestError,
} from '../lib/api';
import { createLocalFallback, GENERIC_FALLBACK } from '../lib/intervention';
import { findActiveRuleForDomain } from '../lib/schedule';
import {
  appendLocalEvent,
  enqueueRemoteEvent,
  getQueuedRemoteEvents,
  loadRemoteCredential,
  loadSnapshot,
  removeQueuedRemoteEvent,
  removePendingGate,
  retryQueuedRemoteEvent,
  saveGrants,
  saveRemoteConfiguration,
  setConnectionStatus,
  upsertPendingGate,
} from '../lib/storage';
import type {
  AccessGrant,
  AccessPurpose,
  ExtensionMessage,
  ExtensionResponse,
  GateContext,
  LocalEventType,
  PendingGate,
  PopupState,
  RestrictionRule,
} from '../lib/types';
import { clampDuration, isAccessPurpose, isSixDigitPairingCode, normalizeServiceUrl } from '../lib/validation';

const PENDING_GATE_DEDUPLICATION_MS = 10_000;
const ALL_SITE_ORIGINS = ['http://*/*', 'https://*/*'];
const EVENT_RETRY_ALARM = 'scrollgate:event-retry';

const pendingByTab = new Map<number, PendingGate>();
let flushPromise: Promise<Set<string>> | null = null;

function response<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}

function failure(error: string): ExtensionResponse<never> {
  return { ok: false, error };
}

function newId(): string {
  return crypto.randomUUID();
}

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildEvent(
  rule: RestrictionRule,
  eventType: LocalEventType,
  gateId?: string,
  metadata?: { durationMinutes?: number; purpose?: AccessPurpose },
  clientEventId = newId(),
) {
  return {
    clientEventId,
    occurredAt: new Date().toISOString(),
    ruleId: rule.id,
    domain: rule.domain,
    eventType,
    ...(gateId ? { gateId } : {}),
    ...(metadata
      ? {
          metadata: {
            ...metadata,
            source: 'local_extension' as const,
          },
        }
      : {}),
  };
}

async function scheduleNextEventRetry(): Promise<void> {
  const queue = await getQueuedRemoteEvents();
  if (queue.length === 0) {
    await chrome.alarms.clear(EVENT_RETRY_ALARM);
    return;
  }
  let nextAttempt = new Date(queue[0]?.nextAttemptAt ?? Date.now()).getTime();
  for (const queued of queue) {
    const candidate = new Date(queued.nextAttemptAt).getTime();
    if (candidate < nextAttempt) nextAttempt = candidate;
  }
  await chrome.alarms.create(EVENT_RETRY_ALARM, { when: Math.max(nextAttempt, Date.now() + 1_000) });
}

async function flushRemoteEvents(): Promise<Set<string>> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const delivered = new Set<string>();
    const credential = await loadRemoteCredential();
    if (!credential) return delivered;

    while (true) {
      const queue = await getQueuedRemoteEvents();
      const next = queue[0];
      if (!next) break;
      if (new Date(next.nextAttemptAt).getTime() > Date.now()) break;
      try {
        await postRemoteEvent(credential, next.event);
        await removeQueuedRemoteEvent(next.event.clientEventId);
        delivered.add(next.event.clientEventId);
      } catch (error) {
        await retryQueuedRemoteEvent(next.event.clientEventId, next.attempts + 1);
        await setConnectionStatus(
          error instanceof RemoteRequestError && (error.status === 401 || error.status === 403)
            ? 'session_expired'
            : 'offline',
        );
        break;
      }
    }
    if (delivered.size > 0) await setConnectionStatus('ready');
    await scheduleNextEventRetry();
    return delivered;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

async function recordEvent(event: ReturnType<typeof buildEvent>): Promise<void> {
  await appendLocalEvent(event);
  const credential = await loadRemoteCredential();
  if (!credential || !event.gateId || !isUuid(event.clientEventId)) return;
  await enqueueRemoteEvent(event);
  void flushRemoteEvents();
}

async function stagePendingGate(
  tabId: number,
  rule: RestrictionRule,
  reason: PendingGate['reason'],
): Promise<PendingGate> {
  const current = pendingByTab.get(tabId);
  const now = Date.now();
  if (
    current &&
    current.ruleId === rule.id &&
    now - new Date(current.createdAt).getTime() < PENDING_GATE_DEDUPLICATION_MS
  ) {
    return current;
  }

  const detectionEventId = newId();
  const pendingGate: PendingGate = {
    id: newId(),
    tabId,
    ruleId: rule.id,
    domain: rule.domain,
    createdAt: new Date(now).toISOString(),
    detectionEventId,
    shownEventId: newId(),
    reason,
  };
  pendingByTab.set(tabId, pendingGate);
  await Promise.all([
    upsertPendingGate(pendingGate),
    recordEvent(buildEvent(rule, 'gate_detected', pendingGate.id, undefined, detectionEventId)),
  ]);
  return pendingGate;
}

async function getPendingGate(tabId: number): Promise<PendingGate | null> {
  const inMemory = pendingByTab.get(tabId);
  if (inMemory) return inMemory;
  const snapshot = await loadSnapshot();
  const stored = snapshot.pendingGates.find((gate) => gate.tabId === tabId) ?? null;
  if (stored) pendingByTab.set(tabId, stored);
  return stored;
}

async function clearPendingGate(tabId: number): Promise<void> {
  pendingByTab.delete(tabId);
  await removePendingGate(tabId);
}

async function getGateContext(tabId: number | undefined): Promise<GateContext> {
  if (!isTabId(tabId)) {
    return { pendingGate: null, rule: null, intervention: GENERIC_FALLBACK };
  }
  const [pendingGate, snapshot] = await Promise.all([getPendingGate(tabId), loadSnapshot()]);
  const rule = pendingGate ? snapshot.rules.find((item) => item.id === pendingGate.ruleId) ?? null : null;

  if (pendingGate && rule) {
    await recordEvent(
      buildEvent(rule, 'gate_shown', pendingGate.id, undefined, pendingGate.shownEventId),
    );
  }
  return { pendingGate, rule, intervention: createLocalFallback(rule) };
}

async function getRemoteIntervention(tabId: number | undefined) {
  if (!isTabId(tabId)) return null;
  const [pendingGate, snapshot, credential] = await Promise.all([
    getPendingGate(tabId),
    loadSnapshot(),
    loadRemoteCredential(),
  ]);
  const rule = pendingGate ? snapshot.rules.find((item) => item.id === pendingGate.ruleId) ?? null : null;
  if (!pendingGate || !rule || !credential) return null;

  const delivered = await flushRemoteEvents();
  const queued = await getQueuedRemoteEvents();
  const detectionIsSynced =
    delivered.has(pendingGate.detectionEventId) ||
    !queued.some((item) => item.event.clientEventId === pendingGate.detectionEventId);
  if (!detectionIsSynced) return null;

  try {
    return await fetchIntervention(credential, pendingGate.id);
  } catch (error) {
    await setConnectionStatus(
      error instanceof RemoteRequestError && (error.status === 401 || error.status === 403)
        ? 'session_expired'
        : 'offline',
    );
    return null;
  }
}

async function returnToFocus(tabId: number | undefined): Promise<void> {
  if (!isTabId(tabId)) return;
  try {
    await chrome.tabs.goBack(tabId);
  } catch {
    const snapshot = await loadSnapshot();
    if (snapshot.focusDestination) {
      await chrome.tabs.update(tabId, { url: snapshot.focusDestination });
      return;
    }
    await chrome.tabs.remove(tabId);
  }
}

async function grantAccess(
  tabId: number,
  rule: RestrictionRule,
  gateId: string | undefined,
  kind: AccessGrant['kind'],
  purpose: AccessPurpose,
  durationMinutes: number,
): Promise<void> {
  const snapshot = await loadSnapshot();
  const startedAt = new Date();
  const grant: AccessGrant = {
    id: newId(),
    ruleId: rule.id,
    domain: rule.domain,
    tabId,
    kind,
    purpose,
    durationMinutes,
    gateId: gateId ?? null,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + durationMinutes * 60_000).toISOString(),
  };
  const eventType = kind === 'intentional_access' ? 'intentional_access_started' : 'override_started';
  await Promise.all([
    saveGrants([...snapshot.grants.filter((item) => item.domain !== rule.domain), grant]),
    recordEvent(buildEvent(rule, eventType, gateId, { durationMinutes, purpose })),
    clearPendingGate(tabId),
  ]);
  const updated = await loadSnapshot();
  await Promise.all([reconcileEnforcement(), setGrantExpiryAlarm(updated.grants)]);
  // Privacy by default: restore the chosen domain, not the original full URL.
  await chrome.tabs.update(tabId, { url: `https://${rule.domain}` });
}

async function expireGrantsAndRegate(): Promise<void> {
  const snapshot = await loadSnapshot();
  const now = Date.now();
  const expired = snapshot.grants.filter((grant) => new Date(grant.expiresAt).getTime() <= now);
  const remaining = snapshot.grants.filter((grant) => new Date(grant.expiresAt).getTime() > now);

  if (expired.length > 0) {
    await saveGrants(remaining);
    for (const grant of expired) {
      const rule = snapshot.rules.find((item) => item.id === grant.ruleId);
      if (!rule) continue;
      const eventType: LocalEventType = grant.kind === 'intentional_access'
        ? 'intentional_access_ended'
        : 'override_completed';
      await recordEvent(
        buildEvent(rule, eventType, grant.gateId ?? undefined, {
          durationMinutes: grant.durationMinutes,
          purpose: grant.purpose,
        }),
      );
    }
  }

  await Promise.all([reconcileEnforcement(), setGrantExpiryAlarm(remaining)]);

  for (const grant of expired) {
    const rule = snapshot.rules.find((item) => item.id === grant.ruleId);
    if (!rule || !findActiveRuleForDomain([rule], grant.domain)) continue;
    const tabs = await chrome.tabs.query({ url: [`http://*.${grant.domain}/*`, `https://*.${grant.domain}/*`] });
    for (const tab of tabs) {
      if (!isTabId(tab.id)) continue;
      await stagePendingGate(tab.id, rule, 'access_expired');
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('/gate.html') });
    }
  }
}

async function getPopupState(): Promise<PopupState> {
  const snapshot = await loadSnapshot();
  const protectionPermissionGranted = await chrome.permissions.contains({ origins: ALL_SITE_ORIGINS });
  const activeRules = snapshot.rules.filter((rule) => findActiveRuleForDomain([rule], rule.domain) !== null);
  const activeGrants = snapshot.grants.filter((grant) => new Date(grant.expiresAt).getTime() > Date.now());
  return {
    connection: snapshot.connection,
    activeRules,
    activeGrants,
    pendingGateCount: snapshot.pendingGates.length,
    eventCount: snapshot.events.length,
    protectionPermissionGranted,
  };
}

async function enableProtection(): Promise<PopupState> {
  const approved = await chrome.permissions.request({ origins: ALL_SITE_ORIGINS });
  await setConnectionStatus(approved ? 'ready' : 'permission_required');
  await reconcileEnforcement();
  const snapshot = await loadSnapshot();
  await setGrantExpiryAlarm(snapshot.grants);
  return getPopupState();
}

async function syncLocal(): Promise<PopupState> {
  const sync = await reconcileEnforcement();
  await setConnectionStatus(sync.isPermissionGranted ? 'ready' : 'permission_required');
  const snapshot = await loadSnapshot();
  await setGrantExpiryAlarm(snapshot.grants);
  return getPopupState();
}

function statusForRemoteError(error: unknown): 'offline' | 'session_expired' {
  return error instanceof RemoteRequestError && (error.status === 401 || error.status === 403)
    ? 'session_expired'
    : 'offline';
}

async function pairRemote(baseUrlInput: string, pairingCode: string): Promise<PopupState> {
  const baseUrl = normalizeServiceUrl(baseUrlInput);
  if (!baseUrl) throw new Error('Enter a valid HTTPS service URL, or http://localhost for local development.');
  if (!isSixDigitPairingCode(pairingCode)) throw new Error('Enter the six-digit pairing code from ScrollGate.');

  const approved = await chrome.permissions.request({ origins: ALL_SITE_ORIGINS });
  if (!approved) {
    await setConnectionStatus('permission_required');
    throw new Error('Site access is required before ScrollGate can enforce synchronized rules.');
  }

  try {
    const paired = await pairExtension(baseUrl, pairingCode);
    await saveRemoteConfiguration(paired.credential, paired.config);
    const snapshot = await loadSnapshot();
    await Promise.all([
      reconcileEnforcement(),
      setGrantExpiryAlarm(snapshot.grants),
      scheduleNextEventRetry(),
    ]);
    void flushRemoteEvents();
    return getPopupState();
  } catch (error) {
    await setConnectionStatus(statusForRemoteError(error));
    throw error;
  }
}

async function syncRemote(): Promise<PopupState> {
  const credential = await loadRemoteCredential();
  if (!credential) throw new Error('Pair this extension before syncing.');
  try {
    const config = await fetchRemoteConfig(credential);
    await saveRemoteConfiguration(credential, config);
    const snapshot = await loadSnapshot();
    await Promise.all([
      reconcileEnforcement(),
      setGrantExpiryAlarm(snapshot.grants),
      scheduleNextEventRetry(),
    ]);
    void flushRemoteEvents();
    return getPopupState();
  } catch (error) {
    await setConnectionStatus(statusForRemoteError(error));
    throw error;
  }
}

async function endAccessEarly(grantId: string): Promise<void> {
  const snapshot = await loadSnapshot();
  const grant = snapshot.grants.find((item) => item.id === grantId);
  if (!grant) return;
  const rule = snapshot.rules.find((item) => item.id === grant.ruleId);
  const grants = snapshot.grants.filter((item) => item.id !== grantId);
  await saveGrants(grants);
  if (rule) {
    await recordEvent(
      buildEvent(
        rule,
        grant.kind === 'intentional_access' ? 'intentional_access_ended' : 'override_completed',
        grant.gateId ?? undefined,
        {
          durationMinutes: grant.durationMinutes,
          purpose: grant.purpose,
        },
      ),
    );
  }
  await Promise.all([reconcileEnforcement(), setGrantExpiryAlarm(grants)]);
  if (isTabId(grant.tabId)) {
    const activeRule = rule && findActiveRuleForDomain([rule], grant.domain);
    if (activeRule) {
      await stagePendingGate(grant.tabId, activeRule, 'access_expired');
      await chrome.tabs.update(grant.tabId, { url: chrome.runtime.getURL('/gate.html') });
    }
  }
}

async function handleGateAction(
  message: Extract<ExtensionMessage, { type: 'gate:action' }>,
  tabId: number | undefined,
): Promise<ExtensionResponse<null>> {
  if (!isTabId(tabId)) return failure('This gate is not associated with a browser tab.');
  const [pendingGate, snapshot] = await Promise.all([getPendingGate(tabId), loadSnapshot()]);
  const rule = pendingGate ? snapshot.rules.find((item) => item.id === pendingGate.ruleId) ?? null : null;
  if (!pendingGate || !rule) return failure('This restriction is no longer available.');

  if (message.action === 'returned_to_focus') {
    await Promise.all([
      recordEvent(buildEvent(rule, 'returned_to_focus', pendingGate.id)),
      clearPendingGate(tabId),
    ]);
    await returnToFocus(tabId);
    return response(null);
  }

  if (message.action === 'reset_started' || message.action === 'reset_completed' || message.action === 'reset_skipped') {
    await recordEvent(buildEvent(rule, message.action, pendingGate.id));
    if (message.action === 'reset_completed') {
      await clearPendingGate(tabId);
      await returnToFocus(tabId);
    }
    return response(null);
  }

  if (!isAccessPurpose(message.purpose)) return failure('Choose a purpose before allowing access.');
  const duration = clampDuration(message.durationMinutes, rule.maxAccessMinutes);
  if (!duration) return failure('Choose a valid access duration.');

  await grantAccess(
    tabId,
    rule,
    pendingGate.id,
    message.action === 'intentional_access' ? 'intentional_access' : 'override',
    message.purpose,
    duration,
  );
  return response(null);
}

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse<unknown>> {
  switch (message.type) {
    case 'popup:get-state':
      return response(await getPopupState());
    case 'popup:enable-protection':
      return response(await enableProtection());
    case 'popup:sync-local':
      return response(await syncLocal());
    case 'popup:pair-remote':
      return response(await pairRemote(message.baseUrl, message.pairingCode));
    case 'popup:sync-remote':
      return response(await syncRemote());
    case 'gate:bootstrap':
      return response(await getGateContext(sender.tab?.id));
    case 'gate:intervention':
      return response(await getRemoteIntervention(sender.tab?.id));
    case 'gate:action':
      return handleGateAction(message, sender.tab?.id);
    case 'access:end-early':
      await endAccessEarly(message.grantId);
      return response(null);
    default:
      return failure('Unsupported extension message.');
  }
}

export default defineBackground(() => {
  const initialize = async () => {
    await setScheduleAlarm();
    await expireGrantsAndRegate();
    await scheduleNextEventRetry();
    void flushRemoteEvents();
  };

  void initialize();
  chrome.runtime.onInstalled.addListener(() => void initialize());
  chrome.runtime.onStartup.addListener(() => void initialize());

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0 || !details.url.startsWith('http')) return;
    let hostname: string;
    try {
      hostname = new URL(details.url).hostname.toLowerCase();
    } catch {
      return;
    }
    void loadSnapshot().then((snapshot) => {
      const rule = matchingActiveRule(snapshot.rules, snapshot.grants, hostname);
      if (rule) return stagePendingGate(details.tabId, rule, 'restricted_navigation');
      return undefined;
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    pendingByTab.delete(tabId);
    void removePendingGate(tabId);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'scrollgate:reconcile') void expireGrantsAndRegate();
    if (alarm.name === 'scrollgate:grant-expiry') void expireGrantsAndRegate();
    if (alarm.name === EVENT_RETRY_ALARM) void flushRemoteEvents();
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handleMessage(message as ExtensionMessage, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unexpected extension error.';
        sendResponse(failure(detail));
      });
    return true;
  });
});
