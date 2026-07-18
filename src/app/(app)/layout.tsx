import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// These pages are session-bound and may render a local setup screen before
// credentials exist, so they must never be statically prerendered at build time.
export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return <AppShell user={user}>{children}</AppShell>;
}
