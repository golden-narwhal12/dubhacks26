# Demo and reset

## Preparation

`npm ci && npm run build && npm start`. On this Mac, Arduino CLI and both requested cores are installed. `npm run setup:simavr` prepares the external Mega simulator; `npm run test:toolchain` verifies both compilation targets and real Mega execution. Missing tools produce a specific error, independent of AI.

Project → Reset indicator example restores the documented Mega/330 Ω/red LED circuit and firmware. Reset is undoable. Reset pane layout restores Circuit/Code/Agent. A ready-to-open copy lives at `examples/indicator.trace.json`. A blank project is available from the same menu; firmware files can be imported without a provider.

For AI, add a Gemini API key inside the desktop settings, retain an accessible configured model, and Test. No subscription login is implemented. Do not put keys in chat, screenshots, project files, or the repository. The test makes a small real API request. Keep the default Suggest and Preview settings for a clear demonstration. Model responses are live and nondeterministic; replaying a project does not replay a model response.

## Compact sequence

1. Show the three editable panes. Select U1.13 and expand Documented facts: Mega D13 maps to PB7 in the official Rev3 pinout. Open its source explicitly if useful.
2. Show `LED_PIN = 13` and its cross-pane pin link. Drag the LED or resistor to establish that the wiring is real editable state; connectivity stays unchanged.
3. Select the signal wire and Disconnect. Drag U1.12 to R1.1. Open Diagnostics: the documented wiring, explicit binding, and simple firmware constant disagree.
4. Without AI, Preview fix shows the binding and code diff. Apply, undo and redo. This establishes a useful deterministic editor with no model calls.
5. For the AI version, undo the fix, then request: “Inspect the current pin mismatch. Read the relevant firmware and documented pin facts, then propose a grouped correction that preserves my actual wiring.” Show tool inspection and review/apply the real proposed changes. If it misunderstands, clarify; do not substitute a hidden script and present it as live AI.
6. Run MCU. Show UART ready/ON/OFF output and sampled transitions. State precisely: Arduino CLI compiled the firmware; external simavr executes ATmega2560 machine code; the external analog circuit is not simulated. Result revision must match the current project.
7. Add the ESP32-S3 DevKitC-1 v1.1 from Parts, choose it as build target, and Build if time permits. Show its 3.3 V logic and variant-dependent pins. ESP32-S3 simulation and physical upload are unavailable.
8. Save/reopen the project; finish with the working loop and actual limitations.

## Verification boundaries

Actual macOS Electron interactions, manual wire gestures, local mismatch/fix, coherent undo/redo, save/reopen, docking/maximize, file editing, and compiled Mega output are automated. Provider-specific fixtures cover Gemini/OpenAI/Claude/Grok streaming and tool translations, cancellation/errors and key isolation. A fixture-driven desktop test is explicitly not live AI verification. Latest live-provider status is recorded in `status.md`; never infer it from passing fixture tests.

The sample LED-current calculation is a nominal estimate under stated assumptions. It is not a physical current measurement, power guarantee, arbitrary circuit verifier or full-device simulator. GPIO transitions and wall-time throughput vary by host. Firmware output is untrusted data. USB connection never establishes external wiring.

No promotional video, submission, domain registration or publication has been performed.
