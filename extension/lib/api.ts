import type { LocalEvent, RemoteConfig, RemoteCredential } from './types';
import { parseRemoteConfig, parseRemoteIntervention } from './validation';

const REQUEST_TIMEOUT_MS = 8_000;

export class RemoteRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'RemoteRequestError';
    this.status = status;
  }
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RemoteRequestError(
        response.status === 401 || response.status === 403
          ? 'The extension session has expired. Pair it again to resume sync.'
          : 'The ScrollGate service rejected this request.',
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new RemoteRequestError('The ScrollGate service returned an invalid response.');
    }
  } catch (error) {
    if (error instanceof RemoteRequestError) throw error;
    throw new RemoteRequestError('Could not reach the ScrollGate service.');
  } finally {
    clearTimeout(timeout);
  }
}

function bearerHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function parsePairingResponse(value: unknown): { credential: RemoteCredential; config: RemoteConfig } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const deviceToken = typeof raw.deviceToken === 'string' ? raw.deviceToken.trim() : '';
  const browserId = typeof raw.browserId === 'string' ? raw.browserId.trim() : '';
  const config = parseRemoteConfig(raw);
  if (!deviceToken || deviceToken.length > 4_096 || !browserId || browserId.length > 256 || !config) {
    return null;
  }
  return { credential: { baseUrl: '', deviceToken, browserId }, config };
}

export async function pairExtension(
  baseUrl: string,
  pairingCode: string,
): Promise<{ credential: RemoteCredential; config: RemoteConfig }> {
  const payload = {
    pairingCode,
    deviceLabel: 'ScrollGate Chromium extension',
    browserFamily: 'chromium' as const,
    extensionVersion: chrome.runtime.getManifest().version,
  };
  const result = await requestJson(endpoint(baseUrl, '/api/extension/pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const parsed = parsePairingResponse(result);
  if (!parsed) throw new RemoteRequestError('The ScrollGate service returned an invalid pairing response.');
  return { ...parsed, credential: { ...parsed.credential, baseUrl } };
}

export async function fetchRemoteConfig(credential: RemoteCredential): Promise<RemoteConfig> {
  const result = await requestJson(endpoint(credential.baseUrl, '/api/extension/config'), {
    method: 'GET',
    headers: bearerHeaders(credential.deviceToken),
  });
  const config = parseRemoteConfig(result);
  if (!config) throw new RemoteRequestError('The ScrollGate service returned an invalid configuration.');
  return config;
}

export async function postRemoteEvent(credential: RemoteCredential, event: LocalEvent): Promise<void> {
  if (!event.gateId) throw new RemoteRequestError('A paired event must include its gate identifier.');
  await requestJson(endpoint(credential.baseUrl, '/api/extension/events'), {
    method: 'POST',
    headers: bearerHeaders(credential.deviceToken),
    body: JSON.stringify(event),
  });
}

export async function fetchIntervention(credential: RemoteCredential, gateId: string) {
  const result = await requestJson(endpoint(credential.baseUrl, '/api/interventions'), {
    method: 'POST',
    headers: bearerHeaders(credential.deviceToken),
    body: JSON.stringify({ attemptId: gateId }),
  });
  const intervention = parseRemoteIntervention(result);
  if (!intervention) throw new RemoteRequestError('The ScrollGate service returned an invalid intervention.');
  return intervention;
}
