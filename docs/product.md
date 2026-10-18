# Product

Trace brings documented hardware and firmware into one local development loop. A direct wiring canvas, code editor, and AI collaborator share structured project data. The editor stays useful with all providers disabled. Physical wiring is documented by a person; USB never discovers it.

The workspace supports idea, hardware, code, and blank entry points. Initial boards chosen by Pranav: Arduino Mega 2560 Rev3 A000067 and Espressif ESP32-S3-DevKitC-1 v1.1. ESP module flash/PSRAM variant is unconfirmed. The resettable Mega example uses a generic red LED and configurable 330 Ω resistor with explicit analysis assumptions. Existing exact Kingbright/Vishay packages remain available to old project references. No claim is made about other available components.

The longer-term workspace grows from this loop: searchable exact part packages with reviewed datasheet imports; independent pictorial and electrical-symbol layouts over the same nets; richer firmware toolchains and physical-device adapters; and compatible behavioral/analog models with explicit boundaries. A part can be documented without supporting simulation. Every engineering claim should preserve its evidence, conditions and unknowns. Model confidence cannot substitute for verification.

Human and AI edits remain peers through one validated, undoable transaction layer. The AI retrieves targeted project facts, explains deterministic diagnostics, and proposes coordinated changes without overwriting intervening human work. Provider connections remain API-key-only and separate from agent roles. The local participation controller tracks context without continuous inference. A generalized platform, concurrent agents and broad catalog must not delay a polished single-user development loop.

## Acceptance

- Docked, resizable, rearrangeable circuit/code/agent panes, persistent layout, maximize/reset, contextual inspector and output.
- Search/place exact parts; connect/select/delete; pan/zoom; edit properties/files; undo/redo; validated versioned save/open.
- Source-backed terminal facts, derived nets, structural/electrical/firmware checks with scope and uncertainty. One deterministic coordinated fix uses the same command layer as AI.
- Gemini performs real inspection and grouped circuit/code edits. Gemini/OpenAI/Claude/Grok adapters share a tool contract while translating provider-specific messages. Missing keys never block manual work.
- Participation modes: on request and default Suggest produce no background inference. A narrow optional failed-build investigation has bounded requests/tools/tokens, cancellation, cooldown and deduplication.
- Compile Mega and ESP32-S3 Arduino firmware with the installed CLI; execute compiled Mega machine code through external simavr. Observe UART. ESP32-S3 simulation remains unsupported. This is MCU simulation, not analog circuit simulation or physical measurement.
- Demo: inspect a sourced pin, move the documented signal to another GPIO, detect the mapping mismatch, coordinate a fix, build/run and observe output. Reset must be repeatable; live model responses are not deterministic.

## Deferred

Further catalog coverage, datasheet import, arbitrary firmware analysis, analog/SPICE co-simulation, cloud/accounts, collaboration platform, marketplace, OS detached windows and advanced schematic tooling. The current shared schematic provides basic symbols and independent layout. Physical upload and persistent serial now use explicit device selection and action-specific approvals; real-device verification remains pending. Exact unmet criteria are tracked in status.

## Event planning

Checked 2026-10-17 at approximately 15:18 PDT: [Devpost](https://dubhacks-2026.devpost.com/) lists draft Saturday 22:30 and final Sunday 10:00. It limits entries to one title track and up to three sponsored side tracks. The [hacker guide](https://dubhacks.notion.site/ebd//15dff32c1d7e83748aac8154036aa658?pvs=143) was inaccessible. Solo/category eligibility, sponsor classification and video limits are unverified. Intended categories are context only. No eligibility claim, submission, publication, registration or external message is authorized by this implementation work.

## Prototype and Debug

Prototype edits/checks source and wiring, selects an actual device, optionally emulates Mega code, and explicitly programs an immutable reviewed artifact. Debug inspects actual firmware serial output with explicit local telemetry mappings and bounded history. Shared project/agent context survives switching. Real programming succeeds before automatic Debug navigation; simulation is independent and never a prerequisite. No reporting helpers are secretly inserted. Hardware control by an agent always requires a separate specific user approval.

Initial peripheral library covers the supplied AS5600 photo-matched module, generic SG90 and bare DIP-4 ITR9608, plus exact BB830 and generic potentiometer. Evidence/scope is recorded in [parts](parts.md). Diagram presence is not telemetry and commanded servo position is not measured feedback.

Current catalog additions prioritize supporting power/interface hardware and common building blocks over execution models. See [catalog](catalog.md) for exact package scope and provisional generic assumptions. Normal reviewed local batches continue within the same task; questions have explicit selectable answers and free text. New Project resets the project conversation and transient execution state.
