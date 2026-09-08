# GTM command center

Production: https://gtm-command-center-96l.pages.dev/

## Autoresearch container view

`docs/autoresearch.js` consumes the `gtm-workspace-snapshot` event from the existing
Google connection flow. It opens the authenticated structured 2D/3D renderer,
provides container/version/drift navigation, and preserves selected version IDs
when switching dimensions. No additional GTM read requests are used to acquire
the shared snapshot. Experiment evaluation is explicitly unassessed.

Run verification from the repository root:

```sh
node --check docs/autoresearch.js
node --check docs/google-signin.js
node --test tests/*.test.cjs
```

## Recovery and deployment status

The GitHub repository previously contained only an old static page. The public
frontend was recovered from production on 2026-09-08; its previous asset manifest
is in `recovery/asset-manifest.json`. The active Cloudflare deployment is
`510280aa-872b-4a5e-a731-289e5d96b193`.

**Do not deploy this static directory by itself.** The current authenticated
Pages Functions source/bundle is absent from the repository. A static-only
deployment would remove the Google OAuth and private snapshot endpoints.
The current backend also rejects requests to preview deployment origins, so a
proxy to an immutable preview URL cannot preserve the connection.

Restore the current Pages Functions or `_worker.js` bundle, then deploy the
complete project with its existing Google secrets, `APP_ORIGIN`, and
`GTM_SESSIONS` binding intact. `wrangler.toml` was downloaded from Cloudflare.
No secrets, cookies, private GTM snapshots, or user credentials were recovered
into this repository.
