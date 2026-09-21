# Persistent path status group panel

Selecting a row in a Path Status Group now changes the diagram selection without replacing or rebuilding the side-panel list. The selected row is highlighted with aria-pressed, and keyboard focus and scroll position are retained. Signal and context groups use the same behavior. A separate Inspect selected route action deliberately opens the existing path/element inspector. Audit prefers the currently selected path. Group content is reused when it is unchanged during other diagram updates.

Validation: build succeeded; existing 80 tests passed. Browser checks confirmed sequential failing-route clicks retain all five rows, the Path Status Group heading, and focus on the selected row. Explicit inspection opened the correct selected path’s repair workbench. Context-route clicks also retained the group and highlighted the selected row. Browser error log empty.

Local preview only. No production deployment.
