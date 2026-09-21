# Clerk sign-in for GTM Command Center

Status: linked to the user-selected Container Vizion application (`app_3JQEZIeNRC2H9JCHo0QIMgd86v3`). Development keys are configured in the ignored `.dev.vars` file in the local build directory. The real Clerk Google sign-in component renders at http://127.0.0.1:4180/auth/. Production is not configured or deployed; the intended production origin is https://gtmcc.organizedai.vip. The default deployment configuration remains in `google` mode until production setup is complete.

## What is ready

- `/auth/`: responsive district-themed sign-in page, public demo link, loading, retry, and signed-in states.
- Clerk's official JavaScript UI handles sign-in, sign-up, verification, account recovery, and any MFA/social methods enabled in your Clerk application. Account controls appear in the main page and Atlas navigation.
- `@clerk/backend` verifies session tokens on every private GTM request, restricts authorized origins, and accepts only user session tokens. The Google OAuth flow and connection are bound to both the Clerk user and the Clerk session.
- Google remains a separate read-only GTM connection. Its access tokens and snapshots remain encrypted in KV and expire within an hour. Clerk does not replace the GTM consent grant or remove Google's API verification requirements.
- Public demos remain public. Switching Clerk accounts or signing out removes the connected view; old Google cookies cannot authorize another Clerk session.

## Configure your application

1. Create or select your Clerk application. Enable the desired sign-in and sign-up methods in Clerk. Email verification and Google social sign-in are a useful starting point; the UI displays only enabled methods.
2. Set Clerk's application home URL to the app origin and its sign-in URL to `/auth/`. Successful sign-in/sign-up returns to `/#google-connection` to connect Google and select a workspace. Sign-up is handled by the Clerk sign-in component's built-in sign-up flow.
3. For a production instance, configure a domain you own and the Clerk DNS records. Clerk's production frontend API uses your domain; plan to attach a custom domain to this Pages project rather than treating the shared `pages.dev` hostname as your production Clerk domain. Development keys may be used for testing before that cutover.
4. In Cloudflare Pages, set `CLERK_PUBLISHABLE_KEY` and the matching **secret** `CLERK_SECRET_KEY`. Optionally set `CLERK_JWT_KEY` to Clerk's PEM public key for networkless verification. The secret key is still required by the current backend SDK. Never put the secret key in client files or commit it.
5. Set `AUTH_PROVIDER=clerk` in the `[vars]` section of `wrangler.toml` for deployment. Leave it unset or `google` until the keys and Clerk domain are ready. When set to `clerk`, missing keys fail closed; the app never silently falls back to Google-only authorization. Unknown provider values also fail closed.
6. If adding a custom domain, set `APP_ORIGIN` to its HTTPS origin and register the exact new `${APP_ORIGIN}/api/auth/callback` URI in the existing Google Web OAuth client. Keep the current Google secrets, KV namespace, and session encryption key.
7. Build, test, and deploy after configuration:

```sh
npm ci
npm run build
npm test
npx wrangler pages deploy docs --project-name gtm-command-center --branch main
```

Cloudflare secret prompts avoid putting the values in shell history:

```sh
npx wrangler pages secret put CLERK_PUBLISHABLE_KEY --project-name gtm-command-center
npx wrangler pages secret put CLERK_SECRET_KEY --project-name gtm-command-center
```

If managing a claimed application through the Clerk CLI, use `npx -y clerk@latest auth login`, link the specific application you choose, and follow Clerk's production deployment guidance. The CLI's `init` could not auto-detect this custom static app, so this implementation follows the official manual JavaScript quickstart. No temporary/accountless application was created. `clerk doctor` correctly reports no linked account or environment keys until you configure them.

## Cutover and migration

There is no local password database or permanent user table to export. Existing identities are encrypted, short-lived Google OAuth sessions. On enabling Clerk, those old sessions are intentionally rejected for private access. Users sign into Clerk and reconnect Google; no private snapshot is automatically imported or assigned by matching an email address. Ownership uses Clerk's stable user ID plus the active session ID. A new Clerk session requires a new Google connection, even for the same user.

## Verify after adding keys

1. Open `/auth/` and create your first Clerk test user. Confirm the profile control appears in the app and Atlas navigation.
2. Sign out, sign back in, exercise enabled recovery/verification flows, and confirm the return to the Google connection section.
3. Connect Google using an approved Google test user, select an account/container/workspace, and confirm the private Atlas renders the real snapshot.
4. Sign out of Clerk, then revisit the private snapshot URL. It must return no private data. Sign in as a different Clerk user and confirm the old Google connection is not accepted.
5. Cancel Google consent and confirm the page shows the cancellation message. Disconnect Google and confirm the app remains signed into Clerk but the private gallery is cleared.
6. Confirm public `/style-gallery/explorer#observatory` still works without signing in.

Automated tests use locally signed RSA fixtures and mocked Google responses. They verify cryptographic token validation, expiry, allowed origins, user/session binding, CSRF, and snapshot isolation; they do not prove your real Clerk keys, Google consent screen, emails, or provider configuration.

## Development and source

- Canonical Worker source: `server/worker.js`, `server/clerk-auth.js`, `server/comparison-core.js`.
- `npm run build` bundles that source into `docs/_worker.js`; do not edit the generated Worker.
- `npm run dev` serves a static UI preview. It deliberately cannot sign into Google or load real Clerk credentials. Real auth acceptance testing uses configured HTTPS Pages/Worker hosting.
- `.env*` and `.dev.vars*` are ignored. No credentials are included in this change.

References: [Clerk setup skill](https://clerk.com/SKILL.md), [JavaScript quickstart](https://clerk.com/docs/js-frontend/getting-started/quickstart), [backend verification](https://clerk.com/docs/reference/backend/authenticate-request), [production environments](https://clerk.com/docs/guides/development/managing-environments).

## Configuration checkpoint — September 16, 2026

- Clerk CLI authenticated; Container Vizion selected by the user and linked.
- Development instance: `ins_3JQEZME6cjjw6WdBjGjWSDBXhQc`. Existing Google sign-in method preserved.
- Development keys pulled by Clerk directly to `.dev.vars`, mode 600; no secret values printed or added to source.
- Local Worker preview: http://127.0.0.1:4180/auth/. Real Clerk UI rendered on desktop and 390px mobile, without browser errors or horizontal overflow. First-user sign-in still needs user validation.
- All 56 automated tests passed; build passed.
- Installed local Worker runtime supports compatibility date 2026-04-12, so preview uses that override; deployment source still uses 2026-09-04.
- `clerk deploy status`: `not_started`; no production instance, domain, DNS records, or certificates configured.
- Automatic approval review rejected `clerk deploy --mode agent` as potentially changing production. Explicit production approval is pending.
- Proposed activation: create Container Vizion production instance for gtmcc.organizedai.vip, configure Clerk DNS and Google OAuth, securely install production keys, change AUTH_PROVIDER to clerk and APP_ORIGIN to the custom domain, then build and deploy after verification.
- Google GTM API connection is separate from Clerk login and still needs the website OAuth client configuration. Its callback will be https://gtmcc.organizedai.vip/api/auth/callback.
