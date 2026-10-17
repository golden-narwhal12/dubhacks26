# Design

Working identity: **Trace**. A quiet instrument for connecting hardware decisions to code. Graphite surfaces, warm off-white text, muted secondary labels and a mint accent. Copper/orange marks signal wires and warnings; red is reserved for errors. No decorative metrics or animated status noise.

Central tokens in `src/ui/tokens.css`: canvas, panel, raised surface, border, text, muted, accent, warning and danger; spacing, toolbar/row sizes, radius and monospaced font. System typography for chrome; bundled Monaco for firmware. Small consistent Lucide icons with tooltips and accessible labels. Keyboard focus is visible.

Default: wide circuit left, code center, agent right. Tabs and thin separators frame the content. Output collapses along the bottom; inspector overlays a compact contextual region of the circuit. Pane headers support maximize and floating; dragging tabs rearranges/stacks panels. Layout reset is always available.

Original vector board artwork conveys physical form without implying exact manufacturing dimensions. Terminal hit targets are independent from artwork, at least 18 px at default zoom. Pins retain explicit identity; wire preview/snapping never connects crossings. Components drag independently from pin gestures. Selection persists across views and highlights linked code without changing active files. Evidence and code navigation require explicit actions.

Part library opens on demand. Selected objects reveal properties/evidence; blank canvas guides adding a part. Agent starts with one concise useful action and connection state, never fabricated prior conversation. Tool activity is compact and expandable. Settings separate provider connections from participation policy. Capability labels distinguish design, compiled MCU execution and physical hardware.
