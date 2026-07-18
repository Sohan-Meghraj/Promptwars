import { Settings2, ShieldCheck } from "lucide-react";

import { SettingsForm } from "@/components/settings-form";
import { getProfileSettings } from "@/lib/dashboard";

export default async function SettingsPage() {
  const { settings, setupError } = await getProfileSettings();
  return <div className="page-frame"><div className="page-heading"><div><h1>Make the interruption feel like yours.</h1><p>These settings shape your default rules and the focus destination shared with your paired browsers.</p></div></div>
    {setupError || !settings ? <div className="notice" role="status"><ShieldCheck size={18} /> Apply the included schema before saving account preferences.</div> : <section className="settings-card"><div><Settings2 size={23} aria-hidden="true" /><h2>Focus preferences</h2><p>Keep this simple. A clear focus destination makes it easier to decide what to do after a gate.</p></div><SettingsForm initial={settings} /></section>}
  </div>;
}
