# Architecture

One Electron/React/TypeScript application. Main owns files, encrypted credentials, provider network access, fixed toolchain execution and cancellation. A sandboxed preload exposes a narrow validated IPC contract. Browser mode supports manual editing and explicitly lacks desktop services. Domain logic has no UI/runtime dependencies.

## Version 1 project format
`.trace.json` is UTF-8 JSON with `schemaVersion: 1`, project identity/name/revision, component instances, explicit wire endpoints, independent wiring/schematic placement maps, firmware files and pin bindings. Parts reference immutable built-in package ID/version. Each terminal has a stable ID independent of its label and rendering position. Package data records exact manufacturer/identity/revision, source URL/location/revision/fact/units/status, firmware and simulation capabilities. Unsupported package versions are rejected, never remapped silently.

Nets are derived connected components over endpoints plus explicitly modeled internal equivalences. A resistor/LED does not short its two pins. Layout is not circuit meaning. Selection, tool activity, viewport and output are transient or workspace preferences, never the circuit. Diagnostics carry source revision, affected object IDs, rule, severity, evidence and next action. Recompute local checks without inference. Execution results are revision tagged and stale after edits.

## Commands
`transact(project, {expectedRevision, summary, commands})` validates all inputs and the resulting project before returning a new revision. Commands add/configure/remove parts, connect/disconnect, move/rotate in a named view, replace a firmware file, and set/remove explicit pin bindings. Removal cascades connections, layouts and bindings. One failed command rejects the entire group. Expected revisions reject stale agent mutations. Snapshot history supports grouped undo/redo, each advancing revision to prevent ABA conflicts.

Shared interaction store selects stable component/terminal/wire/diagnostic IDs. Panels subscribe; no panel imperatively changes another. Explicit navigation can reveal code/evidence without selection stealing focus. Dockview owns pane arrangement; React Flow owns gesture rendering, never canonical topology. Monaco uses local bundled workers/assets, no CDN.

## Modules
- `src/domain`: schema, commands, topology, rules, history, example and typed tool contracts.
- `src/parts`: sourced immutable part packages; original vector illustrations with separate terminals.
- `src/ui`: dock shell, circuit, code, agent, inspector, output and tokens.
- `src/services`: participation controller, provider/tool contracts and execution model.
- `desktop`: Electron lifecycle/preload, credentials, provider adapters and toolchain.
- `tests`: topology/transaction/persistence/rules, provider fixtures, participation and desktop workflow.

## Boundaries
No arbitrary filesystem paths or shell tool. File dialogs mediate project access; sketches compile in a private temporary directory. Provider keys remain main-only, encrypted with Electron safeStorage when available. Main validates IPC, provider/model and payload limits. Imported files/model arguments/logs are data, not instructions. Tool calls use bounded targeted queries, validated transactions and revision checks. A proposal carries its base revision; application revalidates against the live state. No silent provider fallback.

Build adapters target `arduino:avr:mega:cpu=atmega2560` and `esp32:esp32:esp32s3` with fixed default settings; ESP flash/PSRAM must be confirmed before physical operations. External [simavr](https://github.com/buserror/simavr) (GPL-3.0) is being tested for bounded Mega execution. It is a separate local process, not linked into Electron; upstream calls >128 KB coverage preliminary. No USB/analog/power/current simulation is claimed. ESP32 simulation is unsupported. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [React Flow handles](https://reactflow.dev/learn/customization/handles), [Dockview license/features](https://dockview.dev/docs/overview/licence/).
