import "server-only";

import type { Strategy, Tone } from "@/lib/types";

export type DatabaseRestriction = {
  id: string;
  domain: string;
  active_days: number[];
  start_time: string;
  end_time: string;
  timezone: string;
  is_enabled: boolean;
  goal: string;
  reason: string;
  tone: Tone;
  max_temporary_access_minutes: number;
};

export type ExtensionRestriction = {
  id: string;
  domain: string;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  enabled: boolean;
  goal: string;
  reason: string;
  tone: Tone;
  maxAccessMinutes: number;
};

export type LocalExtensionEventType =
  | "gate_detected"
  | "gate_shown"
  | "returned_to_focus"
  | "reset_started"
  | "reset_completed"
  | "reset_skipped"
  | "intentional_access_started"
  | "intentional_access_ended"
  | "override_started"
  | "override_completed"
  | "access_expired";

export function toExtensionRestriction(rule: DatabaseRestriction): ExtensionRestriction {
  return {
    id: rule.id,
    domain: rule.domain,
    days: rule.active_days,
    startTime: rule.start_time.slice(0, 5),
    endTime: rule.end_time.slice(0, 5),
    timezone: rule.timezone,
    enabled: rule.is_enabled,
    goal: rule.goal,
    reason: rule.reason,
    tone: rule.tone,
    maxAccessMinutes: rule.max_temporary_access_minutes,
  };
}

export function eventTypeForDatabase(eventType: LocalExtensionEventType): string {
  const eventTypes: Record<LocalExtensionEventType, string> = {
    gate_detected: "attempt_created",
    gate_shown: "gate_shown",
    returned_to_focus: "return_to_focus",
    reset_started: "reset_started",
    reset_completed: "reset_completed",
    reset_skipped: "reset_skipped",
    intentional_access_started: "intentional_access_granted",
    intentional_access_ended: "intentional_access_expired",
    override_started: "override_started",
    override_completed: "override_confirmed",
    access_expired: "intentional_access_expired",
  };
  return eventTypes[eventType];
}

export function outcomeForEvent(eventType: LocalExtensionEventType): string | null {
  const outcomes: Partial<Record<LocalExtensionEventType, string>> = {
    returned_to_focus: "returned_to_focus",
    reset_completed: "reset_completed",
    reset_skipped: "reset_skipped",
    intentional_access_started: "intentional_access_granted",
    override_completed: "override_confirmed",
  };
  return outcomes[eventType] ?? null;
}

export function chooseInitialStrategy(attemptNumber: number): Strategy {
  const cycle: Strategy[] = [
    "goal_reminder",
    "next_action_prompt",
    "intentionality_question",
    "time_remaining_reminder",
  ];
  return cycle[Math.max(0, attemptNumber - 1) % cycle.length];
}

export function getLocalHour(timezone: string): number {
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date()).find((part) => part.type === "hour")?.value;
    const hour = Number(value);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : new Date().getUTCHours();
  } catch {
    return new Date().getUTCHours();
  }
}
