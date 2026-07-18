export const TONES = [
  'sarcastic_gen_z',
  'supportive_friend',
  'direct_coach',
  'calm_neutral',
] as const;

export type Tone = (typeof TONES)[number];

export const ACCESS_PURPOSES = [
  'study',
  'work',
  'research',
  'personal',
  'urgent_work',
  'planned_task',
  'other_necessary',
] as const;

export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];

export interface RestrictionRule {
  id: string;
  domain: string;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  enabled: boolean;
  goal: string | null;
  reason: string | null;
  tone: Tone;
  maxAccessMinutes: number;
}

export type GrantKind = 'intentional_access' | 'override';

export interface AccessGrant {
  id: string;
  ruleId: string;
  domain: string;
  tabId: number | null;
  kind: GrantKind;
  purpose: AccessPurpose;
  durationMinutes: number;
  // Links session completion or expiry back to the gate/attempt that opened it.
  gateId: string | null;
  startedAt: string;
  expiresAt: string;
}

export interface PendingGate {
  id: string;
  tabId: number;
  ruleId: string;
  domain: string;
  createdAt: string;
  detectionEventId: string;
  shownEventId: string;
  reason: 'restricted_navigation' | 'access_expired';
}

export type LocalEventType =
  | 'gate_detected'
  | 'gate_shown'
  | 'returned_to_focus'
  | 'reset_started'
  | 'reset_completed'
  | 'reset_skipped'
  | 'intentional_access_started'
  | 'intentional_access_ended'
  | 'override_started'
  | 'override_completed'
  | 'access_expired';

export interface LocalEvent {
  clientEventId: string;
  occurredAt: string;
  ruleId: string;
  domain: string;
  eventType: LocalEventType;
  gateId?: string;
  metadata?: {
    durationMinutes?: number;
    purpose?: AccessPurpose;
    source: 'local_extension';
  };
}

export interface LocalConnectionState {
  mode: 'local_only' | 'paired';
  status: 'not_ready' | 'ready' | 'permission_required' | 'offline' | 'session_expired';
  serviceUrl: string | null;
  lastSyncAt: string | null;
  rulesVersion: number | null;
}

export interface RemoteCredential {
  baseUrl: string;
  deviceToken: string;
  browserId: string;
}

export interface RemoteConfig {
  rulesVersion: number;
  rules: RestrictionRule[];
  focusDestination: string | null;
}

export interface QueuedEvent {
  event: LocalEvent;
  attempts: number;
  nextAttemptAt: string;
}

export interface ExtensionSnapshot {
  rules: RestrictionRule[];
  grants: AccessGrant[];
  pendingGates: PendingGate[];
  events: LocalEvent[];
  connection: LocalConnectionState;
  focusDestination: string | null;
}

export type InterventionSource = 'ai_generated' | 'cached_ai_generated' | 'local_fallback';

export interface Intervention {
  headline: string;
  message: string;
  microAction: string;
  resetText: string;
  source: InterventionSource;
}

export type LocalIntervention = Intervention & { source: 'local_fallback' };

export interface GateContext {
  pendingGate: PendingGate | null;
  rule: RestrictionRule | null;
  intervention: Intervention;
}

export interface PopupState {
  connection: LocalConnectionState;
  activeRules: RestrictionRule[];
  activeGrants: AccessGrant[];
  pendingGateCount: number;
  eventCount: number;
  protectionPermissionGranted: boolean;
}

export type ExtensionMessage =
  | { type: 'popup:get-state' }
  | { type: 'popup:enable-protection' }
  | { type: 'popup:sync-local' }
  | { type: 'popup:pair-remote'; baseUrl: string; pairingCode: string }
  | { type: 'popup:sync-remote' }
  | { type: 'gate:bootstrap' }
  | { type: 'gate:intervention' }
  | {
      type: 'gate:action';
      action:
        | 'returned_to_focus'
        | 'reset_started'
        | 'reset_completed'
        | 'reset_skipped'
        | 'intentional_access'
        | 'override';
      purpose?: AccessPurpose;
      durationMinutes?: number;
    }
  | { type: 'access:end-early'; grantId: string };

export interface ExtensionResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
