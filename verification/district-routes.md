# District route clarity

Preview: http://127.0.0.1:4179/style-gallery/explorer#district

- Deterministic orthogonal route lanes with rounded corners, dedicated external risers, and separate low web/server bridges. Existing endpoints and signal data are preserved.
- Expanded floors now use larger footprints and wider entity spacing, with 18/22/26-unit floor gaps for Comfortable/Wide/Maximum spread.
- Pulling a floor out moves it farther away, zooms to it, reveals its entity labels, and dims unrelated paths. Selecting an element then follows it back to its floor.
- Added a web/server-only route filter. Existing inspector and signal controls are reused.

Validation: build and all 64 tests passed. New tests cover endpoint preservation, finite orthogonal routes, deterministic lane assignment, expanded geometry, and self loops. Browser checks covered Maximum spread, floor pull-out, and subsequent element inspection without renderer errors.

The source and generated preview files are saved locally. No production deployment was performed.
