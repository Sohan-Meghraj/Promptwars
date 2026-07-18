import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendExtensionMessage } from '../../lib/messaging';
import type { AccessPurpose, GateContext, Intervention } from '../../lib/types';
import '../../styles/shell.css';
import './gate.css';

type GateView = 'gate' | 'reset' | 'access' | 'override';

const PURPOSE_OPTIONS: Array<{ value: AccessPurpose; label: string }> = [
  { value: 'study', label: 'Study' },
  { value: 'work', label: 'Work' },
  { value: 'research', label: 'Research' },
  { value: 'personal', label: 'Personal task' },
];

const OVERRIDE_OPTIONS: Array<{ value: AccessPurpose; label: string }> = [
  { value: 'urgent_work', label: 'Urgent work' },
  { value: 'planned_task', label: 'Planned task' },
  { value: 'other_necessary', label: 'Another necessary reason' },
];

function GateApp() {
  const [context, setContext] = useState<GateContext | null>(null);
  const [view, setView] = useState<GateView>('gate');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetSeconds, setResetSeconds] = useState(120);
  const [purpose, setPurpose] = useState<AccessPurpose>('study');
  const [overrideReason, setOverrideReason] = useState<AccessPurpose>('urgent_work');
  const [duration, setDuration] = useState(1);
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const screenTitleRef = useRef<HTMLHeadingElement>(null);

  const requestIntervention = useCallback(async () => {
    const result = await sendExtensionMessage<Intervention | null>({ type: 'gate:intervention' });
    if (!result.ok || !result.data) return;
    setContext((current) => current ? { ...current, intervention: result.data! } : current);
  }, []);

  const bootstrap = useCallback(async () => {
    // DNR redirects immediately. A navigation callback may still be persisting
    // its small pending-gate record, so retry briefly before showing the generic
    // safe fallback. No remote request is involved.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await sendExtensionMessage<GateContext>({ type: 'gate:bootstrap' });
      if (!result.ok || !result.data) throw new Error(result.error ?? 'Could not load this gate.');
      if (result.data.pendingGate || attempt === 3) {
        setContext(result.data);
        setDuration(Math.min(2, result.data.rule?.maxAccessMinutes ?? 1));
        void requestIntervention().catch(() => undefined);
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    }
  }, [requestIntervention]);

  useEffect(() => {
    void bootstrap().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load this gate.');
    });
  }, [bootstrap]);

  useEffect(() => {
    screenTitleRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (view !== 'reset' || resetSeconds <= 0) return;
    const timer = window.setInterval(() => setResetSeconds((seconds) => Math.max(seconds - 1, 0)), 1_000);
    return () => window.clearInterval(timer);
  }, [view, resetSeconds]);

  const runAction = useCallback(async (message: Parameters<typeof sendExtensionMessage>[0]) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await sendExtensionMessage<null>(message);
      if (!result.ok) throw new Error(result.error ?? 'That action could not be completed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const startReset = useCallback(async () => {
    await runAction({ type: 'gate:action', action: 'reset_started' });
    setView('reset');
  }, [runAction]);

  const maxDuration = context?.rule?.maxAccessMinutes ?? 1;
  const fallback = context?.intervention;

  if (!context && !error) {
    return <main className="gate-shell gate-shell--loading"><p>Preparing your focus gate…</p></main>;
  }

  return (
    <main className="gate-shell">
      <section className="gate-card" aria-live="polite">
        <div className="gate-brand">
          <span className="gate-mark" aria-hidden="true">S</span>
          <span>ScrollGate</span>
          <span className={`local-chip ${fallback?.source === 'local_fallback' ? '' : 'local-chip--ai'}`}>
            {fallback?.source === 'local_fallback' ? 'Local fallback' : 'Personalized intervention'}
          </span>
        </div>

        {view === 'gate' ? (
          <div className="gate-content">
            <p className="site-label">{context?.rule?.domain ?? 'Protected site'}</p>
            <h1 ref={screenTitleRef} tabIndex={-1}>{fallback?.headline ?? 'This site is protected right now.'}</h1>
            <p className="gate-message">{fallback?.message}</p>
            <div className="micro-action">
              <span aria-hidden="true">→</span>
              <p><strong>Suggested move</strong>{fallback?.microAction}</p>
            </div>
            <p className="reason-line">{context?.rule?.reason ?? 'This is an active restriction you set for yourself.'}</p>

            <div className="gate-actions">
              <button className="button button--primary" type="button" disabled={isSubmitting} onClick={() => void runAction({ type: 'gate:action', action: 'returned_to_focus' })}>
                Take me back
              </button>
              <button className="button button--secondary" type="button" disabled={isSubmitting} onClick={() => void startReset()}>
                Start a 2-minute reset
              </button>
              <button className="button button--secondary" type="button" disabled={isSubmitting} onClick={() => setView('access')}>
                I genuinely need this site
              </button>
              <button className="button button--text" type="button" disabled={isSubmitting} onClick={() => setView('override')}>
                Override with friction
              </button>
            </div>
          </div>
        ) : null}

        {view === 'reset' ? (
          <div className="gate-content gate-content--reset">
            <p className="site-label">Two-minute reset</p>
            <h1 ref={screenTitleRef} tabIndex={-1}>Give your attention a clean restart.</h1>
            <div className="reset-timer" aria-label={`${resetSeconds} seconds remaining`}>
              {String(Math.floor(resetSeconds / 60)).padStart(2, '0')}:{String(resetSeconds % 60).padStart(2, '0')}
            </div>
            <p className="gate-message">{fallback?.resetText}</p>
            <div className="gate-actions">
              <button className="button button--primary" type="button" disabled={isSubmitting} onClick={() => void runAction({ type: 'gate:action', action: 'reset_completed' })}>
                I completed the reset
              </button>
              <button className="button button--text" type="button" disabled={isSubmitting} onClick={() => void runAction({ type: 'gate:action', action: 'reset_skipped' })}>
                Skip reset
              </button>
            </div>
          </div>
        ) : null}

        {view === 'access' ? (
          <form className="gate-content access-form" onSubmit={(event) => {
            event.preventDefault();
            void runAction({ type: 'gate:action', action: 'intentional_access', purpose, durationMinutes: duration });
          }}>
            <p className="site-label">Intentional access</p>
            <h1 ref={screenTitleRef} tabIndex={-1}>Make the visit specific.</h1>
            <p className="gate-message">This opens only {context?.rule?.domain} and automatically restores the gate when the timer ends.</p>
            <label>
              Purpose
              <select value={purpose} onChange={(event) => setPurpose(event.target.value as AccessPurpose)}>
                {PURPOSE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Minutes <span>{duration} of {maxDuration}</span>
              <input type="range" min="1" max={maxDuration} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
            </label>
            <div className="gate-actions">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>Start timed access</button>
              <button className="button button--text" type="button" disabled={isSubmitting} onClick={() => setView('gate')}>Back</button>
            </div>
          </form>
        ) : null}

        {view === 'override' ? (
          <form className="gate-content access-form" onSubmit={(event) => {
            event.preventDefault();
            if (!overrideConfirmed) return;
            void runAction({ type: 'gate:action', action: 'override', purpose: overrideReason, durationMinutes: duration });
          }}>
            <p className="site-label">Override with friction</p>
            <h1 ref={screenTitleRef} tabIndex={-1}>Pause before changing the plan.</h1>
            <p className="gate-message">Overrides are neutral and temporary. Protection resumes automatically when this timer ends.</p>
            <label>
              Why is this necessary?
              <select value={overrideReason} onChange={(event) => setOverrideReason(event.target.value as AccessPurpose)}>
                {OVERRIDE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Minutes <span>{duration} of {maxDuration}</span>
              <input type="range" min="1" max={maxDuration} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
            </label>
            <label className="confirm-box">
              <input type="checkbox" checked={overrideConfirmed} onChange={(event) => setOverrideConfirmed(event.target.checked)} />
              <span>I understand this is temporary and the restriction will resume.</span>
            </label>
            <div className="gate-actions">
              <button className="button button--warning" type="submit" disabled={isSubmitting || !overrideConfirmed}>Override temporarily</button>
              <button className="button button--text" type="button" disabled={isSubmitting} onClick={() => setView('gate')}>Back</button>
            </div>
          </form>
        ) : null}
        {error ? <p className="error-message" role="alert">{error}</p> : null}
      </section>
      <p className="privacy-note">ScrollGate only stored the configured domain, not this page&apos;s full address.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<GateApp />);
