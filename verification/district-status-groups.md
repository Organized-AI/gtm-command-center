# District path status grouping

Added adjacent route lanes grouped by Failing, Degraded, Healthy, Unknown, Blocking rules, and Context. Extra spacing separates status groups. Counts reflect visible nodes and the selected route scope. Clicking a status isolates that group and lists its paths in the existing inspector; clicking a path opens the existing signal detail card.

Missing or stale measurement health is Unknown. Blocking rules and organizational links remain distinct from tracking failures. The current synthetic sample is clearly labeled Simulated. Status changes recalculate layout bounds, and keyboard focus is retained when status buttons refresh.

Validation: npm run build succeeded; npm test passed all 68 tests, including four status-group regression tests. Browser checks verified failing-group filtering, individual path inspection, reset to all routes, and configuration-only mode with 24 unknown signal paths and nine context links. At 390px width document content was 390px with no horizontal overflow. Browser error log was empty.

Preview: http://127.0.0.1:4179/style-gallery/explorer#district

Local preview only; not deployed to production.
