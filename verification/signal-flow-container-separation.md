# Signal Flow container separation

Prepared 2026-09-21.

- Added a Signal Flow-only **Split Web / Server** toggle.
- The separated layout creates aligned, labeled lane groups for WEB GTM and SERVER GTM.
- Cross-container paths remain visible across the space between the surfaces.
- Single-surface snapshots disable the control instead of implying a missing container.
- District does not show the Signal Flow control.

Validation: build succeeded; all 81 tests passed. Browser verification confirmed the toggle changes to pressed state, separates the two surfaces, returns to the combined layout, remains hidden in District, and produces no console errors.
