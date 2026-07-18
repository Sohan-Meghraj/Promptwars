import { BarChart3, Compass, ShieldCheck } from "lucide-react";

import { getInsightSnapshot } from "@/lib/dashboard";

export default async function InsightsPage() {
  const insights = await getInsightSnapshot();
  const bestStrategy = insights.bestSupportedStrategy;

  return <div className="page-frame"><div className="page-heading"><div><h1>Insights, without the guilt trip.</h1><p>ScrollGate only draws conclusions from real extension events, and waits for enough signal before recommending a strategy.</p></div></div>
    {insights.setupError ? <div className="notice" role="status"><ShieldCheck size={18} /> Apply the included schema to begin collecting private activity data.</div> : <div className="metric-grid">
      <div className="metric-card"><BarChart3 size={21} /><strong>{insights.attempts}</strong><span>Recorded restricted attempts</span></div>
      <div className="metric-card"><Compass size={21} /><strong>{insights.returnsToFocus}</strong><span>Returns to focus</span></div>
      <div className="metric-card"><ShieldCheck size={21} /><strong>{insights.intentionalAccess}</strong><span>Intentional access sessions</span></div>
    </div>}
    <section className="content-section"><div className="insight-empty"><div><BarChart3 size={27} /></div><p>{bestStrategy ? `For ${bestStrategy.domain}, ${bestStrategy.strategy.replaceAll("_", " ")} has the strongest current signal: ${bestStrategy.successfulInterruptions} returns to focus from ${bestStrategy.attemptCount} resolved interventions (${Math.round(bestStrategy.effectivenessScore * 100)}%).` : "Complete at least three resolved interventions with each approach before ScrollGate recommends one. Until then, it rotates respectful prompts and records the outcomes."}</p></div></section>
  </div>;
}
