export const TONES = [
  "sarcastic_gen_z",
  "supportive_friend",
  "direct_coach",
  "calm_neutral",
] as const;

export type Tone = (typeof TONES)[number];

export const STRATEGIES = [
  "deadline_reminder",
  "goal_reminder",
  "time_remaining_reminder",
  "previous_commitment_reminder",
  "attempt_count_observation",
  "next_action_prompt",
  "environment_change_prompt",
  "cost_of_distraction_reminder",
  "progress_reinforcement",
  "humor_only_interruption",
  "intentionality_question",
] as const;

export type Strategy = (typeof STRATEGIES)[number];

export type RestrictionRule = {
  id: string;
  domain: string;
  displayName: string | null;
  goal: string;
  reason: string;
  tone: Tone;
  timezone: string;
  activeDays: number[];
  startTime: string;
  endTime: string;
  maxAccessMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GateIntervention = {
  headline: string;
  message: string;
  microAction: string;
  resetText?: string;
  strategy: Strategy;
  tone: Tone;
  source: "ai_generated" | "cached_ai_generated" | "local_fallback";
};

export type ExtensionRule = {
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
