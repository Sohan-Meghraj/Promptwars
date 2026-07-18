import { RestrictionWorkspace } from "@/components/restriction-workspace";
import { getTodayDashboard } from "@/lib/dashboard";

export default async function RestrictionsPage() {
  const dashboard = await getTodayDashboard();
  return <div className="page-frame"><div className="page-heading"><div><h1>Restrictions, on your terms.</h1><p>Define the sites, the windows, and the kind of interruption that helps you return to what matters.</p></div></div>{dashboard.setupError ? <div className="notice" role="status">Apply the included Supabase migration to start storing real restrictions.</div> : <RestrictionWorkspace initialRules={dashboard.rules} />}</div>;
}
