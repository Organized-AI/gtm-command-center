# Signal Flow Path Status Groups

- Path Status Groups are visible in both 01 District and 03 Signal Flow.
- The groups use the same measured or simulated health source, category colors, and counts.
- Selecting a group filters the visible paths in Signal Flow and opens the group inspector.
- Selecting routes within the group preserves the group list until the user explicitly inspects a route.
- Camera fitting and label placement reserve space for the status controls.

Validation: all 82 automated tests pass. Browser verification confirms all seven status categories render in Signal Flow, the failing group shows five demo routes, a selected route keeps the group inspector open, and the panel does not overlap the source badge or diagram.
