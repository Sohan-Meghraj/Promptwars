import { Brand } from "@/components/brand";

export function SetupRequired() {
  return (
    <main className="setup-screen">
      <section className="setup-card" aria-labelledby="setup-title">
        <Brand href="/" dark />
        <h1 id="setup-title">Connect ScrollGate to Supabase.</h1>
        <p>This local build is ready. Add your existing project credentials to <code>.env.local</code>, then restart the server to enable secure sign-in and real data.</p>
        <code>{`NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nSCROLLGATE_TOKEN_PEPPER=\nGROQ_API_KEY=`}</code>
      </section>
    </main>
  );
}
