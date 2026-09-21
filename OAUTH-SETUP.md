# Google Sign-in activation

The site includes server-side OAuth and an authenticated GTM account/container/workspace picker.

## Activation status — September 5, 2026

- Dedicated project: `gtm-command-center-auth` (`621334408624`). The existing `organizedai` OAuth configuration was not changed.
- Tag Manager API: enabled.
- Consent app: GTM Command Center; External audience, Testing mode.
- Support and developer contact: `jordan@bluehighlightedtext.com`.
- Web OAuth client: `GTM Command Center - Web Sign-in`, created with the callback below.
- Production `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured as Cloudflare Pages secrets. Values are not in this repository.
- Redeployed successfully; `/api/auth/status` returns `configured: true`. `/api/auth/start` returns a Google authorization redirect with PKCE and only identity plus GTM read-only scopes.
- Test-user save is **not confirmed**. The Google Console Add users dialog remained open after save attempts, and the persisted list was still empty on reload. Complete that step for the approved initial user, `jordan@bluehighlightedtext.com`.
- Google still reports incomplete branding for publishing; no public launch or verification was performed.
- Real sign-in is now verified: the user's authenticated session selected prowaken.com, workspace 7, and successfully captured its live GTM data. The earlier callback redirect-mode bug was fixed without broadening scopes.

## Required Google setup

1. Choose a dedicated Google Cloud project and enable the **Tag Manager API**.
2. Configure the Google Auth Platform consent screen, audience, support email, and approved app domains as applicable. During testing, add the intended Google users as test users. Public launch may require verification for the requested scope.
3. Create an OAuth client of type **Web application** (not Desktop app).
4. Register this exact authorized redirect URI:
   `https://gtm-command-center-96l.pages.dev/api/auth/callback`
5. Set the production Pages secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never place the client secret in HTML, JavaScript, a public asset, git, or chat.

Example secret commands (prompts accept values privately):

```sh
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name gtm-command-center
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name gtm-command-center
```

Redeploy after secrets change. Do not overwrite the session encryption key unless intentionally invalidating all sessions.

## Server bindings

- `APP_ORIGIN`: production URL, fixed to prevent callback host manipulation.
- `GTM_SESSIONS`: dedicated KV namespace.
- `SESSION_ENCRYPTION_KEY`: 32 random bytes encoded as base64url, stored as a Pages secret.
- Google tokens are AES-GCM encrypted before KV storage.
- Cookie values are opaque, random identifiers; KV session keys are their SHA-256 hashes.
- Cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, host-only and short-lived.
- OAuth uses state bound to a browser cookie plus PKCE S256. No token is returned to the browser.
- Requests ask for `openid email profile` and `https://www.googleapis.com/auth/tagmanager.readonly` only.
- No offline refresh tokens are requested. Sessions expire within one hour and require another sign-in.
- Sign-out deletes the app session; it does not revoke the Google app consent grant. Users can revoke that in their Google account settings.

## Allowed operations

GTM calls are limited to reading accounts, containers, workspaces, workspace entities, and version headers for the selected container. Connecting saves the target in the user's session and automatically captures a private gallery snapshot. It does not create a Google account, mutate GTM, publish a version, or write private data into public assets.

## Private live gallery

- `/api/gtm/gallery` returns the selected workspace's current snapshot metadata, when available.
- `/api/gtm/gallery/refresh` requires a session and CSRF-checked POST. It performs paginated GET-only GTM reads and saves an encrypted snapshot with the session's expiry.
- `/api/gtm/gallery/index.html` and the eight style endpoints render that snapshot privately. Every request rechecks the session and target; snapshot IDs do not grant access by themselves.
- The main page switches to this gallery on connection, restores it on reload, and provides Refresh from GTM for subsequent captures. A failed capture is shown as an error, not silently replaced with demo data.
- Reads are sequential and conservatively paced. Quota or core-collection failures abort capture rather than returning partial success.
- Scores and recommendations are not fabricated by the live connector. The gallery displays unassessed scores until the audit engine evaluates a snapshot.
- Version headers provide count history. The Versions tab fetches full GTM versions on demand and compares two stored versions, or one stored version against the captured workspace. Full-version payloads are encrypted and cached within the authenticated session.
- `/api/gtm/versions/compare` validates the selected container, snapshot ownership, and both version IDs. It never accepts arbitrary Google API paths or writes to GTM.
- Drift only displays configuration additions, removals, and modifications. Fingerprints, root metadata, version-header records, inferred reference nodes, and risk-only changes are not configuration drift. Before/after details are rendered as text, never executed.
- The static `/style-gallery/` remains a separate Northstar demo. It never contains private live snapshots.

Live verification: prowaken.com / GTM-KSP4TVTC / workspace 7 returned 15 tags, 6 represented triggers (including system trigger references), and 11 user variables. Both Structured 3D and Utility 2D displayed the private snapshot. Logged-out gallery requests returned 401 with no-store headers.

Authenticated endpoints return `Cache-Control: no-store, private`. There are no wildcard CORS permissions. POSTs require an exact Origin and a session-specific CSRF token. Secrets are not available to the static gallery.

## Remaining live acceptance check

After setting the Web OAuth client secrets, complete consent with a real GTM user. Verify accounts match that user, select a container/workspace, then sign out and confirm `/api/gtm/accounts` no longer returns private data. The automated mocked tests do not prove that the Google client or consent screen has been configured correctly.
