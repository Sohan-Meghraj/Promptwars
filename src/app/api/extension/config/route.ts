import { NextResponse } from "next/server";

import { getExtensionConnection, isExtensionServerConfigured } from "@/lib/extension-auth";
import { toExtensionRestriction, type DatabaseRestriction } from "@/lib/extension-contract";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isExtensionServerConfigured()) {
    return NextResponse.json({ error: "Extension sync has not been configured yet." }, { status: 503 });
  }
  const connection = await getExtensionConnection(request);
  if (!connection) return NextResponse.json({ error: "Unauthorized browser connection." }, { status: 401 });

  const admin = createAdminClient();
  const [{ data: profile, error: profileError }, { data: rules, error: rulesError }] = await Promise.all([
    admin.from("profiles").select("rules_version, focus_destination").eq("id", connection.user_id).single(),
    admin.from("restrictions").select("*").eq("user_id", connection.user_id).order("updated_at", { ascending: false }),
  ]);
  if (profileError || rulesError || !profile) {
    return NextResponse.json({ error: "Unable to load the browser configuration." }, { status: 500 });
  }

  await admin
    .from("browser_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);

  return NextResponse.json({
    rulesVersion: profile.rules_version,
    rules: ((rules ?? []) as DatabaseRestriction[]).map(toExtensionRestriction),
    focusDestination: profile.focus_destination,
  }, { headers: { "Cache-Control": "no-store" } });
}
