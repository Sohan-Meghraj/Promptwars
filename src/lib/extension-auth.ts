import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type ExtensionConnection = {
  id: string;
  user_id: string;
  nickname: string;
  platform: "chromium";
  revoked_at: string | null;
};

function getTokenPepper(): string | null {
  return process.env.SCROLLGATE_TOKEN_PEPPER?.trim() || null;
}

export function isExtensionServerConfigured(): boolean {
  return isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && Boolean(getTokenPepper());
}

export function createConnectionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createPairingCode(): string {
  const bytes = randomBytes(4).readUInt32BE(0);
  return String(bytes % 1_000_000).padStart(6, "0");
}

function digest(value: string, purpose: "connection" | "pairing"): string {
  const pepper = getTokenPepper();
  if (!pepper) throw new Error("ScrollGate extension credentials have not been configured.");
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

export function hashConnectionToken(token: string): string {
  return digest(token, "connection");
}

export function hashPairingCode(code: string): string {
  return digest(code, "pairing");
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header);
  return match?.[1] ?? null;
}

export async function getExtensionConnection(request: Request): Promise<ExtensionConnection | null> {
  if (!isExtensionServerConfigured()) return null;
  const token = readBearerToken(request);
  if (!token) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("browser_connections")
    .select("id, user_id, nickname, platform, revoked_at")
    .eq("connection_token_hash", hashConnectionToken(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data || data.platform !== "chromium") return null;

  void admin
    .from("browser_connections")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("user_id", data.user_id)
    .then(() => undefined);

  return data as ExtensionConnection;
}
