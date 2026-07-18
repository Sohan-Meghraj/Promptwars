# ScrollGate Chrome extension

This package is a Chrome Manifest V3 extension built with WXT and React.

## Local-first prototype with optional pairing

Rules, pending gates, temporary-access grants, and event retries are stored in
`chrome.storage.local`. The extension works from its last successfully synchronized
rules when offline. It contains no model API key: model requests always go through
the authenticated ScrollGate backend.

## Run it

```powershell
npm install
npm run dev
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `scrollgate/extension/.output/chrome-mv3`.

For a production artefact, run `npm run build` and load the same output folder.
Site access is requested only after selecting **Enable site protection** or
**Pair extension** in the popup. Rules will not be enforced until that permission
is granted.

## Current local behaviour

- Pair a deployed dashboard by entering its HTTPS URL and a six-digit pairing code.
  The device token is stored only in extension-local storage and is never shown in
  the popup or written to logs.
- Fetches rules from `GET /api/extension/config`, applies them locally, and retains
  the last good configuration if sync fails.
- Delivers configured-domain events one at a time to `/api/extension/events`, with
  persisted exponential-backoff retries. Complete URLs and page content are never sent.
- Requests `/api/interventions` only after the gate event has been accepted. If any
  request fails, the gate remains active and displays a clearly marked local fallback.
- Stores synchronized rules locally and evaluates schedules in each rule's timezone.
- Reconciles active domain redirects using dynamic Declarative Net Request rules.
- Persists pending gates and temporary grants; a Chrome alarm restores protection
  when a grant expires, including after service-worker restarts.
- Provides Return, Reset, Intentional Access, and friction-based Override actions.
- Logs only configured-domain event metadata locally—never complete URLs or page content.

The backend contract is defined in the project application. Keep all pairing and AI
calls server-side; the extension must never include a Supabase service key, Gemini key,
or user password.
