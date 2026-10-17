# Trace

A local macOS workbench for developing documented hardware and firmware together. Editable wiring, a real code editor, scoped engineering checks, and an AI agent share one versioned project model.

Initial boards: **Arduino Mega 2560 Rev3** and **Espressif ESP32-S3-DevKitC-1 v1.1**. The four-package library also includes a Kingbright WP7113ID LED and Vishay MRS25 330 Ω resistor. Pin facts link to original manufacturer evidence.

## Run

```sh
npm ci
npm run build
npm start
```

Development: `npm run dev`. Browser-only manual editor: `npm run dev:web`. Native app: `npm run package` creates `release/Trace-darwin-arm64/Trace.app` on this Mac. It is a local development bundle; nothing is published.

Compilation requires macOS, Arduino CLI and the `arduino:avr` / `esp32:esp32` cores in the standard Arduino15 data directory. They are already installed on this development Mac. Build/simulator processes use file/network confinement and private scratch directories; existing user libraries are not implicitly exposed. For Mega execution, run `npm run setup:simavr` once before packaging. It builds an external, pinned GPL simulator locally; source and license are retained under ignored `artifacts/tools` and included with the local app bundle. See [execution setup and scope](docs/execution.md).

## Try the loop

1. Project → Reset indicator example. Select a Mega terminal and expand Documented facts.
2. Select the signal wire, disconnect it, then drag **U1.12 → R1.1**. The initial code/binding still points to 13.
3. Open Diagnostics. Preview the coordinated binding/code fix, review the diff, and Apply. Undo/redo restores the group coherently.
4. Run MCU. Observe actual compiled Mega UART output and digital transition counts. External circuitry is not simulated.
5. Save/reopen the `.trace.json` project. Circuit semantics, both layouts, firmware and explicit bindings survive.

AI is optional. In AI settings, save a provider API key, select a model ID, and Test. Gemini is the default; OpenAI, Claude and Grok have separate real protocol adapters. Keys stay encrypted in the desktop credential boundary. Provider model/account access can vary; there is no silent fallback. [Demo outline](docs/demo.md) distinguishes live verification from fixture tests.

## Verify

```sh
npm run check
npm run test:e2e
npm run test:toolchain
```

End-to-end tests run the actual Electron app in isolated temporary profiles. A provider fixture scenario exercises IPC, streaming, tools, proposals and key isolation without calling a real API. `test:toolchain` compiles both requested boards and runs the Mega example with local tools. Screenshots/results are ignored by Git. `npm run format` formats the source.

## Scope

Manual editing and checks work offline. Rules validate structural references, known supply shorts, mixed logic, explicit pin mappings and a simple LED path. They do not certify arbitrary circuits or analyze general C++ control flow. The schematic is a basic electrical-symbol view with independent layout. ESP32-S3 compilation uses conservative default toolchain options; confirm the actual flash/PSRAM variant before physical operations. Physical upload/serial, ESP32-S3 simulation, analog/SPICE, breadboards, advanced schematic tooling and datasheet import remain deferred.

Read [current status](docs/status.md), [product](docs/product.md), [architecture](docs/architecture.md), and [design](docs/design.md). Contributor rules and commands live in [AGENTS.md](AGENTS.md).
