import { NextResponse } from "next/server";

import { getExtensionConnection, isExtensionServerConfigured } from "@/lib/extension-auth";
import { generateIntervention } from "@/lib/intervention-generator";
import { interventionRequestSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Strategy, Tone } from "@/lib/types";

export const runtime = "nodejs";

type Attempt = { id: string; restriction_id: string; strategy: Strategy };
type Restriction = { domain: string; goal: string; reason: string; tone: Tone };

export async function POST(request: Request) {
  if (!isExtensionServerConfigured()) {
    return NextResponse.json({ error: "Interventions have not been configured yet." }, { status: 503 });
  }
  const connection = await getExtensionConnection(request);
  if (!connection) return NextResponse.json({ error: "Unauthorized browser connection." }, { status: 401 });

  const parsed = interventionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid intervention request." }, { status: 400 });
  const admin = createAdminClient();
  const { data: attempt, error: attemptError } = await admin
    .from("restriction_attempts")
    .select("id, restriction_id, strategy")
    .eq("id", parsed.data.attemptId)
    .eq("user_id", connection.user_id)
    .eq("browser_connection_id", connection.id)
    .maybeSingle();
  if (attemptError || !attempt) return NextResponse.json({ error: "The restriction attempt was not found." }, { status: 404 });

  const { data: cached } = await admin
    .from("interventions")
    .select("headline, message, suggested_action, reset_text, strategy, tone, source")
    .eq("attempt_id", attempt.id)
    .eq("user_id", connection.user_id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached) {
    return NextResponse.json({
      intervention: {
        headline: cached.headline,
        message: cached.message,
        microAction: cached.suggested_action,
        ...(cached.reset_text ? { resetText: cached.reset_text } : {}),
        strategy: cached.strategy,
        tone: cached.tone,
        source: cached.source === "ai_generated" ? "cached_ai_generated" : cached.source,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: restriction, error: restrictionError } = await admin
    .from("restrictions")
    .select("domain, goal, reason, tone")
    .eq("id", attempt.restriction_id)
    .eq("user_id", connection.user_id)
    .maybeSingle();
  if (restrictionError || !restriction) return NextResponse.json({ error: "The restriction was not found." }, { status: 404 });

  const { count } = await admin
    .from("restriction_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", connection.user_id)
    .eq("restriction_id", attempt.restriction_id);
  const generated = await generateIntervention({
    ...(restriction as Restriction),
    strategy: (attempt as Attempt).strategy,
    attemptNumber: count ?? 1,
  });

  const { data: saved, error: saveError } = await admin
    .from("interventions")
    .insert({
      user_id: connection.user_id,
      attempt_id: attempt.id,
      strategy: generated.intervention.strategy,
      tone: generated.intervention.tone,
      source: generated.intervention.source,
      headline: generated.intervention.headline,
      message: generated.intervention.message,
      suggested_action: generated.intervention.microAction,
      reset_text: generated.intervention.resetText ?? null,
      model_name: generated.modelName,
      prompt_version: generated.promptVersion,
    })
    .select("id")
    .single();
  if (saveError || !saved) {
    // Two gate views can open at once. The database constraint makes the first
    // response authoritative rather than allowing duplicate AI requests/copy.
    if (saveError?.code === "23505") {
      const { data: existing } = await admin
        .from("interventions")
        .select("headline, message, suggested_action, reset_text, strategy, tone, source")
        .eq("attempt_id", attempt.id)
        .eq("user_id", connection.user_id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          intervention: {
            headline: existing.headline,
            message: existing.message,
            microAction: existing.suggested_action,
            ...(existing.reset_text ? { resetText: existing.reset_text } : {}),
            strategy: existing.strategy,
            tone: existing.tone,
            source: existing.source === "ai_generated" ? "cached_ai_generated" : existing.source,
          },
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    return NextResponse.json({ error: "Unable to save the intervention." }, { status: 500 });
  }

  await Promise.all([
    admin.from("restriction_attempts").update({ used_ai_fallback: generated.intervention.source === "local_fallback" }).eq("id", attempt.id),
    admin.from("ai_request_logs").insert({
      user_id: connection.user_id,
      attempt_id: attempt.id,
      intervention_id: saved.id,
      provider: "groq",
      model_name: generated.modelName ?? "local-fallback",
      prompt_version: generated.promptVersion,
      status: generated.status,
      request_metadata: { strategy: generated.intervention.strategy, tone: generated.intervention.tone },
      response_metadata: { source: generated.intervention.source },
      latency_ms: generated.latencyMs,
      safety_passed: generated.status !== "rejected",
      failure_code: generated.failureCode,
      completed_at: new Date().toISOString(),
    }),
  ]);

  return NextResponse.json({ intervention: generated.intervention }, { headers: { "Cache-Control": "no-store" } });
}
