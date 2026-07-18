import { CheckCircle2, Monitor, ShieldCheck } from "lucide-react";

import { PairingCodeCard } from "@/components/pairing-code-card";
import { getConnectedBrowsers } from "@/lib/dashboard";

function formatSeen(value: string | null) {
  if (!value) return "Not synced yet";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function BrowsersPage() {
  const { browsers, setupError } = await getConnectedBrowsers();
  return <div className="page-frame">
    <div className="page-heading"><div><h1>Browsers that protect your time.</h1><p>Pair the extension once. It enforces active restrictions locally before a distracting page loads.</p></div></div>
    {setupError ? <div className="notice" role="status"><ShieldCheck size={18} /> Apply the included Supabase migration and server environment variables before pairing an extension.</div> : <PairingCodeCard />}
    <section className="content-section" aria-labelledby="browser-list-title">
      <div className="section-heading"><h2 id="browser-list-title">Connected browsers</h2></div>
      {browsers.length ? <div className="restriction-list">{browsers.map((browser) => <div className="restriction-row" key={browser.id}>
        <div className="domain-cell"><div className="domain-icon"><Monitor size={17} /></div><div><strong>{browser.nickname}</strong><span>{browser.extensionVersion ? `Extension ${browser.extensionVersion}` : "Chromium extension"}</span></div></div>
        <span className="row-status"><CheckCircle2 size={16} /> {browser.revokedAt ? "Revoked" : "Paired"}</span>
        <div className="row-actions"><span className="form-note">Last sync: {formatSeen(browser.lastSyncedAt ?? browser.lastSeenAt)}</span></div>
      </div>)}</div> : <div className="empty-state"><h2>No browser is paired yet.</h2><p>Install the local prototype extension, open its popup, enter this app’s URL and then the one-time code above.</p></div>}
    </section>
  </div>;
}
