import { NextResponse } from "next/server";

import {
  createConnectionToken,
  hashConnectionToken,
  hashPairingCode,
  isExtensionServerConfigured,
} from "@/lib/extension-auth";
import { toExtensionRestriction, type DatabaseRestriction } from "@/lib/extension-contract";
import { pairExtensionSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function unavailable() {
  return NextResponse.json({ error: "Extension pairing has not been configured yet." }, { status: 503 });
}

export async function POST(request: Request) {
  if (!isExtensionServerConfigured()) return unavailable();
  const parsed = pairExtensionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid six-digit pairing code." }, { status: 400 });

  const admin = createAdminClient();
  const codeHash = hashPairingCode(parsed.data.pairingCode);
  const { data: pairingCode, error: pairingError } = await admin
    .from("browser_pairing_codes")
    .select("id, user_id")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (pairingError || !pairingCode) {
    return NextResponse.json({ error: "That pairing code is invalid or has expired." }, { status: 401 });
  }

  const deviceToken = createConnectionToken();
  const { data: connection, error: connectionError } = await admin
    .from("browser_connections")
    .insert({
      user_id: pairingCode.user_id,
      nickname: parsed.data.deviceLabel,
      platform: parsed.data.browserFamily,
      extension_version: parsed.data.extensionVersion,
      connection_token_hash: hashConnectionToken(deviceToken),
      last_seen_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (connectionError || !connection) {
    return NextResponse.json({ error: "Unable to pair this browser." }, { status: 500 });
  }

  const { data: consumed, error: consumeError } = await admin
    .from("browser_pairing_codes")
    .update({ consumed_at: new Date().toISOString(), browser_connection_id: connection.id })
    .eq("id", pairingCode.id)
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (consumeError || !consumed) {
    await admin.from("browser_connections").delete().eq("id", connection.id);
    return NextResponse.json({ error: "That pairing code was already used or expired." }, { status: 409 });
  }

  const [{ data: profile }, { data: rules }] = await Promise.all([
    admin.from("profiles").select("rules_version, focus_destination").eq("id", pairingCode.user_id).maybeSingle(),
    admin.from("restrictions").select("*").eq("user_id", pairingCode.user_id).order("updated_at", { ascending: false }),
  ]);

  return NextResponse.json({
    deviceToken,
    browserId: connection.id,
    rulesVersion: profile?.rules_version ?? 0,
    rules: ((rules ?? []) as DatabaseRestriction[]).map(toExtensionRestriction),
    focusDestination: profile?.focus_destination ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
