import { NextResponse } from "next/server";

import { getExtensionConnection, isExtensionServerConfigured } from "@/lib/extension-auth";
import {
  chooseAdaptiveStrategy,
  eventTypeForDatabase,
  getLocalHour,
  outcomeForEvent,
  timeBucketForHour,
  type DatabaseRestriction,
  type StrategyScore,
} from "@/lib/extension-contract";
import { extensionEventSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RestrictionAttempt = {
  id: string;
  restriction_id: string;
  strategy: string;
};

type StrategyScoreRow = {
  strategy: StrategyScore["strategy"];
  attempt_count: number;
  successful_interruptions: number;
  effectiveness_score: number | string;
};

async function findAttempt(
  connectionId: string,
  userId: string,
  attemptId: string,
): Promise<RestrictionAttempt | null> {
  const { data, error } = await createAdminClient()
    .from("restriction_attempts")
    .select("id, restriction_id, strategy")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .eq("browser_connection_id", connectionId)
    .maybeSingle();
  return error || !data ? null : (data as RestrictionAttempt);
}

export async function POST(request: Request) {
  if (!isExtensionServerConfigured()) {
    return NextResponse.json({ error: "Extension event sync has not been configured yet." }, { status: 503 });
  }
  const connection = await getExtensionConnection(request);
  if (!connection) return NextResponse.json({ error: "Unauthorized browser connection." }, { status: 401 });

  const parsed = extensionEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid extension event." }, { status: 400 });
  const event = parsed.data;
  const admin = createAdminClient();

  const { data: restriction, error: restrictionError } = await admin
    .from("restrictions")
    .select("*")
    .eq("id", event.ruleId)
    .eq("user_id", connection.user_id)
    .eq("domain", event.domain)
    .maybeSingle();
  if (restrictionError || !restriction) {
    return NextResponse.json({ error: "The restriction no longer belongs to this browser connection." }, { status: 404 });
  }
  const rule = restriction as DatabaseRestriction;
  const attemptId = event.gateId;

  if (event.eventType === "gate_detected") {
    if (!attemptId) return NextResponse.json({ error: "A gate id is required when an attempt starts." }, { status: 400 });
    const localHour = getLocalHour(rule.timezone);
    const timeBucket = timeBucketForHour(localHour);
    const [{ count, error: countError }, { data: scoreRows, error: scoreError }] = await Promise.all([
      admin
        .from("restriction_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", connection.user_id)
        .eq("restriction_id", rule.id),
      admin
        .from("strategy_scores")
        .select("strategy, attempt_count, successful_interruptions, effectiveness_score")
        .eq("user_id", connection.user_id)
        .eq("domain", rule.domain)
        .eq("time_bucket", timeBucket),
    ]);
    if (countError || scoreError) {
      return NextResponse.json({ error: "Unable to select an intervention strategy." }, { status: 500 });
    }
    const scores: StrategyScore[] = ((scoreRows ?? []) as StrategyScoreRow[]).map((score) => ({
      strategy: score.strategy,
      attemptCount: score.attempt_count,
      successfulInterruptions: score.successful_interruptions,
      effectivenessScore: Number(score.effectiveness_score),
    }));
    const strategy = chooseAdaptiveStrategy((count ?? 0) + 1, scores);
    const { error: createError } = await admin.from("restriction_attempts").insert({
      id: attemptId,
      user_id: connection.user_id,
      restriction_id: rule.id,
      browser_connection_id: connection.id,
      source: "navigation",
      strategy,
      client_event_id: event.clientEventId,
      local_timezone: rule.timezone,
      local_hour: localHour,
      attempted_at: event.occurredAt,
    });

    if (createError) {
      const existing = await findAttempt(connection.id, connection.user_id, attemptId);
      if (!existing) return NextResponse.json({ error: "Unable to record the restriction attempt." }, { status: 500 });
    }
  }

  if (!attemptId) {
    // Older local-only extension events have no gate identifier. They remain
    // local rather than being loosely attached to an unrelated server attempt.
    return NextResponse.json({ accepted: false, reason: "event_requires_gate_id" }, { status: 202 });
  }

  const attempt = await findAttempt(connection.id, connection.user_id, attemptId);
  if (!attempt || attempt.restriction_id !== rule.id) {
    return NextResponse.json({ error: "The referenced gate could not be found." }, { status: 404 });
  }

  const { error: eventError } = await admin.from("attempt_events").upsert({
    user_id: connection.user_id,
    attempt_id: attempt.id,
    client_event_id: event.clientEventId,
    event_type: eventTypeForDatabase(event.eventType),
    event_payload: {
      source: event.metadata?.source ?? "local_extension",
      durationMinutes: event.metadata?.durationMinutes ?? null,
      purpose: event.metadata?.purpose ?? null,
    },
    occurred_at: event.occurredAt,
  }, { onConflict: "attempt_id,client_event_id", ignoreDuplicates: true });
  if (eventError) return NextResponse.json({ error: "Unable to record the extension event." }, { status: 500 });

  const outcome = outcomeForEvent(event.eventType);
  if (outcome) {
    const { error: outcomeError } = await admin.rpc("resolve_restriction_attempt_outcome", {
      p_attempt_id: attempt.id,
      p_user_id: connection.user_id,
      p_outcome: outcome,
      p_occurred_at: event.occurredAt,
    });
    if (outcomeError) return NextResponse.json({ error: "Unable to resolve the restriction attempt." }, { status: 500 });
  }

  if (event.eventType === "intentional_access_started" && event.metadata?.durationMinutes && event.metadata.purpose) {
    const startsAt = new Date(event.occurredAt);
    const expiresAt = new Date(startsAt.getTime() + event.metadata.durationMinutes * 60_000).toISOString();
    const { error: sessionError } = await admin.from("access_sessions").insert({
      user_id: connection.user_id,
      restriction_id: rule.id,
      browser_connection_id: connection.id,
      attempt_id: attempt.id,
      purpose: event.metadata.purpose,
      task_description: rule.goal,
      requested_minutes: event.metadata.durationMinutes,
      status: "active",
      starts_at: event.occurredAt,
      expires_at: expiresAt,
    });
    // The partial unique index prevents a duplicate active session if a browser
    // retries an already-recorded event. The underlying event is still idempotent.
    if (sessionError && sessionError.code !== "23505") {
      return NextResponse.json({ error: "Unable to record the access session." }, { status: 500 });
    }
  }

  return NextResponse.json({ accepted: true, attemptId: attempt.id, strategy: attempt.strategy }, {
    headers: { "Cache-Control": "no-store" },
  });
}
