import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { profileInputSchema } from "@/lib/schemas";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase has not been configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = profileInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please review your settings." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      timezone: parsed.data.timezone,
      default_tone: parsed.data.defaultTone,
      focus_destination: parsed.data.focusDestination || null,
    })
    .eq("id", user.id)
    .select("timezone, default_tone, focus_destination")
    .single();
  if (error) return NextResponse.json({ error: "Unable to save settings. Apply the migration first." }, { status: 500 });
  return NextResponse.json({ profile: data });
}
