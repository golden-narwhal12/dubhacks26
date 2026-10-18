# Status

## Current work

Follow-up implementation: Prototype/Debug share one project, conversation, selected target and history; workspace layouts persist separately. Native macOS menus replace the branding banner, Project toolbar menu and bottom status strip. The compact toolbar separates Verify, Program Board and secondary Simulate. Preferences use native dialog top-layer focus containment over Dockview floating panes.

Manual editing, sourced pin facts, properties, undo/redo and local diagnostics remain independent of AI. Indicator routing now avoids bodies and separates unrelated segments; crossing halos do not create junctions. Initial Fit View is immediate so pin hit targets do not move during a first drag. Route failure is explicit. LED art is narrower. New reset examples use generic editable LED/resistor packages; old exact packages remain immutable and retain their references during version migration.

Physical backend is implemented: explicit device selection, persistent serial monitoring, exact-source artifact preparation, user-reviewed one-use hardware approvals, fixed confined upload, cancellation and recorded last Trace upload. **No physical upload, reset, serial connection or transmit has been performed during this implementation.** Device effects and successful real uploads remain unverified. Firmware compiled externally has unknown identity; even a matching last Trace upload cannot detect an external reflash.

Debug parses explicit JSON/key=value fields locally, preserves raw output, distinguishes missing/stale/invalid data, tracks bounded numeric history and summaries, and exposes event-based observations to a requested agent task. Incoming samples make zero inference calls. Commands and reset need distinct approvals; local code-edit approval never approves hardware. Successful approved programming opens Debug; switching workspaces does not open a port.

## Boards and parts

Mega 2560 Rev3 is the default. ESP32-S3-DevKitC-1 v1.1 remains supported; user confirmation of flash/PSRAM settings is mandatory before actual programming. No automatic wiring discovery.

Catalog: both boards, generic LED/resistor/potentiometer, exact BusBoard BB830, photo-matched AS5600 module, generic SG90 and bare DIP-4 ITR9608. BB830 rails are continuous, unlike some other 830-hole models. Its 830 addressable holes have explicit internal groups; visual placement alone never connects them. AS5600 photo establishes printed labels, not pull-ups/regulator routing. HiLetgo ITR lot/suffix and SG90 supplier/ratings remain unconfirmed. See [part evidence](parts.md).

## Verification

Final local checks: **63 tests passed, 4 opt-in toolchain tests skipped** across 11 files. The separate real toolchain run passed **all 10 checks**, covering Mega/ESP32 compilation, retained exact-source artifacts, actual Mega emulation and confinement. Full Electron acceptance passed **10 scenarios** (the packaged-app test is separately opt-in): manual wiring → mismatch → reviewed fix → real MCU output/save-reopen; pane manipulation/files/focus; Gemini protocol fixtures/key isolation; bounded proactive continuation; native chrome and preferences over floating panes; physical workflow/telemetry fixtures; generic properties/rotation/breadboard/persistence; agent approval denial; Verify without upload and mandatory compilation; offline foundation. Fixture/manual workflows asserted zero inference where required. Service regressions cover replay/expiry/changed source or device, serial framing/bounds/deadlines/event observations, semantic freshness, topology and source mappings.

Build and local macOS packaging passed. The native-bundle smoke test passed from `/private/tmp`, including read-only port discovery and actual execution using the bundled simulator. Screenshots inspected at laptop size include Prototype, native Settings top layer and fixture Debug readings. Route separation, concise agent state and readable raw output were visually checked. These screenshots are development evidence, not physical measurements.

Gemini/OpenAI/Claude/Grok adapters remain intact. Protocol fixtures pass; live providers remain unverified pending configured authorized credentials. Tests use isolated temporary profiles and explicit fake-device adapters. Fixture serial readings are never represented as real measurements. Screenshots are captured under ignored `artifacts`.

## Run and next

`npm ci && npm run build && npm start`; development `npm run dev`. Native: `npm run package`, then `release/Trace-darwin-arm64/Trace.app`. Local unsigned/ad-hoc build, no publication/notarization. `npm run setup:simavr` prepares the external helper before packaging. Tests: `npm run check`, `npm run test:e2e`, `npm run test:toolchain`, `npm run test:package`.

File menu opens/saves/exports unchanged firmware; Project → Reset Indicator Example is undoable. View → Reset Workspace Layout resets the active workspace. [Execution](execution.md), [demo](demo.md).

Next: user-driven Mega programming/monitoring and live Gemini acceptance. The user must select the actual device and approve each physical test. No key should be shared in chat.

Limitations: no ESP MCU engine or analog/peripheral simulation; no automatic servo feedback, sensor reporting or inferred voltage; no arbitrary imported Arduino libraries or general C++ analysis; no automatic reconnect to another device; no manual route bend editing (move/rotate components to resolve blocked routes). Monitoring sessions/history and upload records are session-local; project parser mappings persist. Serial plot units/meaning come from explicit mappings. Verification covers known deterministic rules, not every new peripheral's complete electrical design.

## Schedule

2026-10-17 follow-up integration at approximately 19:53 PDT. Conservative final Oct 18 10:00 PDT; proposed feature freeze remains 02:15 PDT, reserving ~7h45 for rest, video, submission and contingency. Draft before 22:30 Oct 17 is the user's responsibility. Hacker guide inaccessible; no eligibility/video claims, submissions, domains or publishing performed.
