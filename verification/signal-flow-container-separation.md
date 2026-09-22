# Signal Flow container separation

Prepared 2026-09-21.

- Added a shared **Split Web / Server** toggle to District and Signal Flow.
- In District it switches between one combined GTM container and separate Web GTM and Server-side GTM buildings while retaining every element and routed connection.
- The separated layout creates aligned, labeled lane groups for WEB GTM and SERVER GTM.
- Cross-container paths remain visible across the space between the surfaces.
- Single-surface snapshots disable the control instead of implying a missing container.
- The pressed state carries between views, so both perspectives show the same separated-surface choice.

Validation: build succeeded; automated layout tests cover both perspectives. Browser verification confirms the shared pressed state, one combined District building, separate Web and Server District buildings, separated Signal Flow lanes, return to the combined layouts, and no console errors.
