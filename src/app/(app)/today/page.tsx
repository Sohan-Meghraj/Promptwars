import { ArrowRight, Clock3, Globe2, LineChart, MonitorCog, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { getTodayDashboard } from "@/lib/dashboard";
import { scheduleLabel } from "@/lib/schedule";

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatBrowserSync(value: string | null) {
  if (!value) return "Paired, awaiting its first sync.";
  return `Last synced ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}.`;
}

export default async function TodayPage() {
  const dashboard = await getTodayDashboard();

  return (
    <div className="page-frame">
      <div className="page-heading">
        <div>
          <h1>Your focus is protected.</h1>
          <p>A few intentional choices can change the next hour.</p>
        </div>
        <Link className="button-primary" href="/restrictions?new=1"><ShieldCheck size={18} /> Add restriction</Link>
      </div>

      {dashboard.setupError && <div className="notice" role="status"><ShieldCheck size={18} aria-hidden="true" /> Your account is connected, but the ScrollGate schema has not been applied yet. Run the included Supabase migration before adding restrictions.</div>}

      <div className="today-layout">
        <div>
          <section className="content-section" aria-labelledby="active-title">
            <div className="section-heading"><h2 id="active-title">Active restrictions</h2><Link className="section-link" href="/restrictions">View all restrictions <ArrowRight size={15} /></Link></div>
            {dashboard.activeRules.length ? (
              <div className="restriction-list">
                {dashboard.activeRules.map((rule) => (
                  <div className="restriction-row" key={rule.id}>
                    <div className="domain-cell"><div className="domain-icon"><Globe2 size={17} /></div><div><strong>{rule.domain}</strong><span>{scheduleLabel(rule)}</span></div></div>
                    <span className="row-status"><Clock3 size={16} /> Active now</span>
                    <div className="row-actions"><Link className="button-secondary" href={`/restrictions?edit=${rule.id}`}>Manage</Link></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state"><h2>No restriction is active right now.</h2><p>Once you set a website and a focus window, ScrollGate will keep the rule ready for your connected browser.</p><Link className="button-secondary" href="/restrictions?new=1">Create a restriction</Link></div>
            )}
          </section>

          <section className="content-section" aria-labelledby="insights-title">
            <div className="section-heading"><h2 id="insights-title">Insights</h2><Link className="section-link" href="/insights">Open insights <ArrowRight size={15} /></Link></div>
            <div className="insight-empty"><div><LineChart size={27} /></div><p>ScrollGate compares strategies only after it has enough resolved, real intervention outcomes.</p></div>
          </section>

          <section className="content-section" aria-labelledby="activity-title">
            <div className="section-heading"><h2 id="activity-title">Recent activity</h2><Link className="section-link" href="/insights">View all activity <ArrowRight size={15} /></Link></div>
            {dashboard.recentActivity.length ? (
              <div className="activity-list">
                {dashboard.recentActivity.map((activity) => (
                  <div className="activity-row" key={activity.id}>
                    <div className="activity-icon"><ShieldCheck size={17} /></div>
                    <div className="activity-copy"><strong>{activity.action.replaceAll("_", " ")}</strong><span>{activity.domain}</span></div>
                    <time className="activity-time" dateTime={activity.occurredAt}>{formatActivityTime(activity.occurredAt)}</time>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><h2>No interventions yet.</h2><p>Real attempted-site events will appear here after you connect the extension and reach an active restriction.</p></div>}
          </section>
        </div>

        <aside className="context-rail" aria-label="Focus context">
          <div className="context-card"><MonitorCog size={25} aria-hidden="true" /><h2>Connected browser</h2><strong>{dashboard.connectedBrowser?.nickname ?? "No browser paired"}</strong><p>{dashboard.connectedBrowser ? formatBrowserSync(dashboard.connectedBrowser.lastSyncedAt ?? dashboard.connectedBrowser.lastSeenAt) : "Connect the Chrome extension to enforce active rules before a distracting site loads."}</p><Link className="context-link" href="/browsers">{dashboard.connectedBrowser ? "Manage browsers" : "Connect a browser"}</Link></div>
          <div className="context-card"><h2>Recorded so far</h2><div className="metric-list"><div className="metric-line"><span>Blocked attempts</span><strong>{dashboard.metrics.attempts}</strong></div><div className="metric-line"><span>Returns to focus</span><strong>{dashboard.metrics.returnsToFocus}</strong></div><div className="metric-line"><span>Intentional access</span><strong>{dashboard.metrics.intentionalAccess}</strong></div></div><p>{dashboard.metrics.attempts ? "These totals come only from synchronized extension events." : "Complete your first ScrollGate intervention to begin seeing patterns."}</p></div>
        </aside>
      </div>
    </div>
  );
}
