import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createPairingCode, hashPairingCode, isExtensionServerConfigured } from "@/lib/extension-auth";
import { createPairingCodeSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function unavailable() {
  return NextResponse.json({ error: "Extension pairing has not been configured yet." }, { status: 503 });
}

export async function POST(request: Request) {
  if (!isExtensionServerConfigured()) return unavailable();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rate = consumeRateLimit(`pair-code:${user.id}`, 6, 10 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many pairing codes requested. Please wait before generating another." }, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds) },
    });
  }

  const parsed = createPairingCodeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid device label." }, { status: 400 });

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = createPairingCode();
    const { error } = await admin.from("browser_pairing_codes").insert({
      user_id: user.id,
      code_hash: hashPairingCode(code),
      expires_at: expiresAt,
    });
    if (!error) {
      return NextResponse.json({ code, expiresAt, deviceLabel: parsed.data.deviceLabel ?? "This browser" }, {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return NextResponse.json({ error: "Unable to create a pairing code. Please try again." }, { status: 500 });
}
