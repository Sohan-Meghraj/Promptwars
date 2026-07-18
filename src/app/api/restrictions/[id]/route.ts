import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { restrictionInputSchema } from "@/lib/schemas";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  rule: restrictionInputSchema.optional(),
}).refine((value) => value.enabled !== undefined || value.rule !== undefined, "No changes supplied.");

async function authorize() {
  if (!isSupabaseConfigured()) return { user: null, response: NextResponse.json({ error: "Supabase has not been configured." }, { status: 503 }) };
  const user = await getCurrentUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user, response: null };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await authorize();
  if (!user) return response!;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please review the changes.", issues: parsed.error.flatten() }, { status: 400 });

  const update = parsed.data.rule
    ? {
        domain: parsed.data.rule.domain,
        goal: parsed.data.rule.goal,
        reason: parsed.data.rule.reason,
        tone: parsed.data.rule.tone,
        timezone: parsed.data.rule.timezone,
        active_days: parsed.data.rule.activeDays,
        start_time: parsed.data.rule.startTime,
        end_time: parsed.data.rule.endTime,
        max_temporary_access_minutes: parsed.data.rule.maxAccessMinutes,
        is_enabled: parsed.data.rule.enabled,
      }
    : { is_enabled: parsed.data.enabled };

  const supabase = await createClient();
  const { data, error } = await supabase.from("restrictions").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: "Unable to update this restriction." }, { status: 500 });
  return NextResponse.json({ restriction: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await authorize();
  if (!user) return response!;
  const { id } = await context.params;
  const supabase = await createClient();
  const { error } = await supabase.from("restrictions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Unable to delete this restriction." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
