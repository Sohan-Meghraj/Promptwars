import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sendExtensionMessage } from '../../lib/messaging';
import type { ExtensionMessage, PopupState } from '../../lib/types';
import '../../styles/shell.css';
import './popup.css';

type PopupAction = Extract<
  ExtensionMessage,
  { type: 'popup:enable-protection' | 'popup:sync-local' | 'popup:sync-remote' }
>;

function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function until(expiresAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1_000));
  return formatMinutes(seconds);
}

function PopupApp() {
  const [state, setState] = useState<PopupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [, setClock] = useState(Date.now());
  const [serviceUrl, setServiceUrl] = useState('http://localhost:3000');
  const [pairingCode, setPairingCode] = useState('');

  const loadState = useCallback(async () => {
    const result = await sendExtensionMessage<PopupState>({ type: 'popup:get-state' });
    if (!result.ok || !result.data) throw new Error(result.error ?? 'Could not load extension state.');
    setState(result.data);
  }, []);

  useEffect(() => {
    void loadState().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load extension state.');
    });
  }, [loadState]);

  useEffect(() => {
    if (state?.connection.serviceUrl) setServiceUrl(state.connection.serviceUrl);
  }, [state?.connection.serviceUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const runAction = useCallback(async (message: PopupAction) => {
    setIsWorking(true);
    setError(null);
    try {
      const result = await sendExtensionMessage<PopupState>(message);
      if (!result.ok || !result.data) throw new Error(result.error ?? 'The extension could not complete that action.');
      setState(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The extension could not complete that action.');
    } finally {
      setIsWorking(false);
    }
  }, []);

  const pair = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsWorking(true);
    setError(null);
    try {
      const result = await sendExtensionMessage<PopupState>({
        type: 'popup:pair-remote',
        baseUrl: serviceUrl,
        pairingCode,
      });
      if (!result.ok || !result.data) throw new Error(result.error ?? 'Could not pair this extension.');
      setPairingCode('');
      setState(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not pair this extension.');
    } finally {
      setIsWorking(false);
    }
  }, [pairingCode, serviceUrl]);

  const endAccessEarly = useCallback(async (grantId: string) => {
    setIsWorking(true);
    setError(null);
    try {
      const result = await sendExtensionMessage<null>({ type: 'access:end-early', grantId });
      if (!result.ok) throw new Error(result.error ?? 'Could not end temporary access.');
      await loadState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not end temporary access.');
    } finally {
      setIsWorking(false);
    }
  }, [loadState]);

  const protectionReady = state?.protectionPermissionGranted === true;
  const isPaired = state?.connection.mode === 'paired';
  const remoteReady = isPaired && state?.connection.status === 'ready';
  const connectionStatus = state?.connection.status.replaceAll('_', ' ') ?? 'not ready';
  const refreshAction: PopupAction = !protectionReady
    ? { type: 'popup:enable-protection' }
    : isPaired
      ? { type: 'popup:sync-remote' }
      : { type: 'popup:sync-local' };

  return (
    <main className="popup-shell" aria-busy={state === null}>
      <header className="popup-header">
        <div>
          <p className="wordmark">SCROLLGATE</p>
          <h1>Protect your focus.</h1>
        </div>
        <span className={`status-dot ${protectionReady ? 'status-dot--good' : ''}`} aria-label={protectionReady ? 'Protection enabled' : 'Protection needs permission'} />
      </header>

      <section className="popup-card" aria-live="polite">
        <p className="eyebrow">Connection</p>
        <p className="status-line">
          {isPaired ? (remoteReady ? 'Connected and synchronized' : 'Saved rules are protecting locally') : protectionReady ? 'Local protection is on' : 'Site access is needed'}
        </p>
        <p className="muted-copy">
          {isPaired
            ? `Service status: ${connectionStatus}. Local rules stay active if the service is unavailable.`
            : protectionReady
              ? 'Rules, gates, and access timers are running only in this browser.'
              : 'Enable access before ScrollGate can redirect sites you choose to protect.'}
        </p>
        <button
          className="button button--primary"
          type="button"
          disabled={isWorking}
          onClick={() => void runAction(refreshAction)}
        >
          {isWorking ? 'Working...' : !protectionReady ? 'Enable site protection' : isPaired ? 'Sync from dashboard' : 'Refresh protection'}
        </button>
      </section>

      {!isPaired ? (
        <form className="popup-card pairing-form" onSubmit={(event) => void pair(event)}>
          <p className="eyebrow">Connect account</p>
          <label>
            ScrollGate service URL
            <input
              type="url"
              value={serviceUrl}
              onChange={(event) => setServiceUrl(event.target.value)}
              placeholder="https://your-app.vercel.app"
              required
            />
          </label>
          <label>
            Six-digit pairing code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              required
            />
          </label>
          <button className="button button--secondary" type="submit" disabled={isWorking}>Pair extension</button>
        </form>
      ) : null}

      {state?.activeGrants.length ? (
        <section className="popup-card popup-card--access">
          <p className="eyebrow">Intentional access</p>
          {state.activeGrants.map((grant) => (
            <div className="access-row" key={grant.id}>
              <div>
                <strong>{grant.domain}</strong>
                <span>{until(grant.expiresAt)} remaining</span>
              </div>
              <button
                className="button button--quiet"
                type="button"
                disabled={isWorking}
                onClick={() => void endAccessEarly(grant.id)}
              >
                End now
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="popup-summary" aria-label="Extension status">
        <div><strong>{state?.activeRules.length ?? 0}</strong><span>active rules</span></div>
        <div><strong>{state?.eventCount ?? 0}</strong><span>local events</span></div>
        <div><strong>{state?.pendingGateCount ?? 0}</strong><span>open gates</span></div>
      </section>

      <p className="local-note">
        {isPaired
          ? 'Only configured-domain events are queued for ScrollGate. Complete URLs and page content stay out of the extension log.'
          : 'Local fallback mode - no account, AI, or browsing data is sent anywhere.'}
      </p>
      {error ? <p className="error-message" role="alert">{error}</p> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<PopupApp />);
