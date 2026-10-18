# Demo and reset

Build/launch: `npm ci && npm run build && npm start`; native `npm run package`. Set up external Mega emulation once with `npm run setup:simavr`. File → Open accepts `.trace.json`; Project → Reset Indicator Example is undoable. View → Reset Workspace Layout resets only the active Prototype/Debug arrangement. `examples/indicator.trace.json` is the version 2 generic-passive example. Old version 1 exact packages migrate without replacement.

1. Prototype: show the compact native toolbar and editable Circuit/Code/Agent. Inspect a Mega pin; Evidence is on demand. Move/rotate a component: endpoints/nets stay unchanged and wires reroute around bodies.
2. Disconnect the signal wire and drag U1.12 → R1.1. Activate the small issue indicator or Issues and Output. Review/apply the grouped binding/code fix; undo/redo. Monaco marks the known source span. No AI request is needed.
3. Verify compiles visible source and runs scoped checks. Simulate independently executes compiled Mega instructions with emulated UART/GPIO. It does not model external sensors, servo, LED, resistor, power or analog behavior. Show scope without implying physical execution.
4. Show parts categories: one LED and resistor entry with editable properties, photo-matched AS5600, provisional SG90/ITR9608, and exact BB830. Its rails are continuous; other breadboards may differ. Do not imply source-backed chip facts prove an anonymous breakout.
5. With a real board only when the user chooses: select project target and physical port, Program Board, review exact source/artifact/configuration and verification, approve. Missing verification offers Verify or explicit override; compilation must succeed. No automatic programming follows Verify. Success opens Debug.
6. Approve Start monitoring. Show only real transmitted raw output. Pick an actual example line, configure field/parser/component/units/meaning, preview, save. Missing fields are Not reported. Distinguish commanded servo position from feedback and host time from device timestamps. No model calls occur per sample.
7. If Gemini is configured/tested, ask it to inspect current wiring and bounded telemetry, explain a real issue and propose a visible local correction. A separate hardware action card must be approved to program it. Show cancellation of an exact serial/reset request; no operation should execute on denial. Never substitute a fixture or hidden script for live AI/hardware.
8. Save/reopen preserves files, endpoints, layouts, properties, board settings and parser mappings. Workspace switches preserve project and conversation without opening ports.

Actual physical operations and live Gemini remain unverified until the user performs the explicitly approved tests. Deterministic tests use fake serial/device/adapter data, clearly distinguished from real compiler/emulator runs. Monitor histories and upload records are session-local, and external reflashing cannot be detected. [Status](status.md) records latest actual evidence; [execution](execution.md) records setup and limits; [parts](parts.md) records identity questions.

No video production, submission, domain registration or publication has been performed.
