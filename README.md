# GTM Command Center / Container Atlas

Explore web and server-side GTM snapshots through **01 District** and **03 Signal Flow**. Both views share a dark grid, lime accents, and monospace headings. Audit paths and review local repair drafts without publishing changes to GTM.

Live app: https://gtmcc.organizedai.vip/style-gallery/explorer

## Develop and verify

```sh
npm ci
npm run build
npm test
npm run dev
```

Open `http://127.0.0.1:4173/style-gallery/explorer.html`. The local development
server uses the synthetic Northstar demo only; OAuth remains on production.
`http://127.0.0.1:4173/__responsive` is a development-only iframe harness for
320, 390, 768, and 1440 pixel viewport checks. It is not deployed.

## Perspectives

- **01 District:** one combined GTM container with its floors expanded by default, front-facing C01–C06 floor tags, schematic workers, and grouped path-health routes. **Split Web / Server** separates it into Web GTM and Server-side GTM buildings for inspection; the same control also separates Signal Flow lanes.
- **03 Signal Flow:** staged data-source, condition, processing, and context lanes with the same Path Status Groups used in District. Selecting routes within a status group keeps the list open; **Audit** opens evidence, repair actions, and a before/after workspace change review.
- **03 Signal Flow:** variables → consumers and firing/blocking triggers → tags. **Split Web / Server** pulls the two GTM surfaces into separately labeled lane groups while preserving the paths between them. Folder membership and version links remain context relationships. This is explanatory direction, not evidence of runtime execution or timing.

Click an element or select it in the Explorer to inspect its configuration and
typed relationships. Search, flagged/paused/isolated filters, focus, neighbor
isolation, label/path toggles, explode, top view, orbit, pan, and zoom are local
presentation controls. Canvas mode hides panels; full screen uses the browser
Fullscreen API. Reduced-motion preferences disable auto orbit and transitions.

Keyboard: `1 / 3` switch views, `/` searches, `R` fits the diagram, `T` toggles
top view, `M` toggles Canvas mode, `F` toggles browser full screen, `?` shows help.
The Explorer list is the keyboard-accessible equivalent of the 3D scene.

### Entity geometry

The existing colors are unchanged. Each entity type has its own shape in all
two perspectives, with matching geometry-generated miniatures in the Entity
Key, inventory headings, and connection inspector:

| Entity | Shape |
| --- | --- |
| Tags | Cube |
| Triggers | Diamond / octahedron |
| Variables | Cylinder |
| Built-in variables | Sphere |
| Folders | Tabbed folder |
| Versions | Stacked discs |
| Workspaces | Hexagonal prism |
| Permissions | Shield |
| Templates | Triangular prism |
| Clients | Cone |
| Transformations | Hourglass |
| Zones | Ring / torus |
| Environments | Pyramid |

Unrecognized types use a fallback polyhedron. Shape identifies type. District floors organize entities by function; Signal Flow organizes dependency stages. Geometry and
SVG key miniatures share `style-gallery/explorer-geometry.js`.

### Path signals

The **Paths** button shows/hides every path, packet, and glow together. **Signals**
opens the source picker, encoding legend, motion pause, and keyboard-accessible
path selector. Clicking a signal path also opens its metric inspector.

| Path encoding | Meaning |
| --- | --- |
| Packet density | Observed traffic count over the measurement window |
| Packet travel speed | Attributed firing count divided by window duration, in fires/minute |
| Thickness | Explicit supplied importance, 0–1; never inferred from connectivity |
| Color | Reported health: green healthy, amber degraded, rose failing, gray unknown |
| Glow | Health emphasis; stronger for degraded/failing paths, none for unknown |

Packet density and speed are compressed/capped visual scales, not a literal
one-dot-per-event replay. Failing-path glow breathes gently. **Pause motion**
freezes packets and glow; reduced-motion preferences make the layer static.
Folder membership, version-history links, and blocking rules never receive
traffic packets. Blocking rules retain their distinct dashed-line meaning.

The public Northstar fixture starts with a conspicuously labeled **SIMULATED**
one-minute scenario. Every simulated metric, including importance and health,
is illustrative. Private snapshots start in **Configuration only** mode and
offer no simulated-data option. There is no live traffic collector connected.

#### Importing measurements

Use **Signals → Template** to download the exact path identifiers for the current
snapshot, fill it from your measurement source, and use **Import JSON**. Imported
files remain in this tab's memory: no upload, browser persistence, or backend
write occurs. Reloading clears the import. The inspector says **IMPORTED**, not
live or independently verified.

Schema version 1 requires:

- `account_id` (when present in the snapshot), `container_id` matching the current
  numeric or public container ID, and `workspace_id` matching the current workspace.
- `source` naming the actual collector, report, or measurement source.
- `window_start` and `window_end`, ISO-8601 timestamps with timezones.
- `edges`, keyed by their raw snapshot `from`, `to`, and `kind` (not the reversed
  explanatory direction displayed by Signal Flow).
- Per edge: optional/null `traffic_count` and `fire_count` nonnegative integers,
  optional/null `importance` between 0 and 1, `health` in `healthy`, `degraded`,
  `failing`, or `unknown`, and a textual `evidence` explanation. Importance or a
  non-unknown health assessment requires evidence/basis.

Use observations and tag firings genuinely attributed to that specific path;
do not copy aggregate site totals onto every dependency. Missing metrics remain
missing (not zero). Unmatched paths, wrong targets, duplicate rows, invalid
windows/values, and unsupported assessments are rejected atomically. Invalid
imports do not replace a previously accepted dataset. Files are limited to 2 MB.

Measurements whose window ended more than 15 minutes ago are marked **STALE**:
historical numeric values remain inspectable, but health becomes neutral and
packets disappear. They are never silently replaced with demo data. The data
layer and renderer are isolated in `explorer-signals.js`,
`explorer-signal-controls.js`, and `explorer-path-visual.js`.

## Source and build layout

- `index.html`, `google-signin.js`, `style-gallery/`: editable frontend sources.
- `style-gallery/explorer-model.js`: pure graph, filter, relationship, and layout functions.
- `style-gallery/explorer.js`: Three.js scene and interface.
- `server/`: editable Worker authentication, API, and comparison sources.
- `docs/`: generated frontend assets and bundled `_worker.js`.
- `wrangler.worker.toml`: production Worker configuration; `wrangler.toml` is for the separate Pages project.
- `scripts/prepare-worker-assets.mjs`: prepares static Worker assets, excluding the server bundle and Pages routing file.
- `scripts/build.mjs`: copies frontend sources to `docs/`, vendors pinned Three.js,
  and embeds only the existing **synthetic** demo fixture in the public Atlas.

Do not edit generated `docs/style-gallery/` or `docs/vendor/` directly. The public
template's `const AUDIT=` marker is intentionally compatible with the existing
Worker's safe JSON replacement. Removed drift ghosts are excluded from Atlas's
current-inventory counts; use the classic Drift view for historical removals.

## Private snapshots

After connecting a workspace on the homepage, **Launch Container Atlas · 3D**
opens `/api/gtm/gallery/explorer.html?snapshot=…`. The server rechecks the session,
selected target, and encrypted snapshot on every request and sends `no-store,
private`. Snapshot identifiers are not authorization. Private data is not
written into static build assets or browser storage. The Atlas makes no new GTM
API calls. It does not modify or publish any container configuration.

The classic gallery also links to Atlas, preserving the active private snapshot.
Direct public Atlas visits show the clearly labeled demo, not an authenticated
workspace. A failing private request does not substitute demo data.

## Verification

80 automated tests cover graph filtering and direction, deterministic layouts,
empty/unknown/cyclic/600-element inputs, fixture provenance, OAuth state, CSRF,
target validation, encrypted snapshots, private-view session isolation, script
escaping, and version comparisons. Browser verification covers both views,
selection, isolation, empty search, Canvas mode, and 320–1440px layouts.
Geometry tests additionally cover unique shapes, unchanged colors, safe bounds,
raycast selection, and matching Entity Key miniatures.
Signal tests cover zero/missing distinctions, rate calculation, independent
encodings, stale and partial data, import validation, safe text rendering,
private-mode defaults, atomic import failures, and reduced-motion packets.

Private Atlas rendering is verified with mocked authenticated sessions. Real
Google authentication was not repeated during this change. Configuration-based
relationships cannot establish runtime firing, consent outcomes, or event volume.

## Deploy

Production is the existing Cloudflare Worker **gtmcc**, with the custom domain already attached. Use Wrangler (4.81.0 was used for this release):

```sh
npm ci
npm test
npm run build:worker
wrangler versions upload --config wrangler.worker.toml --message "Describe release"
wrangler versions deploy VERSION_ID@100 --config wrangler.worker.toml --yes --message "Describe release"
```

Replace `VERSION_ID` with the uploaded version. This preserves existing domain triggers and secrets. Configure credentials through Cloudflare; never commit secrets or `.dev.vars` files.

Production: https://gtmcc.organizedai.vip/style-gallery/explorer

The separate Pages project remains available but is not the primary destination. Release and rollback details are recorded in [verification/two-view-release.md](verification/two-view-release.md) and [verification/signal-flow-theme.md](verification/signal-flow-theme.md).

Production authentication still reports Google mode with `googleConfigured: false`. The public demo works; real sign-in requires completing provider configuration.

## Clerk sign-in

The Observatory-themed `/auth/` page and Clerk integration are ready for configuration. See [CLERK-SETUP.md](CLERK-SETUP.md) for activation, migration behavior, and live acceptance checks. The default retains the existing Google connector until `AUTH_PROVIDER=clerk` is set. Worker source now lives in `server/`; `npm run build` bundles it into `docs/_worker.js`.

---

Maintained by Jordaaan Hill ([LinkedIn](https://www.linkedin.com/in/jordaaanhill)).
