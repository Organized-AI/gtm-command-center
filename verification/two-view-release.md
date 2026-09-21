# District + Signal Flow release

Deployed 2026-09-21 from Jordan’s Mac mini.

## Production destination

https://gtmcc.organizedai.vip/style-gallery/explorer

Cloudflare Worker: `gtmcc` (existing custom domain preserved).
Version serving 100%: `fdc46bda-2607-4d02-a17a-9aa1d6a084de`.
Previous version for rollback: `fd24eb73-6238-48ab-9007-0fb530cf7dbe`.

Only 01 District and 03 Signal Flow appear in Explorer navigation. Shortcuts are 1 and 3; removed view hashes fall back to District. Auth demo links and dashboard launch links use the same Explorer; private snapshot parameters remain intact.

## Verification

- Build succeeded; all 80 existing tests passed before publishing.
- Production has exactly two view controls, with successful switching.
- Path Status Group stays open through successive route selections.
- Audit opens the repair workbench with configuration evidence and review controls.
- No browser console errors during production smoke checks.
- Session KV and APP_ORIGIN preserved. Worker logging enabled at 100% sampling.
- Authentication unchanged: `/api/auth/config` returns Google mode with `googleConfigured: false`. Real sign-in is not configured by this release.

## Future releases

Use the Worker config for this domain, not the separate Pages project.

```sh
npm ci
npm test
npm run build:worker
wrangler versions upload --config wrangler.worker.toml --message "Describe release"
wrangler versions deploy VERSION_ID@100 --config wrangler.worker.toml --yes --message "Describe release"
```

`worker-assets` excludes `_worker.js` and `_routes.json`. The bundled server entry is uploaded separately. Existing secrets are retained; version deployment preserves domain triggers. Wrangler 4.81.0 was used for this release.

Rollback:

```sh
wrangler versions deploy fd24eb73-6238-48ab-9007-0fb530cf7dbe@100 --config wrangler.worker.toml --yes --message "Rollback two-view release"
```

The same build was also deployed to the separate Pages project at https://95370926.gtm-command-center-96l.pages.dev before the custom-domain destination was confirmed. It is not the intended production URL.
