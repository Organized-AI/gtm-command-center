# Diagram audit and repair workbench

Audit sits between Signals and Labels in the main diagram toolbar. It opens an unhealthy path in the existing inspector. Individual paths and element-connected paths also provide access to the workbench.

The workbench reports supplied health evidence, endpoint flags and paused state, existing audit recommendations, and a relationship-specific verification checklist. It does not infer a proven root cause from path color. Configuration changes are reviewed with before/after values and applied to an in-memory local draft. Entity identity and captured revision fields are protected; invalid JSON and malformed known fields are rejected. Reviewed drafts can be exported as a scoped fix plan or discarded. They are not live GTM writes or GTM container import files. The existing OAuth scope remains read-only.

An animated worker approaches the path and performs a repair with visible progress and cancellation. Demo repair updates only simulated health, supports undo, and never rewrites real measurements. Applying configuration drafts preserves runtime health until independently verified. Reduced-motion mode skips movement and quickly completes the local operation.

District entities are approximately 65% wider with additional floor spacing. Screen-space selection padding improves node and path picking; labels are clickable. Toolbar buttons and inspector actions have at least 44px targets.

Validation: build succeeded; all 75 tests passed. Browser checks covered Audit toolbar placement, unhealthy path evidence, invalid JSON rejection, exact parameter diff, draft completion while health stayed failing, simulated repair, undo, cancellation, visible worker animation, and mobile layout at 390px without horizontal overflow. Mobile toolbar targets measured at least 44 by 44px. Browser error log empty.

Preview: http://127.0.0.1:4179/style-gallery/explorer#district

Limitations: drafts are in-memory and lost on reload unless exported. Applying fixes to real GTM workspaces still requires a separately implemented write-capable connection; this change does not claim live repairs. Production was not deployed.
