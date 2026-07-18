"use client";

import { Copy, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

type PairingCode = { code: string; expiresAt: string };

export function PairingCodeCard() {
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createCode() {
    setLoading(true);
    setStatus(null);
    try {
      const response = await fetch("/api/extension/pair-code", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json() as PairingCode & { error?: string };
      if (!response.ok || !payload.code || !payload.expiresAt) throw new Error(payload.error || "Unable to create a pairing code.");
      setPairing({ code: payload.code, expiresAt: payload.expiresAt });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create a pairing code.");
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.code);
    setStatus("Code copied.");
  }

  return (
    <section className="pairing-card" aria-labelledby="pairing-title">
      <div className="pairing-icon"><Link2 size={22} aria-hidden="true" /></div>
      <div className="pairing-copy"><h2 id="pairing-title">Pair a browser</h2><p>Generate a one-time code, then enter it in the ScrollGate extension. It expires after ten minutes.</p></div>
      {pairing ? (
        <div className="pairing-code-wrap">
          <strong className="pairing-code">{pairing.code}</strong>
          <button className="button-secondary" type="button" onClick={() => void copyCode()}><Copy size={16} /> Copy</button>
          <p>Expires {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(pairing.expiresAt))}.</p>
          <button className="text-button" type="button" onClick={() => void createCode()} disabled={loading}><RefreshCw size={14} /> Generate another</button>
        </div>
      ) : (
        <button className="button-primary" type="button" onClick={() => void createCode()} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} Generate one-time code</button>
      )}
      {status && <p className="form-note" role="status">{status}</p>}
    </section>
  );
}
