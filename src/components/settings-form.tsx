"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useState } from "react";

import { TONES, type Tone } from "@/lib/types";

type SettingsFormProps = { initial: { timezone: string; defaultTone: Tone; focusDestination: string | null } };

const labels: Record<Tone, string> = {
  sarcastic_gen_z: "Sarcastic Gen Z",
  supportive_friend: "Supportive friend",
  direct_coach: "Direct coach",
  calm_neutral: "Calm and neutral",
};

export function SettingsForm({ initial }: SettingsFormProps) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [defaultTone, setDefaultTone] = useState<Tone>(initial.defaultTone);
  const [focusDestination, setFocusDestination] = useState(initial.focusDestination ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone, defaultTone, focusDestination }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to save settings.");
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="settings-form" onSubmit={save}>
    <label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label>
    <label>Default coaching tone<select value={defaultTone} onChange={(event) => setDefaultTone(event.target.value as Tone)}>{TONES.map((tone) => <option key={tone} value={tone}>{labels[tone]}</option>)}</select></label>
    <label>Focus destination <input type="url" placeholder="https://your-task-list.example" value={focusDestination} onChange={(event) => setFocusDestination(event.target.value)} /><span>Optional. The extension can use this as a deliberate return destination.</span></label>
    <div className="form-actions"><button className="button-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Save settings</button>{status && <span className="form-note" role="status">{status}</span>}</div>
  </form>;
}
