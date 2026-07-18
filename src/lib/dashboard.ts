import "server-only";

import { isRuleActive } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import type { RestrictionRule, Tone } from "@/lib/types";

type RawRule = {
  id: string;
  domain: string;
  goal: string;
  reason: string;
  tone: Tone;
  timezone: string;
  active_days: number[];
  start_time: string;
  end_time: string;
  max_temporary_access_minutes: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type RawAttempt = {
  id: string;
  restriction_id: string;
  attempted_at: string;
  final_outcome: string | null;
};

export type RecentActivity = {
  id: string;
  domain: string;
  action: string;
  occurredAt: string;
};

export type TodayDashboard = {
  rules: RestrictionRule[];
  activeRules: RestrictionRule[];
  recentActivity: RecentActivity[];
  setupError: boolean;
};

export type ConnectedBrowser = {
  id: string;
  nickname: string;
  extensionVersion: string | null;
  lastSeenAt: string | null;
  lastSyncedAt: string | null;
  revokedAt: string | null;
};

export type ProfileSettings = {
  timezone: string;
  defaultTone: Tone;
  focusDestination: string | null;
};

function mapRule(row: RawRule): RestrictionRule {
  return {
    id: row.id,
    domain: row.domain,
    displayName: null,
    goal: row.goal,
    reason: row.reason,
    tone: row.tone,
    timezone: row.timezone,
    activeDays: row.active_days,
    startTime: row.start_time,
    endTime: row.end_time,
    maxAccessMinutes: row.max_temporary_access_minutes,
    enabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTodayDashboard(): Promise<TodayDashboard> {
  const supabase = await createClient();
  const [rulesResult, attemptsResult] = await Promise.all([
    supabase.from("restrictions").select("*").order("updated_at", { ascending: false }),
    supabase.from("restriction_attempts").select("id, restriction_id, attempted_at, final_outcome").order("attempted_at", { ascending: false }).limit(8),
  ]);

  if (rulesResult.error || attemptsResult.error) {
    return { rules: [], activeRules: [], recentActivity: [], setupError: true };
  }

  const rules = ((rulesResult.data ?? []) as RawRule[]).map(mapRule);
  const domainByRuleId = new Map(rules.map((rule) => [rule.id, rule.domain]));
  const recentActivity = ((attemptsResult.data ?? []) as RawAttempt[]).map((attempt) => ({
    id: attempt.id,
    domain: domainByRuleId.get(attempt.restriction_id) ?? "Restricted site",
    action: attempt.final_outcome ?? "Restriction reached",
    occurredAt: attempt.attempted_at,
  }));

  return { rules, activeRules: rules.filter((rule) => isRuleActive(rule)), recentActivity, setupError: false };
}

export async function getConnectedBrowsers(): Promise<{ browsers: ConnectedBrowser[]; setupError: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("browser_connections")
    .select("id, nickname, extension_version, last_seen_at, last_synced_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return { browsers: [], setupError: true };
  return {
    browsers: (data ?? []).map((row) => ({
      id: row.id,
      nickname: row.nickname,
      extensionVersion: row.extension_version,
      lastSeenAt: row.last_seen_at,
      lastSyncedAt: row.last_synced_at,
      revokedAt: row.revoked_at,
    })),
    setupError: false,
  };
}

export async function getProfileSettings(): Promise<{ settings: ProfileSettings | null; setupError: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("timezone, default_tone, focus_destination")
    .maybeSingle();
  if (error || !data) return { settings: null, setupError: true };
  return {
    settings: {
      timezone: data.timezone,
      defaultTone: data.default_tone as Tone,
      focusDestination: data.focus_destination,
    },
    setupError: false,
  };
}

export async function getInsightSnapshot(): Promise<{ attempts: number; returnsToFocus: number; intentionalAccess: number; setupError: boolean }> {
  const supabase = await createClient();
  const [attempts, returns, access] = await Promise.all([
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }),
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }).eq("final_outcome", "returned_to_focus"),
    supabase.from("access_sessions").select("id", { count: "exact", head: true }),
  ]);
  if (attempts.error || returns.error || access.error) return { attempts: 0, returnsToFocus: 0, intentionalAccess: 0, setupError: true };
  return { attempts: attempts.count ?? 0, returnsToFocus: returns.count ?? 0, intentionalAccess: access.count ?? 0, setupError: false };
}
