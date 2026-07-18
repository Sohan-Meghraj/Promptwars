# ScrollGate production deployment runbook

This runbook deploys the ScrollGate web app at [promptwars-flame.vercel.app](https://promptwars-flame.vercel.app) and covers distribution and pairing of the Chrome extension that enforces saved restrictions.

## 1. Production prerequisites

- A Vercel project connected to this `scrollgate` directory.
- A Supabase project with the included schema migration applied.
- A Chrome extension build created from `extension/`.

The web app stores rules and manages paired browsers. The browser extension applies the synced rules locally before a matching site loads.

## 2. Configure Vercel

In **Vercel → Project → Settings → Environment Variables**, set these values for the **Production** environment:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SCROLLGATE_TOKEN_PEPPER=
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
```

Important:

- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, `SCROLLGATE_TOKEN_PEPPER`, or `GROQ_API_KEY` to the browser. Never rename them with a `NEXT_PUBLIC_` prefix.
- Use one stable, random `SCROLLGATE_TOKEN_PEPPER`. Changing it invalidates existing pairing codes and browser tokens.
- Redeploy after adding or changing environment variables.

## 3. Configure Supabase

### Apply the schema migration

Before users create rules or pair browsers, apply [`supabase/migrations/20260718065617_scrollgate_mvp_schema.sql`](supabase/migrations/20260718065617_scrollgate_mvp_schema.sql) in the Supabase SQL Editor or with the Supabase CLI.

### Add the production authentication redirect

In **Supabase → Authentication → URL Configuration**, add this redirect URL:

```text
https://promptwars-flame.vercel.app/auth/callback
```

Set the site URL to:

```text
https://promptwars-flame.vercel.app
```

The redirect is required for sign-up email confirmation and authentication redirects back into the app.

## 4. Verify the deployed web app

Open [promptwars-flame.vercel.app](https://promptwars-flame.vercel.app), then:

1. Sign in.
2. Create a restriction using a domain only, such as `youtube.com`.
3. Make sure the rule is enabled, includes the current day, and has a time window that includes the current time.
4. Open **Browsers** and generate a one-time pairing code.

## 5. Build the Chrome extension

From the `extension` directory:

```powershell
cd extension
npm install
npm run build
```

The unpacked Chrome build is created at:

```text
extension/.output/chrome-mv3
```

### Developer testing

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the `extension/.output/chrome-mv3` folder.

### Distribution to users

From `extension/`, run:

```powershell
npm run zip
```

Upload the generated package through the Chrome Web Store developer dashboard. End users should install it from the store rather than enabling Developer mode.

## 6. Pair a browser with the deployed app

Each browser must be paired with the account that owns the rules.

1. In the deployed ScrollGate app, open **Browsers**.
2. Select **Generate one-time code**.
3. Open the ScrollGate extension popup in Chrome.
4. Select **Enable site protection** and approve Chrome's site-access request.
5. Enter this app URL exactly:

   ```text
   https://promptwars-flame.vercel.app
   ```

6. Enter the six-digit pairing code and select **Pair extension**.
7. Select **Sync from dashboard**.
8. Refresh the **Browsers** page; the browser should appear as paired with a recent sync time.

Pairing codes are single-use and expire after ten minutes. The extension receives only an opaque device token and the paired user's restrictions; it never receives the Supabase service-role key or an account password.

## 7. Test a restriction

For a quick test, save a rule with:

```text
Domain: youtube.com
Active days: every day
Start time: before the current time
End time: after the current time
Enabled: yes
```

In the extension popup, select **Sync from dashboard**. Close any existing YouTube tab, then open `https://youtube.com` in a new tab. The ScrollGate gate should appear.

## 8. Update rules after deployment

When a user changes a rule:

1. Use **Edit** on the existing rule card rather than creating a second rule for the same domain.
2. Save the changes.
3. Open the extension popup and select **Sync from dashboard**.
4. Open a new matching browser tab to test the update.

Only one rule per domain is permitted for each account. For example, edit the existing `youtube.com` rule instead of creating another one.

## 9. Troubleshooting

| Symptom | Check |
| --- | --- |
| The rule saves but the site still opens | Confirm the extension is installed, paired, enabled, and synced. Check that the rule is active now. |
| The extension is installed but does not appear under Browsers | Pair it with a new one-time code using the production URL above. |
| Pairing fails | Confirm the Vercel server-only variables and database migration are present. Generate a fresh code; codes expire after ten minutes. |
| A save says the migration is missing even though a rule exists | The app may be trying to create a duplicate domain. Use **Edit** for the existing rule. |
| A rule does not apply | Use only a domain, such as `youtube.com`; do not include `https://`, paths, or query strings. Confirm the day, timezone, and time window. |
| The browser can still open the site after an edit | Select **Sync from dashboard** in the extension popup, then navigate in a new tab. |

## 10. Production checklist

- [ ] Vercel production environment variables are set.
- [ ] Vercel deployment is live at `https://promptwars-flame.vercel.app`.
- [ ] Supabase migration has been applied.
- [ ] Supabase has the production callback URL and site URL.
- [ ] Chrome extension has been built or published.
- [ ] Site protection is enabled in the extension.
- [ ] A browser is paired and visible under **Browsers**.
- [ ] An enabled, currently active test rule blocks `youtube.com` after sync.
