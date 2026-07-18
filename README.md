# ScrollGate prototype

ScrollGate is a local-first browser focus prototype. The web app manages rules and browser pairing; the Chromium extension enforces an active rule before the distracting page loads. It uses Supabase for authenticated data and Groq only from the server for optional, structured intervention copy.

## What is implemented

- Next.js App Router dashboard, email/password auth screens, restriction workspace, browser pairing screen, insights, and settings.
- Supabase migration with RLS on all ten tables, server-only device/pairing tokens, event replay protection, and rule-version sync.
- Server routes for one-time extension pairing, configuration sync, event ingestion, and validated Groq interventions with an honest local fallback.
- Chromium Manifest V3 extension foundation with pre-load dynamic-rule enforcement, schedules, temporary access, and a gate UI.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the values from your Supabase project. Keep all server-only values private.
2. Apply `supabase/migrations/20260718065617_scrollgate_mvp_schema.sql` to the project database. The migration is safe to apply only to a fresh prototype project.
3. In Supabase Auth URL Configuration, add `http://localhost:3000/auth/callback` as a redirect URL and enable Email/Password authentication.
4. Start the app:

   ```bash
   npm run dev
   ```

5. Build the extension and load `extension/.output/chrome-mv3` as an unpacked extension in Chromium:

   ```bash
   cd extension
   npm run build
   ```

6. Sign in, create a restriction, open **Browsers**, create a one-time code, and use the extension popup to pair it to the app URL.

## Environment variables

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SCROLLGATE_TOKEN_PEPPER=
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
```

`SCROLLGATE_TOKEN_PEPPER` should be a new, random secret; it lets the server store only HMAC digests of pairing codes and browser tokens. If `GROQ_API_KEY` is absent or Groq fails validation, the gate uses a clearly labelled local fallback without weakening enforcement.

## Verification

```bash
npx eslint src --max-warnings 0
npx tsc --noEmit
npm run build
cd extension && npm run typecheck && npm run build
```

No Supabase project, Vercel project, Gemini account, or browser profile is created or changed by this repository.
