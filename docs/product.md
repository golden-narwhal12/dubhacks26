# Product

Trace brings documented hardware and firmware into one local development loop. A direct wiring canvas, code editor, and AI collaborator share structured project data. The editor stays useful with all providers disabled. Physical wiring is documented by a person; USB never discovers it.

The workspace supports idea, hardware, code, and blank entry points. Initial boards chosen by Pranav: Arduino Mega 2560 Rev3 A000067 and Espressif ESP32-S3-DevKitC-1 v1.1. ESP module flash/PSRAM variant is unconfirmed. The resettable Mega example uses a Kingbright WP7113ID red LED and a Vishay MRS25 330 Ω resistor. No claim is made about other available components.

## Acceptance
- Docked, resizable, rearrangeable circuit/code/agent panes, persistent layout, maximize/reset, contextual inspector and output.
- Search/place exact parts; connect/select/delete; pan/zoom; edit properties/files; undo/redo; validated versioned save/open.
- Source-backed terminal facts, derived nets, structural/electrical/firmware checks with scope and uncertainty. One deterministic coordinated fix uses the same command layer as AI.
- Gemini performs real inspection and grouped circuit/code edits. Gemini/OpenAI/Claude/Grok adapters share a tool contract while translating provider-specific messages. Missing keys never block manual work.
- Participation modes: on request and default Suggest produce no background inference. A narrow optional failed-build investigation has bounded requests/tools/tokens, cancellation, cooldown and deduplication.
- Compile Mega and ESP32-S3 Arduino firmware with the installed CLI; execute compiled Mega machine code through external simavr if the compatibility spike succeeds. Observe UART. ESP32-S3 simulation remains unsupported. This is MCU simulation, not analog circuit simulation or physical measurement.
- Demo: inspect a sourced pin, move the documented signal to another GPIO, detect the mapping mismatch, coordinate a fix, build/run and observe output. Reset must be repeatable; live model responses are not deterministic.

## Deferred
Broad catalog, datasheet import, breadboards, arbitrary firmware analysis, analog/SPICE co-simulation, cloud/accounts, collaboration platform, marketplace, OS detached windows. Shared schematic view follows the core loop; never display a fake view toggle. Physical upload/serial follows confirmed hardware. Exact unmet criteria are tracked in status.

## Event planning
Checked 2026-10-17 at approximately 15:18 PDT: [Devpost](https://dubhacks-2026.devpost.com/) lists draft Saturday 22:30 and final Sunday 10:00. It limits entries to one title track and up to three sponsored side tracks. The [hacker guide](https://dubhacks.notion.site/ebd//15dff32c1d7e83748aac8154036aa658?pvs=143) was inaccessible. Solo/category eligibility, sponsor classification and video limits are unverified. Intended categories are context only. No eligibility claim, submission, publication, registration or external message is authorized by this implementation work.
