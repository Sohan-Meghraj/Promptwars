import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { restrictionInputSchema } from "@/lib/schemas";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function configurationResponse() {
  return NextResponse.json({ error: "Supabase has not been configured." }, { status: 503 });
}

async function requireUser() {
  if (!isSupabaseConfigured()) return null;
  return getCurrentUser();
}

export async function GET() {
  if (!isSupabaseConfigured()) return configurationResponse();
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("restrictions").select("*").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Unable to load restrictions." }, { status: 500 });
  return NextResponse.json({ restrictions: data });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return configurationResponse();
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = restrictionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please review the restriction fields.", issues: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.startTime === parsed.data.endTime) return NextResponse.json({ error: "Start and end times must be different." }, { status: 400 });

  const rule = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("restrictions")
    .insert({
      user_id: user.id,
      domain: rule.domain,
      goal: rule.goal,
      reason: rule.reason,
      tone: rule.tone,
      timezone: rule.timezone,
      active_days: rule.activeDays,
      start_time: rule.startTime,
      end_time: rule.endTime,
      max_temporary_access_minutes: rule.maxAccessMinutes,
      is_enabled: rule.enabled,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: "Unable to save this restriction. Check that the database migration has been applied." }, { status: 500 });
  return NextResponse.json({ restriction: data }, { status: 201 });
}
