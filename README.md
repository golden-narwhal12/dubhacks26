# Trace

A local macOS workbench for developing documented hardware and firmware together. Editable wiring, a real code editor, scoped engineering checks, and an AI agent share one versioned project model.

Initial boards: **Arduino Mega 2560 Rev3** and **Espressif ESP32-S3-DevKitC-1 v1.1**. The catalog also includes generic LED/resistor/potentiometer, BB830, a photo-matched AS5600 module, generic SG90 and bare ITR9608. Existing exact passive packages are preserved for old projects. Pin facts link to original manufacturer evidence.

## Run

```sh
npm ci
npm run build
npm start
```

Development: `npm run dev`. Browser-only manual editor: `npm run dev:web`. Native app: `npm run package` creates `release/Trace-darwin-arm64/Trace.app` on this Mac. It is a local development bundle; nothing is published.

Compilation requires macOS, Arduino CLI and the `arduino:avr` / `esp32:esp32` cores in the standard Arduino15 data directory. They are already installed on this development Mac. Build/simulator processes use file/network confinement and private scratch directories; existing user libraries are not implicitly exposed. For Mega execution, run `npm run setup:simavr` once before packaging. It builds an external, pinned GPL simulator locally; source and license are retained under ignored `artifacts/tools` and included with the local app bundle. See [execution setup and scope](docs/execution.md).

## Try the loop

1. Prototype → inspect a Mega terminal; Evidence stays on demand.
2. Disconnect the signal wire, then drag **U1.12 → R1.1**. The initial code/binding still points to 13.
3. Open Issues and Output. Review/apply the coordinated fix; undo/redo through Edit.
4. Verify checks and compiles. Simulate executes Mega machine code separately.
5. Select a real device, Program Board, and review/approve the exact artifact. Real-device tests remain pending; no physical operation is automatic.
6. In Debug, explicitly start monitoring, inspect raw output and preview a field mapping. Unreported values are not zero. Workspace changes and samples cause zero model requests.
7. File → Save/Open preserves versioned source, circuit, layouts, properties, board configuration and mappings.

AI is optional. In AI settings, save a provider API key, select a model ID, and Test. Gemini is the default; OpenAI, Claude and Grok have separate real protocol adapters. Keys stay encrypted in the desktop credential boundary. Provider model/account access can vary; there is no silent fallback. [Demo outline](docs/demo.md) distinguishes live verification from fixture tests.

## Verify

```sh
npm run check
npm run test:e2e
npm run test:toolchain
```

End-to-end tests run the actual Electron app in isolated temporary profiles. A provider fixture scenario exercises IPC, streaming, tools, proposals and key isolation without calling a real API. `test:toolchain` compiles both requested boards and runs the Mega example with local tools. Screenshots/results are ignored by Git. `npm run format` formats the source.

## Scope

Manual editing and checks work offline. Rules validate structural references, known supply shorts, mixed logic, explicit pin mappings and a simple LED path. They do not certify arbitrary circuits or analyze general C++ control flow. The schematic is a basic electrical-symbol view with independent layout. ESP32-S3 compilation uses conservative default toolchain options; confirm the actual flash/PSRAM variant before physical operations. Real-device upload/serial validation, ESP32-S3 simulation, analog/SPICE, advanced schematic tooling and datasheet import remain deferred.

Read [current status](docs/status.md), [product](docs/product.md), [architecture](docs/architecture.md), and [design](docs/design.md). Contributor rules and commands live in [AGENTS.md](AGENTS.md).

Agent instructions live in [src/services/instructions.ts](src/services/instructions.ts). Settings → Task limits exposes the independent task thresholds; the default reported-token maximum is 1,000,000. Gemini defaults to `gemini-3.5-flash-lite`. See [evaluation evidence and commands](docs/evaluation.md) before interpreting fixture results as live capability. `npm run evaluate:fixtures` exercises the same runtime with deterministic responses and real compilation; `npm run evaluate:gemini -- --cases led,servo-encoder --repeat 1` is an opt-in paid isolated batch. No physical actions are allowed by that suite.
