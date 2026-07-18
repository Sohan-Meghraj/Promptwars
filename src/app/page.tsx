import { redirect } from "next/navigation";

import { SetupRequired } from "@/components/setup-required";
import { getCurrentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function Home() {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const user = await getCurrentUser();
  redirect(user ? "/today" : "/sign-in");
}
