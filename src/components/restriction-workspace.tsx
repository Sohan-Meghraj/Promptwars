"use client";

import { Clock3, Globe2, LoaderCircle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { scheduleLabel } from "@/lib/schedule";
import type { RestrictionRule, Tone } from "@/lib/types";

type RuleFormState = {
  domain: string;
  goal: string;
  reason: string;
  tone: Tone;
  timezone: string;
  activeDays: number[];
  startTime: string;
  endTime: string;
  maxAccessMinutes: number;
  enabled: boolean;
};

const toneLabels: Record<Tone, string> = {
  sarcastic_gen_z: "Sarcastic Gen Z",
  supportive_friend: "Supportive friend",
  direct_coach: "Direct coach",
  calm_neutral: "Calm and neutral",
};

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toFormState(rule?: RestrictionRule): RuleFormState {
  return rule
    ? { domain: rule.domain, goal: rule.goal, reason: rule.reason, tone: rule.tone, timezone: rule.timezone, activeDays: rule.activeDays, startTime: rule.startTime, endTime: rule.endTime, maxAccessMinutes: rule.maxAccessMinutes, enabled: rule.enabled }
    : { domain: "", goal: "", reason: "", tone: "sarcastic_gen_z", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", activeDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "13:00", maxAccessMinutes: 10, enabled: true };
}

export function RestrictionWorkspace({ initialRules }: { initialRules: RestrictionRule[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEditId = searchParams.get("new") === "1" ? null : searchParams.get("edit");
  const initialRule = initialRules.find((rule) => rule.id === initialEditId);
  const [editingId, setEditingId] = useState<string | null>(initialRule?.id ?? null);
  const [form, setForm] = useState<RuleFormState>(() => toFormState(initialRule));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const editingRule = useMemo(() => initialRules.find((rule) => rule.id === editingId), [editingId, initialRules]);

  function change<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectRule(rule?: RestrictionRule) {
    setError(null);
    setStatus(null);
    setEditingId(rule?.id ?? null);
    setForm(toFormState(rule));
  }

  async function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const endpoint = editingRule ? `/api/restrictions/${editingRule.id}` : "/api/restrictions";
      const response = await fetch(endpoint, { method: editingRule ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingRule ? { rule: form } : form) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to save this restriction.");
      setStatus(editingRule ? "Restriction updated and ready to sync to your extension." : "Restriction saved and ready to sync to your extension.");
      selectRule();
      router.replace("/restrictions");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this restriction.");
    } finally {
      setPending(false);
    }
  }

  async function updateEnabled(rule: RestrictionRule) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/restrictions/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !rule.enabled }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update this restriction.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this restriction.");
    } finally { setPending(false); }
  }

  async function deleteRule(rule: RestrictionRule) {
    if (!window.confirm(`Delete the ${rule.domain} restriction? This does not erase its recorded events.`)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/restrictions/${rule.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to delete this restriction.");
      }
      if (editingId === rule.id) selectRule();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this restriction.");
    } finally { setPending(false); }
  }

  return (
    <div className="workspace-grid">
      <section aria-labelledby="rule-list-title">
        <div className="section-heading"><h2 id="rule-list-title">Your restrictions</h2><button className="text-button" type="button" onClick={() => selectRule()}>Add another</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {status && <p className="notice" role="status">{status}</p>}
        {initialRules.length ? <div className="rule-list">{initialRules.map((rule) => <article className="rule-card" key={rule.id}>
          <div><div className="domain-cell"><div className="domain-icon"><Globe2 size={17} /></div><div><h2>{rule.domain}</h2><span>{rule.enabled ? "Enabled" : "Paused"}</span></div></div><p>{rule.reason}</p><div className="rule-meta"><span><Clock3 size={14} /> {scheduleLabel(rule)}</span><span>{toneLabels[rule.tone]}</span><span>Up to {rule.maxAccessMinutes} min access</span></div></div>
          <div className="rule-controls"><button className="text-button" type="button" onClick={() => updateEnabled(rule)} disabled={pending}>{rule.enabled ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}</button><button className="text-button" type="button" onClick={() => selectRule(rule)}><Pencil size={14} /> Edit</button><button className="text-button danger" type="button" onClick={() => deleteRule(rule)} disabled={pending}><Trash2 size={14} /> Delete</button></div>
        </article>)}</div> : <div className="empty-state"><h2>Your list is empty.</h2><p>Start with the website that most often turns a quick break into a longer detour.</p></div>}
      </section>

      <aside className="rule-editor" aria-labelledby="editor-title">
        <h2 id="editor-title">{editingRule ? `Edit ${editingRule.domain}` : "Create a restriction"}</h2>
        <p>ScrollGate checks these rules locally in the extension. You stay in control of every override.</p>
        <form className="rule-form" onSubmit={saveRule}>
          <div className="field"><label htmlFor="domain">Website domain</label><input id="domain" placeholder="youtube.com" value={form.domain} onChange={(event) => change("domain", event.target.value)} required /></div>
          <div className="field"><label htmlFor="goal">What are you protecting time for?</label><input id="goal" placeholder="Finish my database assignment" value={form.goal} onChange={(event) => change("goal", event.target.value)} required maxLength={240} /></div>
          <div className="field"><label htmlFor="reason">Why does this site need a gate?</label><textarea id="reason" placeholder="YouTube turns five-minute breaks into an hour." value={form.reason} onChange={(event) => change("reason", event.target.value)} required maxLength={320} /></div>
          <div className="field"><label>Active days</label><div className="day-picker">{days.map((day, index) => <button key={day} type="button" aria-pressed={form.activeDays.includes(index)} onClick={() => change("activeDays", form.activeDays.includes(index) ? form.activeDays.filter((value) => value !== index) : [...form.activeDays, index].sort())}>{day}</button>)}</div></div>
          <div className="form-grid"><div className="field"><label htmlFor="start-time">Start time</label><input id="start-time" type="time" value={form.startTime} onChange={(event) => change("startTime", event.target.value)} required /></div><div className="field"><label htmlFor="end-time">End time</label><input id="end-time" type="time" value={form.endTime} onChange={(event) => change("endTime", event.target.value)} required /></div></div>
          <div className="form-grid"><div className="field"><label htmlFor="tone">Coaching tone</label><select id="tone" value={form.tone} onChange={(event) => change("tone", event.target.value as Tone)}>{Object.entries(toneLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="access">Maximum timed access</label><select id="access" value={form.maxAccessMinutes} onChange={(event) => change("maxAccessMinutes", Number(event.target.value))}>{[1, 2, 5, 10, 15, 30, 60].map((value) => <option value={value} key={value}>{value} minutes</option>)}</select></div></div>
          <p className="form-note">Timezone: {form.timezone}. Overnight schedules are supported.</p>
          <div className="form-actions"><button className="button-primary" type="submit" disabled={pending}>{pending && <LoaderCircle size={16} className="animate-spin" />}{editingRule ? "Save changes" : "Save restriction"}</button>{editingRule && <button className="button-secondary" type="button" onClick={() => selectRule()}>Cancel</button>}</div>
        </form>
      </aside>
    </div>
  );
}
