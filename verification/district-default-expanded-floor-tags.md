# District Default Expansion and Floor Tags

- 01 District starts with Explode active when loaded directly.
- 03 Signal Flow still starts with its normal compact spacing when loaded directly.
- Combined-container floors render readable C01–C06 screen-space tags at their camera-facing lower edges.
- Split-container floors retain W and S prefixes and their cyan/lime surface colors.
- The physical container plaques remain on the front edge; the larger tags provide legibility at the full-building camera fit.
- The building badge is hidden while exploded to avoid covering C01.

Validation: all 82 automated tests pass. Browser verification confirms the default expanded state and all six combined floor tags, including `C06 / Processing + Templates`, at the initial camera fit.
