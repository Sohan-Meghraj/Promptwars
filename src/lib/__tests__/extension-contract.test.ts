import { describe, expect, it } from "vitest";

import {
  chooseAdaptiveStrategy,
  timeBucketForHour,
  type StrategyScore,
} from "../extension-contract";

const strategies: StrategyScore[] = [
  { strategy: "goal_reminder", attemptCount: 3, successfulInterruptions: 1, effectivenessScore: 0.34 },
  { strategy: "next_action_prompt", attemptCount: 3, successfulInterruptions: 1, effectivenessScore: 0.34 },
  { strategy: "intentionality_question", attemptCount: 3, successfulInterruptions: 1, effectivenessScore: 0.34 },
  { strategy: "time_remaining_reminder", attemptCount: 3, successfulInterruptions: 1, effectivenessScore: 0.34 },
];

describe("timeBucketForHour", () => {
  it.each([
    [0, "late_night"],
    [5, "late_night"],
    [6, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ] as const)("maps %i:00 to %s", (hour, expected) => {
    expect(timeBucketForHour(hour)).toBe(expected);
  });
});

describe("chooseAdaptiveStrategy", () => {
  it("rotates through every strategy while gathering initial evidence", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => chooseAdaptiveStrategy(attempt, []))).toEqual([
      "goal_reminder",
      "next_action_prompt",
      "intentionality_question",
      "time_remaining_reminder",
      "goal_reminder",
    ]);
  });

  it("continues sampling a strategy until it has at least three outcomes", () => {
    const underSampled = strategies.map((score) =>
      score.strategy === "next_action_prompt" ? { ...score, attemptCount: 2 } : score,
    );

    expect(chooseAdaptiveStrategy(9, underSampled)).toBe("next_action_prompt");
  });

  it("selects the most effective strategy only after every strategy has enough evidence", () => {
    const scored = strategies.map((score) =>
      score.strategy === "intentionality_question"
        ? { ...score, successfulInterruptions: 3, effectivenessScore: 1 }
        : score,
    );

    expect(chooseAdaptiveStrategy(13, scored)).toBe("intentionality_question");
  });

  it("breaks effectiveness ties by successful interruptions, sample size, then the stable cycle order", () => {
    const tied = strategies.map((score) => ({ ...score, effectivenessScore: 0.5 }));
    tied[1] = { ...tied[1]!, successfulInterruptions: 2 };
    tied[2] = { ...tied[2]!, successfulInterruptions: 2, attemptCount: 4 };

    expect(chooseAdaptiveStrategy(16, tied)).toBe("intentionality_question");
    expect(chooseAdaptiveStrategy(16, strategies.map((score) => ({ ...score, effectivenessScore: 0.5 })))).toBe("goal_reminder");
  });
});
