# Status

## Current
Milestone A runs on this Mac: Electron launches the docked Circuit/Code/Agent workspace, with original vector parts, Monaco editing, pin hit targets, contextual evidence, offline diagnostics and output. Main/renderer are isolated through sandboxed preload IPC. Repo started clean; existing Git/main preserved. Environment: macOS 26.3.1, Node 25.1, npm 11.6, Xcode/clang, Arduino CLI 1.5.1; AVR 1.8.8 / ESP32 3.3.11 cores. No recognized attached USB board; Bluetooth/debug ports are not assumed hardware. No API-key environment variables detected; no secret values read.

User selected **Mega 2560 Rev3** and **Espressif ESP32-S3-DevKitC-1 v1.1**. Header/port maps are cross-checked against official board sources; the ESP module memory variant remains unconfirmed. Uno and AVR8js were removed from the execution plan. External simavr feasibility/compile adapter is in progress.

## Time budget
Started 2026-10-17 15:18 PDT. Conservative final: Oct 18 10:00 PDT (18h42 remaining at start). Proposed feature freeze Oct 18 02:15 PDT, reserving ~7h45 (~41%) for rest, video, submission and contingency. Draft reminder: Oct 17 before 22:30 PDT; user handles submission. Reassess against actual time. Hacker guide inaccessible; detailed eligibility/video rules unknown.

## Milestones
A: shared schema/commands + runnable docked desktop workspace.
B: manual circuit/code editing, save/open, undo, sourced facts and local rules.
C: bounded real provider tools and credential settings; test adapters independently.
D: compiled AVR execution, observable UART/GPIO and coordinated pin fix.
E: visual/interaction inspection, desktop E2E, reset/demo instructions and honest capability list.

## Next
Integrate execution adapter and finish provider/controller tests. Manual parts/search/add, wiring, properties, code, schema validation, grouped undo/redo, versioned save/open and schematic symbol rendering are implemented; broader interaction E2E is next. Provider-specific streaming/tool adapters are implemented with contract fixtures; no live-provider verification without keys. Two bounded workers used after shell/contracts: execution adapter (owned separate files) and read-only domain review (regression tests only); no recursive delegation.

Known limitations: physical upload/serial unavailable, ESP32-S3 simulation unavailable, schematic symbols/layout basic, firmware parser only supports named literal integer constants, no analog solver or general safety verdict. Desktop dependencies live in existing toolchains. Provider model availability is API-account dependent. No eligibility claims.

## Run/reset
`npm ci && npm run build && npm start` launches desktop. `npm run dev` launches with Vite. Reset via Project → Reset indicator example (undoable), or Project → New blank project. `npm run check` runs unit/contract checks. `npm run test:e2e` launches actual Electron in an isolated temporary profile. Screenshots go to ignored `artifacts/`.

Latest verified: build/typecheck passed; 27 tests passed (domain, reviewed regressions, provider protocol fixtures, participation limits and execution contract tests). First macOS Electron test passed: canvas terminals, Monaco, offline LED estimate and output toggle. Screenshot inspected; checking resize settling and full-canvas visibility next. No live API requests made. Three domain-review defects fixed with regression tests: duplicate GPIO aliases, comment-safe constant edits, and bypassed series resistor suppressing current estimates.
