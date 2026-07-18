"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signingUp = mode === "sign-up";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured yet. Add the project values to .env.local first.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      if (signingUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/today`,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setStatus("Check your inbox to confirm your account, then return here to sign in.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
      router.replace("/today");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand href="/" dark />
        <div>
          <h1>Catch the scroll before it catches you.</h1>
          <p>ScrollGate adds a thoughtful pause between an automatic click and the next hour of your attention.</p>
        </div>
        <div className="auth-focus-line" aria-hidden="true" />
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-card">
          <Brand href="/" />
          <h2 id="auth-title">{signingUp ? "Start protecting your focus." : "Welcome back."}</h2>
          <p>{signingUp ? "Create your private account. You control the restrictions and the data behind them." : "Sign in to manage the focus periods you made for yourself."}</p>
          <form className="auth-form" onSubmit={onSubmit}>
            {signingUp && <div className="field"><label htmlFor="display-name">Name</label><input id="display-name" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></div>}
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete={signingUp ? "new-password" : "current-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {status && <p className="notice" role="status">{status}</p>}
            <button className="button-primary" type="submit" disabled={pending}>{pending && <LoaderCircle size={17} className="animate-spin" />} {signingUp ? "Create account" : "Sign in"}</button>
          </form>
          <p className="auth-switch">{signingUp ? "Already have an account?" : "New to ScrollGate?"} <Link href={signingUp ? "/sign-in" : "/sign-up"}>{signingUp ? "Sign in" : "Create an account"}</Link></p>
        </div>
      </section>
    </main>
  );
}
