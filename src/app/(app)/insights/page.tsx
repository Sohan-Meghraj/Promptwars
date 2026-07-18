import { BarChart3, Compass, ShieldCheck } from "lucide-react";

import { getInsightSnapshot } from "@/lib/dashboard";

export default async function InsightsPage() {
  const insights = await getInsightSnapshot();
  return <div className="page-frame"><div className="page-heading"><div><h1>Insights, without the guilt trip.</h1><p>ScrollGate only draws conclusions from real extension events, and waits for enough signal before recommending a strategy.</p></div></div>
    {insights.setupError ? <div className="notice" role="status"><ShieldCheck size={18} /> Apply the included schema to begin collecting private activity data.</div> : <div className="metric-grid">
      <div className="metric-card"><BarChart3 size={21} /><strong>{insights.attempts}</strong><span>Recorded restricted attempts</span></div>
      <div className="metric-card"><Compass size={21} /><strong>{insights.returnsToFocus}</strong><span>Returns to focus</span></div>
      <div className="metric-card"><ShieldCheck size={21} /><strong>{insights.intentionalAccess}</strong><span>Intentional access sessions</span></div>
    </div>}
    <section className="content-section"><div className="insight-empty"><div><BarChart3 size={27} /></div><p>{insights.attempts < 5 ? "Complete a few more interventions before ScrollGate compares approaches. Until then, it rotates a small set of respectful prompts." : "ScrollGate has enough activity to start comparing which interruption strategies help you return to focus."}</p></div></section>
  </div>;
}
