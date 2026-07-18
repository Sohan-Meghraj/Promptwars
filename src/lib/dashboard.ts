import "server-only";

import { isRuleActive } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { ADAPTIVE_STRATEGIES } from "@/lib/extension-contract";
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
  connectedBrowser: ConnectedBrowser | null;
  metrics: {
    attempts: number;
    returnsToFocus: number;
    intentionalAccess: number;
  };
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

type RawStrategyScore = {
  domain: string;
  time_bucket: string;
  strategy: string;
  attempt_count: number;
  successful_interruptions: number;
  effectiveness_score: number | string;
};

export type StrategyInsight = {
  domain: string;
  strategy: string;
  attemptCount: number;
  successfulInterruptions: number;
  effectivenessScore: number;
};

export type InsightSnapshot = {
  attempts: number;
  returnsToFocus: number;
  intentionalAccess: number;
  bestSupportedStrategy: StrategyInsight | null;
  setupError: boolean;
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
  const [rulesResult, attemptsResult, browserResult, attemptsCount, returnsCount, accessCount] = await Promise.all([
    supabase.from("restrictions").select("*").order("updated_at", { ascending: false }),
    supabase.from("restriction_attempts").select("id, restriction_id, attempted_at, final_outcome").order("attempted_at", { ascending: false }).limit(8),
    supabase
      .from("browser_connections")
      .select("id, nickname, extension_version, last_seen_at, last_synced_at, revoked_at")
      .is("revoked_at", null)
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }),
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }).in("final_outcome", ["returned_to_focus", "reset_completed"]),
    supabase.from("access_sessions").select("id", { count: "exact", head: true }),
  ]);

  if (rulesResult.error || attemptsResult.error || browserResult.error || attemptsCount.error || returnsCount.error || accessCount.error) {
    return {
      rules: [],
      activeRules: [],
      recentActivity: [],
      connectedBrowser: null,
      metrics: { attempts: 0, returnsToFocus: 0, intentionalAccess: 0 },
      setupError: true,
    };
  }

  const rules = ((rulesResult.data ?? []) as RawRule[]).map(mapRule);
  const domainByRuleId = new Map(rules.map((rule) => [rule.id, rule.domain]));
  const recentActivity = ((attemptsResult.data ?? []) as RawAttempt[]).map((attempt) => ({
    id: attempt.id,
    domain: domainByRuleId.get(attempt.restriction_id) ?? "Restricted site",
    action: attempt.final_outcome ?? "Restriction reached",
    occurredAt: attempt.attempted_at,
  }));

  const browser = browserResult.data;
  return {
    rules,
    activeRules: rules.filter((rule) => isRuleActive(rule)),
    recentActivity,
    connectedBrowser: browser
      ? {
          id: browser.id,
          nickname: browser.nickname,
          extensionVersion: browser.extension_version,
          lastSeenAt: browser.last_seen_at,
          lastSyncedAt: browser.last_synced_at,
          revokedAt: browser.revoked_at,
        }
      : null,
    metrics: {
      attempts: attemptsCount.count ?? 0,
      returnsToFocus: returnsCount.count ?? 0,
      intentionalAccess: accessCount.count ?? 0,
    },
    setupError: false,
  };
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

export async function getInsightSnapshot(): Promise<InsightSnapshot> {
  const supabase = await createClient();
  const [attempts, returns, access, strategyScores] = await Promise.all([
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }),
    supabase.from("restriction_attempts").select("id", { count: "exact", head: true }).in("final_outcome", ["returned_to_focus", "reset_completed"]),
    supabase.from("access_sessions").select("id", { count: "exact", head: true }),
    supabase
      .from("strategy_scores")
      .select("domain, time_bucket, strategy, attempt_count, successful_interruptions, effectiveness_score")
      .gte("attempt_count", 3)
      .order("effectiveness_score", { ascending: false })
      .order("attempt_count", { ascending: false }),
  ]);
  if (attempts.error || returns.error || access.error || strategyScores.error) {
    return { attempts: 0, returnsToFocus: 0, intentionalAccess: 0, bestSupportedStrategy: null, setupError: true };
  }
  const scoreRows = (strategyScores.data ?? []) as RawStrategyScore[];
  const grouped = new Map<string, RawStrategyScore[]>();
  for (const score of scoreRows) {
    const key = `${score.domain}:${score.time_bucket}`;
    const group = grouped.get(key) ?? [];
    group.push(score);
    grouped.set(key, group);
  }
  const supportedGroups = [...grouped.values()].filter((group) => {
    const strategies = new Set(group.map((score) => score.strategy));
    return ADAPTIVE_STRATEGIES.every((strategy) => strategies.has(strategy));
  });
  const best = supportedGroups
    .flatMap((group) => group)
    .sort((left, right) => Number(right.effectiveness_score) - Number(left.effectiveness_score) || right.attempt_count - left.attempt_count)[0] ?? null;
  return {
    attempts: attempts.count ?? 0,
    returnsToFocus: returns.count ?? 0,
    intentionalAccess: access.count ?? 0,
    bestSupportedStrategy: best
      ? {
          domain: best.domain,
          strategy: best.strategy,
          attemptCount: best.attempt_count,
          successfulInterruptions: best.successful_interruptions,
          effectivenessScore: Number(best.effectiveness_score),
        }
      : null,
    setupError: false,
  };
}
