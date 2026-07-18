import { z } from "zod";

import { STRATEGIES, TONES } from "@/lib/types";

const hostnamePattern = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDomain(input: string): string | null {
  const candidate = input.trim().toLowerCase().replace(/^www\./, "");
  if (!candidate || candidate.includes("@") || candidate.includes("/")) {
    return null;
  }

  const withoutTrailingDot = candidate.replace(/\.$/, "");
  return hostnamePattern.test(withoutTrailingDot) ? withoutTrailingDot : null;
}

export const restrictionInputSchema = z.object({
  domain: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const domain = normalizeDomain(value);
      if (!domain) {
        ctx.addIssue({ code: "custom", message: "Enter a valid domain such as youtube.com." });
        return z.NEVER;
      }
      return domain;
    }),
  goal: z.string().trim().min(2).max(240),
  reason: z.string().trim().min(2).max(320),
  tone: z.enum(TONES),
  timezone: z.string().trim().min(1).max(100),
  activeDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  maxAccessMinutes: z.number().int().min(1).max(60),
  enabled: z.boolean().default(true),
});

export const interventionSchema = z.object({
  headline: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(280),
  microAction: z.string().trim().min(1).max(144),
  resetText: z.string().trim().min(1).max(280).optional(),
  strategy: z.enum(STRATEGIES),
  tone: z.enum(TONES),
  source: z.enum(["ai_generated", "cached_ai_generated", "local_fallback"]),
});

export const extensionEventSchema = z.object({
  clientEventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  ruleId: z.string().uuid(),
  gateId: z.string().uuid().optional(),
  domain: z.string().refine((value) => normalizeDomain(value) !== null, "Invalid domain"),
  eventType: z.enum([
    "gate_detected",
    "gate_shown",
    "returned_to_focus",
    "reset_started",
    "reset_completed",
    "reset_skipped",
    "intentional_access_started",
    "intentional_access_ended",
    "access_expired",
    "override_started",
    "override_completed",
  ]),
  metadata: z
    .object({
      durationMinutes: z.number().int().min(1).max(60).optional(),
      purpose: z.enum(["study", "work", "research", "personal", "urgent_work", "planned_task", "other_necessary"]).optional(),
      source: z.literal("local_extension"),
    })
    .optional(),
});

export const createPairingCodeSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(80).optional(),
});

export const pairExtensionSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  deviceLabel: z.string().trim().min(1).max(80),
  browserFamily: z.literal("chromium"),
  extensionVersion: z.string().trim().min(1).max(80),
});

export const interventionRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

export const profileInputSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  defaultTone: z.enum(TONES),
  focusDestination: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https:\/\/[^\s]+$/i.test(value), "Use an HTTPS URL or leave this blank."),
});

export type RestrictionInput = z.infer<typeof restrictionInputSchema>;
export type ExtensionEventInput = z.infer<typeof extensionEventSchema>;
