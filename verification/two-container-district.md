# Two-container District preview

Preview: http://127.0.0.1:4179/style-gallery/explorer#district

The District contains two architectural surfaces: web GTM and server GTM. Entity groups become floors inside cutaway container modules with ribbed rear skins, corner frames, guard panels, equipment bays, guide lights, and animated workers. Expand either surface independently, explode both, or select a floor to pull it out. Floor and entity details use the existing inspector.

The public demo now includes an explicitly synthetic server surface and a web-to-server transport edge. Private snapshots are not augmented: a missing surface stays empty. Google usageContext is retained to put server snapshots in the correct building. The current connection flow still loads one container at a time; this change does not implement pairing of two private snapshots.

Workers are illustrative activity, not execution or volume measurements. Packet rendering reuses the existing simulated/imported telemetry controls. Reduced motion disables walking, and Workers pauses walking independently of packet signals.

Validation: build passed; all 60 tests passed, including surface provenance, sample-only augmentation, floor containment, and independent building expansion. Browser checks verified expanded server floors, floor pull-out and existing inspector selection, desktop and 390px mobile layouts, and no renderer errors. The camera now refits when the viewport changes.

Saved locally. Not deployed to production. Clerk production configuration remains pending explicit approval from the prior auth work.
